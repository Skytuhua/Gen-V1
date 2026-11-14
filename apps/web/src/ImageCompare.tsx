import { useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useStateStore, type ComponentRegistry, type ComponentRenderProps } from '@json-render/react';
import { MoveHorizontal } from 'lucide-react';
import { IMAGE_COMPARE_SCHEMAS, type ImageCompareProps } from '../../../packages/ui-catalog/image-compare';
import { useDocumentEvidence } from './document-evidence';
import { ArtifactTitle, statePath } from './task-context';
import { createSpringValue } from './motion-spring';
import { readMotionPolicy, observeMotionPolicy } from './motion-policy';
import './image-compare.css';

type View = { percent: number; mode: 'overlay' | 'split' };
type Size = { width: number; height: number };
const resourceContentUrl=(id:string)=>`/api/resources/${encodeURIComponent(id)}/content`;
const readView = (raw: unknown): View => {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return { percent: typeof value.percent === 'number' && Number.isFinite(value.percent) ? Math.min(100, Math.max(0, value.percent)) : 50, mode: value.mode === 'split' ? 'split' : 'overlay' };
};

function ImagePair({ props, view, change }: { props: ImageCompareProps; view: View; change: (patch: Partial<View>) => void }) {
  const beforeLabel = props.beforeLabel ?? 'Before', afterLabel = props.afterLabel ?? 'After';
  const [sizes, setSizes] = useState<[Size | null, Size | null]>([null, null]);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const stage = useRef<HTMLDivElement>(null), slider = useRef<HTMLInputElement>(null), drag = useRef<number | null>(null);
  const spring = useRef<ReturnType<typeof createSpringValue> | null>(null), percent = useRef(view.percent); percent.current = view.percent;
  const ready = Boolean(sizes[0] && sizes[1] && !error);
  const applyGeometry = (split: number) => {
    const node = stage.current; if (!node) return;
    const fraction = Math.min(100, Math.max(0, split)) / 100;
    node.style.setProperty('--image-compare-width', `${100 - fraction * 50}%`);
    node.style.setProperty('--image-compare-after-left', `${fraction * 50}%`);
    node.style.setProperty('--image-compare-clip', `${(100 - percent.current) * (1 - fraction)}%`);
    node.style.setProperty('--image-compare-divider-opacity', String(1 - fraction));
  };
  useLayoutEffect(() => {
    const initial = view.mode === 'split' ? 100 : 0;
    spring.current = createSpringValue(initial, applyGeometry); applyGeometry(initial);
    const stopObservingMotion = observeMotionPolicy(policy => { if (policy !== 'full') spring.current?.to(stage.current?.dataset.mode === 'split' ? 100 : 0, true); });
    return () => { stopObservingMotion(); spring.current?.dispose(); spring.current = null; };
  }, []);
  useLayoutEffect(() => { spring.current?.to(view.mode === 'split' ? 100 : 0, readMotionPolicy() !== 'full'); }, [view.mode]);
  useLayoutEffect(() => { applyGeometry(spring.current?.value ?? (view.mode === 'split' ? 100 : 0)); }, [view.percent]);
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
    if (!ready || view.mode !== 'overlay' || !event.isPrimary || event.button !== 0) return;
    drag.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); slider.current?.focus({ preventScroll: true }); position(event);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== event.pointerId) return;
    drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const different = ready && (sizes[0]!.width !== sizes[1]!.width || sizes[0]!.height !== sizes[1]!.height);
  return <>
    <div className="image-compare-modes" role="group" aria-label="Comparison view">
      <button type="button" aria-pressed={view.mode === 'overlay'} onClick={() => change({ mode: 'overlay' })}>Overlay</button>
      <button type="button" aria-pressed={view.mode === 'split'} onClick={() => change({ mode: 'split' })}>Side by side</button>
    </div>
    <div ref={stage} className="image-compare-stage" data-mode={view.mode} data-ready={ready} aria-busy={!ready && !error} style={{ '--image-compare-position': `${view.percent}%` } as React.CSSProperties}
      onPointerDown={start} onPointerMove={event => { if (drag.current === event.pointerId) position(event); }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={() => { drag.current = null; }}>
      {!error && <div className="image-compare-images" style={{ visibility: ready ? 'visible' : 'hidden' }} key={retry}>
        <div className="image-compare-after"><img src={resourceContentUrl(props.afterResourceId)} alt={afterLabel} draggable={false} onLoad={event => loaded(1, event.currentTarget)} onError={() => setError(`${afterLabel} image could not be loaded. Check access and retry.`)} /></div>
        <div className="image-compare-before"><img src={resourceContentUrl(props.beforeResourceId)} alt={beforeLabel} draggable={false} onLoad={event => loaded(0, event.currentTarget)} onError={() => setError(`${beforeLabel} image could not be loaded. Check access and retry.`)} /></div>
      </div>}
      {ready && <><span className="image-compare-label image-compare-label-before">{beforeLabel}</span><span className="image-compare-label image-compare-label-after">{afterLabel}</span><div className="image-compare-divider" aria-hidden="true"><span><MoveHorizontal size={18} /></span></div></>}
      {!ready && !error && <p className="image-compare-message" role="status">Loading images…</p>}
      {error && <div className="image-compare-message"><p role="status">{error}</p><button type="button" onClick={() => { setSizes([null, null]); setError(''); setRetry(value => value + 1); }}>Retry images</button></div>}
    </div>
    <div className="image-compare-position"><input ref={slider} type="range" min="0" max="100" step="1" value={view.percent} aria-label="Comparison position" aria-valuetext={`${Math.round(view.percent)}% ${beforeLabel}`} disabled={!ready || view.mode !== 'overlay'} onChange={event => change({ percent: Number(event.target.value) })} /><output aria-hidden="true">{Math.round(view.percent)}%</output></div>
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
  const view = readView(store.get(statePath(props.stateKey)));
  const change = (patch: Partial<View>) => store.set(statePath(props.stateKey), { ...readView(store.get(statePath(props.stateKey))), ...patch });
  return <figure className="image-compare" aria-label={props.title ?? 'Image comparison'}>
    {props.title && props.title !== title && <figcaption>{props.title}</figcaption>}
    <ImagePair key={key} props={props} view={view} change={change} />
  </figure>;
}
export const IMAGE_COMPARE_REGISTRY = {
  ImageCompare: ({ element: { props } }: ComponentRenderProps) => <ImageCompare {...IMAGE_COMPARE_SCHEMAS.ImageCompare.parse(props)} />,
} satisfies ComponentRegistry;
