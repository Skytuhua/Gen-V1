import { useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useStateStore, type ComponentRegistry, type ComponentRenderProps } from '@json-render/react';
import { MoveHorizontal } from 'lucide-react';
import { IMAGE_COMPARE_SCHEMAS, type ImageCompareProps } from '../../../packages/ui-catalog/image-compare';
import { useDocumentEvidence } from './document-evidence';
import { ArtifactTitle, statePath } from './task-context';
import { readMotionPolicy, observeMotionPolicy } from './motion-policy';
import './image-compare.css';

type View = { percent: number; mode: 'overlay' | 'split' };
type SavedView = View & { pairKey?: string };
type Size = { width: number; height: number };
const DEFAULT_VIEW: View = { percent: 50, mode: 'overlay' };
const resourceContentUrl=(id:string)=>`/api/resources/${encodeURIComponent(id)}/content`;
const readView = (raw: unknown): SavedView => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { percent: typeof value.percent === 'number' && Number.isFinite(value.percent) ? Math.min(100, Math.max(0, value.percent)) : 50, mode: value.mode === 'split' ? 'split' : 'overlay', ...(typeof value.pairKey === 'string' ? { pairKey: value.pairKey } : {}) };
};

const TRANSFER_MS = 220;
// cubic-bezier(.4,0,.2,1) — the move curve, solved for x then evaluated.
const easeMove = (() => {
  const x1 = 0.4, y1 = 0, x2 = 0.2, y2 = 1;
  const at = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = at(t, x1, x2) - x;
      if (Math.abs(error) < 1e-6) break;
      const derivative = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
      if (Math.abs(derivative) < 1e-6) break;
      t -= error / derivative;
    }
    return at(t, y1, y2);
  };
})();

function ImagePair({ props, view, change }: { props: ImageCompareProps; view: View; change: (patch: Partial<View>) => void }) {
  const beforeLabel = props.beforeLabel ?? 'Before', afterLabel = props.afterLabel ?? 'After';
  const [sizes, setSizes] = useState<[Size | null, Size | null]>([null, null]);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const stage = useRef<HTMLDivElement>(null), slider = useRef<HTMLInputElement>(null), drag = useRef<number | null>(null);
  const fraction = useRef(view.mode === 'split' ? 1 : 0), percent = useRef(view.percent); percent.current = view.percent;
  const origin = useRef<'pointer' | 'keyboard' | 'restore'>('restore');
  const transfer = useRef<{ frame: number; from: number; to: number; fromHeight: number; toHeight: number; started: number } | null>(null);
  const ready = Boolean(sizes[0] && sizes[1] && !error);
  const ratio = (index: 0 | 1) => sizes[index]!.width / sizes[index]!.height;
  const heightFor = (mode: 'overlay' | 'split') => {
    const node = stage.current; if (!node || !ready) return 0;
    const width = node.clientWidth, cap = Math.min(540, window.innerHeight * 0.7);
    return mode === 'overlay'
      ? Math.min(cap, Math.max(width / ratio(0), width / ratio(1)))
      : Math.min(cap, Math.max(width / (2 * ratio(0)), width / (2 * ratio(1))));
  };
  const applyGeometry = (split: number) => {
    const node = stage.current; if (!node) return;
    const clamped = Math.min(1, Math.max(0, split));
    node.style.setProperty('--image-compare-width', `${100 - clamped * 50}%`);
    node.style.setProperty('--image-compare-after-left', `${clamped * 50}%`);
    node.style.setProperty('--image-compare-clip', `${(100 - percent.current) * (1 - clamped)}%`);
    node.style.setProperty('--image-compare-divider-opacity', String(1 - clamped));
    const divider = node.querySelector<HTMLElement>('.image-compare-divider');
    if (divider) divider.style.visibility = clamped >= 1 ? 'hidden' : '';
    fraction.current = clamped;
  };
  const cancelTransfer = (settle: boolean) => {
    const active = transfer.current; if (!active) return;
    transfer.current = null; cancelAnimationFrame(active.frame);
    if (settle && stage.current) { applyGeometry(active.to); stage.current.style.height = `${active.toHeight}px`; }
  };
  useLayoutEffect(() => {
    applyGeometry(fraction.current);
    if (ready && stage.current) stage.current.style.height = `${heightFor(view.mode)}px`;
    // Only a width change is external input — height is driven by us (incl. the
    // transfer), so reacting to it would cancel our own animation.
    let lastWidth = stage.current ? stage.current.clientWidth : 0;
    const observer = new ResizeObserver(() => {
      if (!ready || !stage.current) return;
      const width = stage.current.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      cancelTransfer(true);
      stage.current.style.height = `${heightFor(view.mode)}px`;
    });
    const node = stage.current; if (node) observer.observe(node);
    const stopObservingMotion = observeMotionPolicy(policy => { if (policy !== 'full') cancelTransfer(true); });
    const hidden = () => { if (document.visibilityState === 'hidden') cancelTransfer(true); };
    document.addEventListener('visibilitychange', hidden);
    return () => { observer.disconnect(); stopObservingMotion(); document.removeEventListener('visibilitychange', hidden); cancelTransfer(false); };
  }, [ready]);
  const beginTransfer = () => {
    const node = stage.current, target = view.mode === 'split' ? 1 : 0;
    if (!node || !ready) return;
    // Sample the in-flight rectangle before retargeting the single clock.
    const from = fraction.current, fromHeight = node.offsetHeight, toHeight = heightFor(view.mode);
    cancelTransfer(false);
    const active = { frame: 0, from, to: target, fromHeight, toHeight, started: -1 };
    transfer.current = active;
    applyGeometry(from); if (stage.current) stage.current.style.height = `${fromHeight}px`;
    const tick = (now: number) => {
      if (transfer.current !== active) return;
      if (active.started < 0) active.started = now; // clock starts at the first real frame
      const progress = Math.min(1, (now - active.started) / TRANSFER_MS), eased = easeMove(progress);
      const value = active.from + (active.to - active.from) * eased;
      fraction.current = value; // keep the live share for mid-transfer retargeting
      applyGeometry(value);
      if (stage.current) stage.current.style.height = `${active.fromHeight + (active.toHeight - active.fromHeight) * eased}px`;
      if (progress < 1) { active.frame = requestAnimationFrame(tick); return; }
      transfer.current = null;
      fraction.current = active.to;
      applyGeometry(active.to); if (stage.current) stage.current.style.height = `${active.toHeight}px`;
    };
    active.frame = requestAnimationFrame(tick);
  };
  useLayoutEffect(() => {
    const node = stage.current, target = view.mode === 'split' ? 1 : 0;
    if (!node) return;
    const animate = ready && origin.current === 'pointer' && readMotionPolicy() === 'full' && document.visibilityState !== 'hidden';
    origin.current = 'restore';
    if (!animate) {
      cancelTransfer(false);
      applyGeometry(target);
      if (ready) node.style.height = `${heightFor(view.mode)}px`;
      return;
    }
    if (!transfer.current) beginTransfer();
  }, [view.mode, ready]);
  useLayoutEffect(() => { applyGeometry(fraction.current); }, [view.percent]);
  useEffect(() => {
    if (ready || error) return;
    const timer = setTimeout(() => setError('Images are taking too long to load. Check access and retry.'), 15_000);
    return () => clearTimeout(timer);
  }, [ready, error, retry]);
  const loaded = (index: 0 | 1, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) { setError(`${index ? afterLabel : beforeLabel} image could not be loaded. Check access and retry.`); return; }
    setSizes(previous => { const next: [Size | null, Size | null] = [...previous]; next[index] = { width: image.naturalWidth, height: image.naturalHeight }; return next; });
  };
  const position = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width) change({ percent: Math.round(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * 100) });
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready || view.mode !== 'overlay' || !event.isPrimary || event.button !== 0 || drag.current !== null) return;
    cancelTransfer(true); // a drag mid-transfer settles geometry before coordinates are read
    drag.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    slider.current?.focus({ preventScroll: true }); position(event);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== event.pointerId) return;
    drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const different = ready && (sizes[0]!.width !== sizes[1]!.width || sizes[0]!.height !== sizes[1]!.height);
  return <>
    <div className="image-compare-modes" role="group" aria-label="Comparison view">
      <button type="button" aria-pressed={view.mode === 'overlay'} onClick={event => { origin.current = event.detail > 0 ? 'pointer' : 'keyboard'; if (view.mode !== 'overlay') change({ mode: 'overlay' }); }}>Overlay</button>
      <button type="button" aria-pressed={view.mode === 'split'} onClick={event => { origin.current = event.detail > 0 ? 'pointer' : 'keyboard'; if (view.mode !== 'split') change({ mode: 'split' }); }}>Side by side</button>
    </div>
    <div ref={stage} className="image-compare-stage" data-mode={view.mode} data-ready={ready} aria-busy={!ready && !error} style={{ '--image-compare-position': `${view.percent}%` } as React.CSSProperties}
      onPointerDown={start} onPointerMove={event => { if (drag.current === event.pointerId) position(event); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={event => { if (drag.current === event.pointerId) drag.current = null; }}>
      {!error && <div className="image-compare-images" style={{ visibility: ready ? 'visible' : 'hidden' }} key={retry}>
        <div className="image-compare-after"><img src={resourceContentUrl(props.afterResourceId)} alt={afterLabel} draggable={false} onLoad={event => loaded(1, event.currentTarget)} onError={() => setError(`${afterLabel} image could not be loaded. Check access and retry.`)} /></div>
        <div className="image-compare-before"><img src={resourceContentUrl(props.beforeResourceId)} alt={beforeLabel} draggable={false} onLoad={event => loaded(0, event.currentTarget)} onError={() => setError(`${beforeLabel} image could not be loaded. Check access and retry.`)} /></div>
      </div>}
      {ready && <><span className="image-compare-label image-compare-label-before">{beforeLabel}</span><span className="image-compare-label image-compare-label-after">{afterLabel}</span><div className="image-compare-divider" aria-hidden="true"><span><MoveHorizontal size={18} /></span></div></>}
      {!ready && !error && <p className="image-compare-message" role="status">Loading images…</p>}
      {error && <div className="image-compare-message"><p role="status">{error}</p><button type="button" onClick={() => { setSizes([null, null]); setError(''); setRetry(value => value + 1); }}>Retry images</button></div>}
    </div>
    {view.mode === 'overlay' && <div className="image-compare-position"><input ref={slider} type="range" min="0" max="100" step="1" value={view.percent} aria-label="Comparison position" aria-valuetext={`${Math.round(view.percent)}% ${beforeLabel}`} disabled={!ready} onChange={event => change({ percent: Number(event.target.value) })} /><output aria-hidden="true">{Math.round(view.percent)}%</output></div>}
    {different && <p className="image-compare-size-note">Different image sizes</p>}
  </>;
}

export function ImageCompare(props: ImageCompareProps) {
  const store = useStateStore(), title = useContext(ArtifactTitle), evidence = useDocumentEvidence();
  const parsed = IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(props);
  if (!parsed.success) return <p className="error-text" role="status">Choose two granted images to compare.</p>;
  const grants = [props.beforeResourceId, props.afterResourceId].map(id => evidence?.resources.find(resource => resource.id === id && resource.threadId === evidence.threadId && resource.kind !== 'project' && resource.kind !== 'database'));
  if (grants.some(grant => !grant)) return <p className="error-text" role="status">One of these images is no longer available to this thread. Attach it again to compare.</p>;
  const key = JSON.stringify(grants.map(grant => [grant!.id, grant!.threadId, grant!.path, grant!.identity ?? null]));
  // pairKey is the SHA-256 of the pair identity JSON; the digest resolves off
  // render and only ever binds the record it was computed for.
  const firstKey = useRef(key), multipleOwners = firstKey.current !== key;
  const [digest, setDigest] = useState<string | null | undefined>(undefined);
  const pending = useRef<View | null>(null);
  useEffect(() => {
    let live = true;
    pending.current = null; // owner change clears a write queued for the old digest
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
      .then(buffer => { if (live) setDigest([...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')); })
      .catch(() => { if (live) setDigest(null); });
    return () => { live = false; };
  }, [key]);
  const raw = readView(store.get(statePath(props.stateKey)));
  const view: View = pending.current ?? (digest === undefined
    ? (raw.pairKey !== undefined || multipleOwners ? DEFAULT_VIEW : { percent: raw.percent, mode: raw.mode })
    : digest === null
      ? { percent: raw.percent, mode: raw.mode }
      : raw.pairKey === digest ? { percent: raw.percent, mode: raw.mode }
        : (!raw.pairKey && !multipleOwners ? { percent: raw.percent, mode: raw.mode } : DEFAULT_VIEW));
  const change = (patch: Partial<View>) => {
    const next = { ...view, ...patch };
    if (typeof digest === 'string') store.set(statePath(props.stateKey), { ...next, pairKey: digest });
    else pending.current = next; // digest pending or failed: keep it local to this owner
  };
  useLayoutEffect(() => {
    if (typeof digest !== 'string' || !pending.current) return;
    const next = pending.current; pending.current = null;
    store.set(statePath(props.stateKey), { ...next, pairKey: digest });
  }, [digest]);
  return <figure className="image-compare" aria-label={props.title ?? 'Image comparison'}>
    {props.title && props.title !== title && <figcaption>{props.title}</figcaption>}
    <ImagePair key={key} props={props} view={view} change={change} />
  </figure>;
}
export const IMAGE_COMPARE_REGISTRY = {
  ImageCompare: ({ element: { props } }: ComponentRenderProps) => <ImageCompare {...IMAGE_COMPARE_SCHEMAS.ImageCompare.parse(props)} />,
} satisfies ComponentRegistry;
