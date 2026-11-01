import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ArrowLeft, ArrowRight, MapPin, MessageSquare } from 'lucide-react';
import { mapData } from '../../../packages/ui-catalog/workflow';
import { ArtifactTitle, inputPath, mapActionPayload, statePath, useTaskAction } from './task-context';
import { reducedMotion } from './task-motion';
import './map-view.css';

export function MapView({ element: { props } }: ComponentRenderProps) {
  const store = useStateStore(), title = useContext(ArtifactTitle), action = useTaskAction();
  const raw = typeof props.dataBinding === 'string' ? store.get(inputPath(props.dataBinding)) : undefined;
  const parsed = useMemo(() => mapData.safeParse(raw), [raw]);
  const points = parsed.success ? parsed.data.points : [];
  const saved = store.get(statePath(props.stateKey));
  const index = Math.max(0, points.findIndex(point => point.id === saved));
  const selected = points[index];
  const [localTheme, setLocalTheme] = useState('paper');
  const storedTheme = typeof props.themeStateKey === 'string' ? store.get(statePath(props.themeStateKey)) : localTheme;
  const theme = ['paper', 'terrain', 'night'].includes(String(storedTheme)) ? String(storedTheme) : 'paper';
  const [feedback, setFeedback] = useState('');
  const carousel = useRef<HTMLDivElement>(null), userScrolling = useRef(false);
  const selectionIntent=useRef<string|undefined>(undefined),aligned=useRef(false);
  useEffect(() => {
    if (selected && saved !== selected.id) queueMicrotask(() => { if (!points.some(point => point.id === store.get(statePath(props.stateKey)))) store.set(statePath(props.stateKey), selected.id); });
  }, [selected?.id, saved, store, props.stateKey, points]);
  useLayoutEffect(() => {
    const container = carousel.current;
    if (!container) return;
    const align = (animate=false) => {
      if (!container.clientWidth || userScrolling.current) return;
      container.scrollTo({ left: index * container.clientWidth, behavior: animate&&!reducedMotion() ? 'smooth' : 'instant' });
    };
    align(aligned.current&&selectionIntent.current===selected?.id);aligned.current=true;selectionIntent.current=undefined;
    let width=container.clientWidth;const observer = new ResizeObserver(()=>{if(width!==container.clientWidth){width=container.clientWidth;align();}}); observer.observe(container);
    return () => observer.disconnect();
  }, [index]);
  if (!parsed.success || !selected) return <p className="task-unavailable">Map points are unavailable from the connected source.</p>;
  const choose = (next: number) => { userScrolling.current = false;const point=points[(next + points.length) % points.length];selectionIntent.current=point.id;store.set(statePath(props.stateKey), point.id); };
  const finishScroll = () => { const area = carousel.current; if (!area?.clientWidth) return;const point=points[Math.round(area.scrollLeft / area.clientWidth)];if(point)store.set(statePath(props.stateKey),point.id);userScrolling.current=false; };
  return <section className="task-map" data-map-theme={theme} aria-label={String(props.label ?? 'Places and route')}>
    <header className="task-map-heading">{props.label && props.label !== title ? <h4>{String(props.label)}</h4> : <span>Places along the route</span>}<div className="task-map-themes" role="group" aria-label="Map style">{['paper', 'terrain', 'night'].map(value => <button type="button" key={value} aria-pressed={theme === value} onClick={() => props.themeStateKey ? store.set(statePath(props.themeStateKey), value) : setLocalTheme(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></header>
    <div className="task-map-plan">
      <svg viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true" className="task-map-vector">
        <rect width="1000" height="520" className="map-land" />
        <path d="M-20 350 C140 250 230 410 390 330 S620 230 700 300 S890 440 1050 300 L1050 590 L-20 590Z" className="map-park" />
        <path d="M780 -30 C680 100 900 175 800 300 S700 450 850 550" className="map-water" />
        <g className="map-blocks">{[[60, 35, 140, 70], [260, 30, 155, 105], [460, 40, 170, 80], [70, 175, 130, 95], [275, 190, 125, 90], [455, 180, 165, 85], [80, 400, 145, 75], [300, 410, 145, 75], [520, 385, 130, 90], [880, 55, 85, 90], [865, 210, 110, 105]].map(([x, y, width, height], index) => <rect key={index} x={x} y={y} width={width} height={height} rx="9" />)}</g>
        <g className="map-streets"><path d="M0 145 L720 145 L1000 190 M0 310 L710 310 M225 0 L225 520 M435 0 L435 520 M675 0 L675 520 M0 385 L670 385" /><path d="M-20 20 L680 500 M-20 485 L700 40" /></g>
        {parsed.data.routes?.map(route => <polyline key={route.id} className="task-map-route" pathLength={1} points={route.pointIds.map(id => { const point = points.find(point => point.id === id)!; return `${point.x * 10},${point.y * 5.2}`; }).join(' ')}><title>{route.label ?? 'Route'}</title></polyline>)}
      </svg>
      <div className="task-map-points" role="group" aria-label="Map points">{points.map((point, pointIndex) => <button type="button" key={point.id} className={`task-map-point ${selected.id === point.id ? 'is-selected' : ''}`} aria-label={`Select ${point.label}`} aria-pressed={selected.id === point.id} style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => choose(pointIndex)}><MapPin size={18} fill="currentColor" /><span className="task-map-point-label">{point.label}</span></button>)}</div>
    </div>
    <div className="task-map-carousel" ref={carousel} tabIndex={0} aria-label="Place carousel" onPointerDown={() => { userScrolling.current = true; }} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown',' '].includes(event.key))userScrolling.current=true;}} onWheel={() => { userScrolling.current = true; }} onScrollEnd={() => { if (userScrolling.current) finishScroll(); }} onScroll={event => { if (!userScrolling.current || !event.currentTarget.clientWidth) return; const next = Math.round(event.currentTarget.scrollLeft / event.currentTarget.clientWidth); if (points[next] && next !== index) store.set(statePath(props.stateKey), points[next].id); }}>
      {points.map((point, pointIndex) => <div key={point.id} className="task-map-place" role={pointIndex === index ? 'region' : undefined} aria-label={pointIndex === index ? 'Selected place' : undefined} aria-hidden={pointIndex !== index} inert={pointIndex !== index}><span className="task-map-category">{point.category ?? 'Place'}<span>{pointIndex + 1} / {points.length}</span></span><h4>{point.label}</h4>{(point.address || point.detail) && <details className="task-map-place-details"><summary>Place details</summary>{point.address && <small>{point.address}</small>}{point.detail && <p>{point.detail}</p>}</details>}</div>)}
    </div>
    <footer className="task-map-footer"><div className="task-map-navigation"><button type="button" className="icon-button" aria-label="Previous place" onClick={() => choose(index - 1)}><ArrowLeft size={15} /></button><div className="task-map-dots" aria-hidden="true">{points.map(point => <span key={point.id} className={point.id === selected.id ? 'is-selected' : ''} />)}</div><button type="button" className="icon-button" aria-label="Next place" onClick={() => choose(index + 1)}><ArrowRight size={15} /></button></div>{Boolean(props.feedbackActionId) && <button type="button" className="quiet" disabled={action.busy} onClick={() => { const point = selected; void action.run(String(props.feedbackActionId), { ...mapActionPayload(props, store.getSnapshot().values), pointId: point.id }).then(accepted => { if (accepted) setFeedback(`Feedback requested for ${point.label}.`); }); }}><MessageSquare size={13} />{action.busy ? 'Sending request…' : 'Send feedback request'}</button>}</footer>
    {action.error && <p className="error-text" role="alert">{action.error}</p>}{feedback && <p className="task-map-feedback" role="status">{feedback}</p>}
    {parsed.data.source && <details className="task-map-source"><summary>Source</summary><p>{parsed.data.source}</p></details>}
  </section>;
}
