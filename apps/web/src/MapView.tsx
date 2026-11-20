import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ArrowLeft, ArrowRight, MapPin, MessageSquare } from 'lucide-react';
import { mapData } from '../../../packages/ui-catalog/workflow';
import { ArtifactTitle, inputPath, mapActionPayload, statePath, useTaskAction } from './task-context';
import { readMotionPolicy, observeMotionPolicy } from './motion-policy';
import './map-view.css';

export function MapView({ element: { props } }: ComponentRenderProps) {
  const store = useStateStore(), title = useContext(ArtifactTitle), action = useTaskAction();
  const raw = typeof props.dataBinding === 'string' ? store.get(inputPath(props.dataBinding)) : undefined;
  const parsed = useMemo(() => mapData.safeParse(raw), [raw]);
  const points = parsed.success ? parsed.data.points : [];
  const saved = store.get(statePath(props.stateKey));
  const index = Math.max(0, points.findIndex(point => point.id === saved));
  const selected = points[index], hasCarousel = Boolean(selected);
  const [localTheme, setLocalTheme] = useState<string>();
  const [shellTheme, setShellTheme] = useState(() => document.documentElement.dataset.theme);
  useEffect(() => {
    const sync = () => setShellTheme(document.documentElement.dataset.theme);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
    return () => observer.disconnect();
  }, []);
  const storedTheme = typeof props.themeStateKey === 'string' ? store.get(statePath(props.themeStateKey)) : localTheme;
  const theme = ['paper', 'terrain', 'night'].includes(String(storedTheme)) ? String(storedTheme) : shellTheme === 'dark' ? 'night' : 'paper';
  const [feedback, setFeedback] = useState('');
  const carousel = useRef<HTMLDivElement>(null), userScrolling = useRef(false);
  const selectionIntent = useRef<{ id: string; smooth: boolean; entry: 'pin' | 'adjacent' } | undefined>(undefined), aligned = useRef(false);
  useEffect(() => {
    if (selected && saved !== selected.id) queueMicrotask(() => { if (!points.some(point => point.id === store.get(statePath(props.stateKey)))) store.set(statePath(props.stateKey), selected.id); });
  }, [selected?.id, saved, store, props.stateKey, points]);
  useLayoutEffect(() => {
    const container = carousel.current;
    if (!container) return;
    const align = (animate = false) => {
      if (!container.clientWidth || userScrolling.current) return;
      container.scrollTo({ left: index * container.clientWidth, behavior: animate && readMotionPolicy() === 'full' ? 'smooth' : 'instant' });
    };
    const intent = selectionIntent.current;
    align(Boolean(aligned.current && intent?.smooth && intent.id === selected?.id));
    aligned.current = true; selectionIntent.current = undefined;
    let width = container.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== container.clientWidth) { width = container.clientWidth; align(); } });
    observer.observe(container);
    // An effective-policy change cancels an in-flight programmatic glide.
    const unsubscribe = observeMotionPolicy(() => { if (readMotionPolicy() !== 'full') { userScrolling.current = false; container.scrollTo({ left: index * container.clientWidth, behavior: 'instant' }); } });
    return () => { observer.disconnect(); unsubscribe(); };
  }, [index, hasCarousel]);
  const section = useRef<HTMLElement>(null), revealEntry = useRef<'pin' | 'adjacent' | undefined>(undefined);
  useLayoutEffect(() => {
    const entry = revealEntry.current; revealEntry.current = undefined;
    if (!entry || readMotionPolicy() !== 'full' || !section.current) return;
    const targets: HTMLElement[] = [];
    if (entry === 'pin') {
      const pin = section.current.querySelector<HTMLElement>('.task-map-point.is-selected');
      if (pin) { pin.dataset.pinEntry = ''; targets.push(pin); }
    }
    const card = section.current.querySelector<HTMLElement>('.task-map-place:not([inert])');
    if (card) { card.dataset.cardEntry = ''; targets.push(card); }
    const clear = () => targets.forEach(target => { delete target.dataset.pinEntry; delete target.dataset.cardEntry; });
    const timer = setTimeout(clear, 600);
    return () => { clearTimeout(timer); clear(); };
  }, [selected?.id]);
  // Route accent entries are committed per ordered point-pair key: only a pair
  // the renderer has never seen earns a single 180ms draw over its own segment.
  const routes = parsed.success ? parsed.data.routes ?? [] : [];
  const routeReveal = useRef<Map<string, { key: string; points: string }> | null>(null);
  const [reveals, setReveals] = useState<{ key: string; points: string }[]>([]);
  const routesKey = JSON.stringify(routes.map(route => [route.id, route.pointIds]));
  useLayoutEffect(() => {
    const pairs = new Map<string, { key: string; points: string }>();
    for (const route of routes) for (let i = 0; i < route.pointIds.length - 1; i += 1) {
      const a = points.find(point => point.id === route.pointIds[i]), b = points.find(point => point.id === route.pointIds[i + 1]);
      if (a && b) pairs.set(`${route.id}|${a.id}>${b.id}`, { key: `${route.id}|${a.id}>${b.id}`, points: `${a.x * 10},${a.y * 5.2} ${b.x * 10},${b.y * 5.2}` });
    }
    if (routeReveal.current === null) { routeReveal.current = pairs; return; }
    const seen = routeReveal.current;
    const fresh = [...pairs.entries()].filter(([key]) => !seen.has(key)).map(([, segment]) => segment);
    pairs.forEach((segment, key) => seen.set(key, segment));
    if (fresh.length && readMotionPolicy() === 'full') setReveals(fresh);
  }, [routesKey]);
  useEffect(() => {
    if (!reveals.length) return;
    const timer = setTimeout(() => setReveals([]), 600);
    return () => clearTimeout(timer);
  }, [reveals]);
  if (!parsed.success || !selected) return <p className="task-unavailable">Map points are unavailable from the connected source.</p>;
  const choose = (next: number, origin: 'pin' | 'previous' | 'next' | 'keyboard') => {
    userScrolling.current = false;
    const targetIndex = ((next % points.length) + points.length) % points.length, point = points[targetIndex];
    // Pointer Previous/Next may glide one adjacent card; wraparound, pins and
    // keyboard land on the target immediately.
    const smooth = (origin === 'previous' || origin === 'next') && Math.abs(targetIndex - index) === 1;
    selectionIntent.current = { id: point.id, smooth, entry: origin === 'pin' ? 'pin' : 'adjacent' };
    if (origin === 'pin') revealEntry.current = 'pin';
    else if (smooth) revealEntry.current = 'adjacent';
    store.set(statePath(props.stateKey), point.id);
  };
  const finishScroll = () => { const area = carousel.current; if (!area?.clientWidth) return;const point=points[Math.round(area.scrollLeft / area.clientWidth)];if(point)store.set(statePath(props.stateKey),point.id);userScrolling.current=false; };
  const haltScroll = () => { const area = carousel.current; userScrolling.current = true; if (area?.clientWidth) area.scrollTo({ left: area.scrollLeft, behavior: 'instant' }); };
  const carouselKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const count = points.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); choose(index + (event.key === 'ArrowRight' ? 1 : -1), 'keyboard'); }
    else if (event.key === 'Home') { event.preventDefault(); choose(0, 'keyboard'); }
    else if (event.key === 'End') { event.preventDefault(); choose(count - 1, 'keyboard'); }
    else if (['PageUp', 'PageDown', ' '].includes(event.key)) userScrolling.current = true;
  };
  return <section ref={section} className="task-map" data-map-theme={theme} aria-label={String(props.label ?? 'Places and route')}>
    <header className="task-map-heading">{props.label && props.label !== title ? <h4>{String(props.label)}</h4> : <span>Places along the route</span>}<div className="task-map-themes" role="group" aria-label="Map style">{['paper', 'terrain', 'night'].map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => props.themeStateKey ? store.set(statePath(props.themeStateKey), value) : setLocalTheme(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></header>
    <div className="task-map-plan">
      <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true" className="task-map-vector">
        <rect width="1000" height="520" className="map-land" />
        <path d="M-20 350 C140 250 230 410 390 330 S620 230 700 300 S890 440 1050 300 L1050 590 L-20 590Z" className="map-park" />
        <path d="M780 -30 C680 100 900 175 800 300 S700 450 850 550" className="map-water" />
        <g className="map-blocks">{[[60, 35, 140, 70], [260, 30, 155, 105], [460, 40, 170, 80], [70, 175, 130, 95], [275, 190, 125, 90], [455, 180, 165, 85], [80, 400, 145, 75], [300, 410, 145, 75], [520, 385, 130, 90], [880, 55, 85, 90], [865, 210, 110, 105]].map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} rx="9" />)}</g>
        <g className="map-streets"><path d="M0 145 L720 145 L1000 190 M0 310 L710 310 M225 0 L225 520 M435 0 L435 520 M675 0 L675 520 M0 385 L670 385" /><path d="M-20 20 L680 500 M-20 485 L700 40" /></g>
        {parsed.data.routes?.map(route => <polyline key={route.id} className="task-map-route" points={route.pointIds.map(id => { const point = points.find(point => point.id === id)!; return `${point.x * 10},${point.y * 5.2}`; }).join(' ')}><title>{route.label ?? 'Route'}</title></polyline>)}
        <g aria-hidden="true">{reveals.map(segment => <polyline key={segment.key} className="task-map-route task-map-route-accent" pathLength={1} points={segment.points} />)}</g>
      </svg>
      <div className="task-map-points" role="group" aria-label="Map points">{points.map((point, pointIndex) => <button type="button" key={point.id} className={`task-map-point ${selected.id === point.id ? 'is-selected' : ''}`} aria-label={`Select ${point.label}`} aria-pressed={selected.id === point.id} style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => choose(pointIndex, 'pin')}><MapPin size={18} fill="currentColor" /><span className="task-map-point-label">{point.label}</span></button>)}</div>
    </div>
    <div className="task-map-meta"><span className="task-map-meta-category">{selected.category ?? 'Place'}</span><span className="task-map-meta-count">{index + 1} / {points.length}</span><span className="task-map-meta-nav"><button type="button" className="icon-button" aria-label="Previous place" disabled={points.length === 1} onClick={event => choose(index - 1, event.detail > 0 ? 'previous' : 'keyboard')}><ArrowLeft size={15} /></button><button type="button" className="icon-button" aria-label="Next place" disabled={points.length === 1} onClick={event => choose(index + 1, event.detail > 0 ? 'next' : 'keyboard')}><ArrowRight size={15} /></button></span></div>
    <div className="task-map-carousel" ref={carousel} tabIndex={0} aria-label="Place carousel" onPointerDown={haltScroll} onKeyDown={carouselKeys} onWheel={haltScroll} onScrollEnd={() => { if (userScrolling.current) finishScroll(); }} onScroll={event => { if (!userScrolling.current || !event.currentTarget.clientWidth) return; const next = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth); if (points[next] && next !== index) store.set(statePath(props.stateKey), points[next].id); }}>
      {points.map((point, pointIndex) => <div key={point.id} className="task-map-place" role={pointIndex === index ? 'region' : undefined} aria-label={pointIndex === index ? 'Selected place' : undefined} aria-hidden={pointIndex !== index} inert={pointIndex !== index}><h4>{point.label}</h4>{(point.address || point.detail) && <details className="task-map-place-details"><summary>Place details</summary>{point.address && <small>{point.address}</small>}{point.detail && <p>{point.detail}</p>}</details>}</div>)}
    </div>
    <footer className="task-map-footer">{Boolean(props.feedbackActionId) && <button type="button" className="quiet" disabled={action.busy} onClick={() => { const point = selected; void action.run(String(props.feedbackActionId), { ...mapActionPayload(props, store.getSnapshot().values), pointId: point.id }).then(accepted => { if (accepted) setFeedback(`Feedback requested for ${point.label}.`); }); }}><MessageSquare size={13} />{action.busy ? 'Sending request…' : 'Send feedback request'}</button>}</footer>
    {action.error && <p className="error-text" role="status">{action.error}</p>}{feedback && <p className="task-map-feedback" role="status">{feedback}</p>}
    {parsed.data.source && <details className="task-map-source"><summary>Source</summary><p>{parsed.data.source}</p></details>}
  </section>;
}
