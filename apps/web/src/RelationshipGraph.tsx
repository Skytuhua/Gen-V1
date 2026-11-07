import { Children, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { RefObject } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ArrowRight } from 'lucide-react';
import { relationshipData, type RelationshipData } from '../../../packages/ui-catalog/workflow';
import { ArtifactInline, ArtifactTitle, inputPath, statePath } from './task-context';
import { animateTask, MotionRegion, reducedMotion, TASK_MOTION } from './task-motion';
import { StatusIcon } from './task-status';
import {Popover} from '../../../packages/ui-shell/Popover';
import {createThreadHoverInteraction} from './thread-hover/interaction';
import './relationship-graph.css';

type SourceNode = RelationshipData['nodes'][number];
type Tone = NonNullable<SourceNode['tone']>;
const ROW_HEIGHT = 34, LANE_HEIGHT = 48, HORIZONTAL_INSET = 38;
type Position = { x: number; y: number };
type Geometry = { positions: Map<string, Position>; labels: Map<string, Position>; width: number; height: number; opacity?: Map<string, number> };
function graphPath(a: Position, b: Position, horizontal: boolean) {
  return horizontal ? `M${a.x},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x},${b.y}` : `M${a.x},${a.y} C${a.x},${(a.y + b.y) / 2} ${b.x},${(a.y + b.y) / 2} ${b.x},${b.y}`;
}
// A gently damped local layout spring retains velocity when a source update
// changes direction. Nodes, labels and paths consume the very same sample.
function spring(value: number, velocity: number, target: number, dt: number) {
  const frequency = 24, damping = .9, decay = Math.exp(-damping * frequency * dt), wave = frequency * Math.sqrt(1 - damping * damping), displacement = value - target;
  const cosine = Math.cos(wave * dt), sine = Math.sin(wave * dt);
  return { value: target + decay * (displacement * cosine + (velocity + damping * frequency * displacement) / wave * sine), velocity: decay * (velocity * cosine - (damping * frequency * velocity + frequency * frequency * displacement) / wave * sine) };
}
function useGraphGeometry(target: Geometry, key: string, surface: RefObject<HTMLElement | null>, horizontal: boolean) {
  const [, commitGeometry] = useState(target), current = useRef(target), previousKey = useRef(key);
  const velocity = useRef<Geometry>({ positions: new Map(), labels: new Map(), width: 0, height: 0, opacity: new Map() });
  useLayoutEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    const element = surface.current; if (!element) return;
    const body = element.querySelector<HTMLElement>('.task-graph-body')!, lines = element.querySelector<SVGElement>('.task-graph-lines')!;
    const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-node-id]')).map(row => ({ row, dot: row.querySelector<HTMLElement>('.task-graph-dot')!, id: row.dataset.nodeId! }));
    const paths = Array.from(lines.querySelectorAll<SVGPathElement>('.graph-edge')).map(path => ({ path, from: path.dataset.from!, to: path.dataset.to! }));
    const labels = Array.from(element.querySelectorAll<HTMLElement>('[data-branch-id]'));
    const paint = (geometry: Geometry) => {
      body.style.height = `${Math.max(0, geometry.height)}px`;
      if (horizontal) body.style.width = `${Math.max(0, geometry.width)}px`; else { body.style.removeProperty('width'); element.style.setProperty('--graph-rail-width', `${geometry.width}px`); }
      lines.setAttribute('width', String(Math.max(0, geometry.width))); lines.setAttribute('height', String(Math.max(0, geometry.height)));
      for (const { row, dot, id } of rows) {
        const point = geometry.positions.get(id) ?? target.positions.get(id)!;
        row.style.transform = horizontal ? `translate3d(${point.x}px,${point.y}px,0) translateX(-50%)` : `translate3d(0,${point.y - ROW_HEIGHT / 2}px,0)`;
        row.style.opacity = String(Math.min(1, Math.max(0, geometry.opacity?.get(id) ?? (geometry.positions.has(id) ? 1 : 0))));
        if (horizontal) dot.style.removeProperty('left'); else dot.style.left = `${point.x}px`;
      }
      for (const { path, from, to } of paths) path.setAttribute('d', graphPath(geometry.positions.get(from) ?? target.positions.get(from)!, geometry.positions.get(to) ?? target.positions.get(to)!, horizontal));
      for (const label of labels) { const point = geometry.labels.get(label.dataset.branchId!) ?? target.labels.get(label.dataset.branchId!)!; label.style.left = `${point.x}px`; label.style.top = `${point.y}px`; }
      if (element.querySelector('[data-graph-tooltip-active]')) element.dispatchEvent(new Event('task-graph-layout'));
    };
    let frame = 0, finished = false, last = performance.now(); const started = last;
    const finish = () => {
      if (finished) return; finished = true; cancelAnimationFrame(frame); current.current = target;
      velocity.current = { positions: new Map(), labels: new Map(), width: 0, height: 0, opacity: new Map() };
      paint(target); commitGeometry(target);
    };
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const changedPreference = () => { if (preference.matches) finish(); }; preference.addEventListener('change', changedPreference);
    paint(current.current);
    if (preference.matches || !current.current.positions.size) { finish(); return () => preference.removeEventListener('change', changedPreference); }
    const advance = (now: number) => {
      if (finished) return;
      if (now - started > 900 || document.visibilityState === 'hidden') { finish(); return; }
      const dt = Math.min(.032, Math.max(0, (now - last) / 1000)); last = now;
      const before = current.current, speed = velocity.current; let moving = false;
      const sample = (value: number, v: number, destination: number, epsilon = .15) => { const next = spring(value, v, destination, dt); if (Math.abs(next.value - destination) > epsilon || Math.abs(next.velocity) > epsilon * 16) moving = true; return next; };
      const width = sample(before.width, speed.width, target.width), height = sample(before.height, speed.height, target.height);
      const positions = new Map<string, Position>(), positionSpeed = new Map<string, Position>(), opacity = new Map<string, number>(), opacitySpeed = new Map<string, number>();
      for (const [id, destination] of target.positions) {
        const origin = before.positions.get(id) ?? destination, oldSpeed = speed.positions.get(id) ?? { x: 0, y: 0 };
        const x = sample(origin.x, oldSpeed.x, destination.x), y = sample(origin.y, oldSpeed.y, destination.y);
        const alpha = sample(before.opacity?.get(id) ?? (before.positions.has(id) ? 1 : 0), speed.opacity?.get(id) ?? 0, 1, .002);
        positions.set(id, { x: x.value, y: y.value }); positionSpeed.set(id, { x: x.velocity, y: y.velocity }); opacity.set(id, alpha.value); opacitySpeed.set(id, alpha.velocity);
      }
      const labelPositions = new Map<string, Position>(), labelSpeed = new Map<string, Position>();
      for (const [id, destination] of target.labels) {
        const origin = before.labels.get(id) ?? destination, oldSpeed = speed.labels.get(id) ?? { x: 0, y: 0 }, x = sample(origin.x, oldSpeed.x, destination.x), y = sample(origin.y, oldSpeed.y, destination.y);
        labelPositions.set(id, { x: x.value, y: y.value }); labelSpeed.set(id, { x: x.velocity, y: y.velocity });
      }
      current.current = { positions, labels: labelPositions, width: width.value, height: height.value, opacity };
      velocity.current = { positions: positionSpeed, labels: labelSpeed, width: width.velocity, height: height.velocity, opacity: opacitySpeed };
      paint(current.current);
      if (moving) frame = requestAnimationFrame(advance); else finish();
    };
    frame = requestAnimationFrame(advance);
    return () => { finished = true; cancelAnimationFrame(frame); preference.removeEventListener('change', changedPreference); };
  }, [key]);
  return current.current;
}

const tooltipOwnerBlocked = (element: HTMLElement) => Boolean(element.closest('[inert], [hidden], [aria-hidden="true"]')) || element.matches(':disabled');
function GraphTooltip({ id, children, wide = false, compact = false }: { id: string; children: ReactNode; wide?: boolean; compact?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null), anchor = useRef<HTMLElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [present, setPresent] = useState(false), [body, setBody] = useState<HTMLDivElement | null>(null), [height, setHeight] = useState(260), [layoutRevision, setLayoutRevision] = useState(0);
  const ownerAvailable = Boolean(anchor.current && !tooltipOwnerBlocked(anchor.current)), visible = open && ownerAvailable;
  const shown = useRef(visible); shown.current = visible;
  const interaction = useMemo(() => createThreadHoverInteraction(setOpen), []);
  useEffect(() => () => interaction.dispose(), [interaction]);
  useLayoutEffect(() => {
    const element = marker.current!.parentElement!; anchor.current = element;
    const allowed = () => {const blocked = tooltipOwnerBlocked(element); interaction.setBlocked(blocked); return !blocked;};
    const enter = () => {if (allowed()) interaction.pointerEnter('trigger');}, leave = () => interaction.pointerLeave('trigger');
    const focus = () => {if (allowed()) interaction.focus(true);}, blur = (event: FocusEvent) => {if (!popup.current?.contains(event.relatedTarget as Node | null)) interaction.focus(false);};
    const key = (event: KeyboardEvent) => {
      if (!shown.current || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); interaction.dismiss();}
      else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {event.preventDefault(); popup.current?.scrollBy({top:(event.key.endsWith('Down') ? 1 : -1) * (event.key.startsWith('Page') ? 180 : 40)});}
    };
    const move = () => {if (shown.current) setLayoutRevision(value => value + 1);};
    const graph = element.closest('.task-graph'); graph?.addEventListener('task-graph-layout', move);
    element.addEventListener('mouseenter', enter); element.addEventListener('mouseleave', leave); element.addEventListener('focus', focus); element.addEventListener('blur', blur); element.addEventListener('keydown', key);
    return () => {graph?.removeEventListener('task-graph-layout', move); element.removeEventListener('mouseenter', enter); element.removeEventListener('mouseleave', leave); element.removeEventListener('focus', focus); element.removeEventListener('blur', blur); element.removeEventListener('keydown', key);};
  }, [interaction]);
  useLayoutEffect(() => {marker.current?.toggleAttribute('data-graph-tooltip-active', visible);}, [visible]);
  useLayoutEffect(() => {
    if (visible) {setPresent(true); return;}
    const animations = popup.current?.getAnimations() ?? [];
    if (!animations.length) {setPresent(false); return;}
    let current = true;
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {if (current) setPresent(false);});
    return () => {current = false;};
  }, [visible]);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const element = anchor.current, synchronize = () => interaction.setBlocked(tooltipOwnerBlocked(element));
    synchronize();
    const observer = new MutationObserver(synchronize);
    for (let owner: HTMLElement | null = element; owner; owner = owner.parentElement) observer.observe(owner, {attributes:true, attributeFilter:['inert','hidden','aria-hidden','disabled']});
    return () => observer.disconnect();
  }, [open, interaction]);

  useLayoutEffect(() => {
    if (!visible || !body) return;
    const measure = () => setHeight(Math.min(420, body.offsetHeight + (compact ? 16 : 28)));
    measure(); const observer = new ResizeObserver(measure); observer.observe(body);
    return () => observer.disconnect();
  }, [visible, body, compact]);
  return <><span ref={marker} aria-hidden="true" /><Popover anchor={anchor} contentRef={popup} open={visible} present={ownerAvailable && (visible || present)} width={compact ? 320 : wide ? 480 : 420} height={height} layoutRevision={layoutRevision} align="start" preferredSide="below"
    role="tooltip" id={id} className={`task-node-popover ${compact ? 'task-check-popover' : ''}`} onDismiss={() => interaction.dismiss()}
    onPointerEnter={() => interaction.pointerEnter('card')} onPointerLeave={() => interaction.pointerLeave('card')}>
    <div ref={setBody} className="task-node-details">{children}</div>
  </Popover></>;
}

function Excerpts({ node }: { node: SourceNode }) {
  return <>{node.detail && <span className="task-node-context-detail">{node.detail}</span>}{node.excerpts?.length ? <span className="task-node-excerpts">{node.excerpts.map((excerpt, index) => <span key={index}><small>{excerpt.label}</small><code>{excerpt.text}</code></span>)}</span> : null}</>;
}
function NodeContext({ node, related, id }: { node: SourceNode; related: string[]; id: string }) {
  return <GraphTooltip id={id}><strong>{node.label}</strong>{(node.hash || node.author || node.time) && <span className="task-node-context-meta">{node.hash && <code>{node.hash}</code>}{node.author}{node.time}</span>}<Excerpts node={node} />
    {node.conflictCount !== undefined && <span>{node.conflictCount} source conflicts</span>}
    {node.checks?.map((check, index) => <span key={index} className={`task-node-check status-${check.status}`}><StatusIcon status={check.status} /><span>{check.label}{check.detail && <small>{check.detail}</small>}</span></span>)}
    {related.length > 0 && <small className="task-node-context-detail">{related.join(' · ')}</small>}
  </GraphTooltip>;
}

export function RelationshipGraph({ element: { props }, children }: ComponentRenderProps) {
  const store = useStateStore(), artifactTitle = useContext(ArtifactTitle), id = useId();
  const inline = useContext(ArtifactInline);
  const parsed = relationshipData.safeParse(typeof props.dataBinding === 'string' ? store.get(inputPath(props.dataBinding)) : { nodes: props.nodes, edges: props.edges });
  const viewport = useRef<HTMLDivElement>(null), summaryElement = useRef<HTMLDivElement>(null), surface = useRef<HTMLElement>(null);
  const previousSummary = useRef('');
  const [availableWidth, setAvailableWidth] = useState(540);
  const geometryKey = parsed.success ? JSON.stringify(parsed.data.nodes.map(node => [node.id, node.lane, node.column])) : '';
  const summaryKey = parsed.success && parsed.data.summary ? `${parsed.data.summary.label}:${parsed.data.summary.status}` : '';
  const data = parsed.success ? parsed.data : undefined, nodes = data?.nodes ?? [], edges = data?.edges ?? [];
  const horizontal = props.orientation === 'horizontal', schematic = horizontal && Boolean(data?.branchLabels?.length);
  const lanes = Math.max(0, ...nodes.map(node => node.lane ?? 0)) + 1, rail = Math.max(56, 22 + lanes * 18);
  const maxColumn = Math.max(1, ...nodes.map((node, index) => node.column ?? index), ...(data?.branchLabels?.map(branch => branch.column) ?? []));
  const horizontalWidth = inline ? Math.max(160, availableWidth) : Math.max(460, availableWidth, HORIZONTAL_INSET * 2 + maxColumn * 60);
  const capacity = inline ? Math.max(1, Math.floor((horizontalWidth - 4) / 160)) : maxColumn + 1;
  const laneHeight = inline && !schematic ? 110 : LANE_HEIGHT, bandHeight = lanes * laneHeight + (schematic ? 60 : 78);
  const step = inline ? capacity > 1 ? (horizontalWidth - 164) / (capacity - 1) : 0 : (horizontalWidth - HORIZONTAL_INSET * 2) / maxColumn;
  const position = (column: number, lane: number) => inline
    ? { x: capacity === 1 ? horizontalWidth / 2 : 82 + column % capacity * step, y: 34 + lane * laneHeight + Math.floor(column / capacity) * bandHeight }
    : { x: HORIZONTAL_INSET + column * step, y: 34 + lane * LANE_HEIGHT };
  const targetPositions = new Map(nodes.map((node, index) => [node.id, horizontal ? position(node.column ?? index, node.lane ?? 0) : { x: 16 + (node.lane ?? 0) * 18, y: index * ROW_HEIGHT + ROW_HEIGHT / 2 }]));
  const targetLabels = new Map((data?.branchLabels ?? []).map((branch, index) => { const point = position(branch.column, branch.lane); return [`${branch.label}-${index}`, { x: point.x, y: point.y + (branch.lane === 0 ? -24 : 13) }]; }));
  const target = { positions: targetPositions, labels: targetLabels, width: horizontal ? horizontalWidth : rail, height: horizontal ? inline ? (Math.floor(maxColumn / capacity) + 1) * bandHeight : lanes * LANE_HEIGHT + (schematic ? 42 : 78) : nodes.length * ROW_HEIGHT };
  const geometry = useGraphGeometry(target, `${inline}:${props.orientation}:${geometryKey}:${horizontal ? horizontalWidth : rail}:${JSON.stringify(data?.branchLabels)}:${JSON.stringify(edges.map(edge => [edge.from, edge.to]))}`, surface, horizontal);
  const acceptedChecks = data?.checks ?? [], checksKey = JSON.stringify(acceptedChecks);
  const [checkView, setCheckView] = useState({ items: acceptedChecks, leaving: false });
  useLayoutEffect(() => {
    if (acceptedChecks.length) { setCheckView({ items: acceptedChecks, leaving: false }); return; }
    if (!checkView.items.length) return;
    if (reducedMotion()) { setCheckView({ items: [], leaving: false }); return; }
    setCheckView(previous => ({ ...previous, leaving: true }));
    const timer = setTimeout(() => setCheckView({ items: [], leaving: false }), TASK_MOTION.status);
    return () => clearTimeout(timer);
  }, [checksKey]);
  const [mergePulse, setMergePulse] = useState(false), previousTone = useRef(data?.tone);
  useLayoutEffect(() => {
    const entering = previousTone.current !== 'merged' && data?.tone === 'merged'; previousTone.current = data?.tone;
    if (!entering || reducedMotion()) return;
    setMergePulse(true); const timer = setTimeout(() => setMergePulse(false), 760);
    return () => clearTimeout(timer);
  }, [data?.tone]);
  useLayoutEffect(() => {
    const area = viewport.current; if (!area) return;
    const measure = () => { if (area.clientWidth) setAvailableWidth(area.clientWidth); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(area);
    return () => observer.disconnect();
  }, [parsed.success]);
  useLayoutEffect(() => {
    if (summaryKey && previousSummary.current && summaryKey !== previousSummary.current) animateTask(summaryElement.current, reducedMotion() ? [{ opacity: .5 }, { opacity: 1 }] : [{ opacity: .5, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], TASK_MOTION.status);
    previousSummary.current = summaryKey;
  }, [summaryKey]);
  if (!parsed.success) return <p className="task-unavailable">Relationship data is unavailable. Connect nodes and edges from a source to inspect them.</p>;
  const { summary, source, branchLabels, tone } = parsed.data;
  const selected = typeof props.stateKey === 'string' ? store.get(statePath(props.stateKey)) : undefined;
  const positions = new Map(nodes.map(node => [node.id, geometry.positions.get(node.id) ?? targetPositions.get(node.id)!]));
  const nodeTone = (node: SourceNode): Tone => { const value = node.tone ?? branchLabels?.find(branch => branch.lane === (node.lane ?? 0))?.tone ?? 'neutral'; return tone === 'merged' && value === 'blue' ? 'purple' : value; };
  const width = geometry.width, height = geometry.height;
  const label = typeof props.label === 'string' ? props.label : 'Relationships';
  const conflicts = nodes.filter(node => (node.conflictCount ?? 0) > 0), conflictCount = conflicts.reduce((total, node) => total + node.conflictCount!, 0);
  const hasActions = Children.count(children) > 0, conflictTip = `${id}-conflicts`;
  return <figure ref={surface} className={`task-graph task-graph-${horizontal ? 'horizontal' : 'vertical'} ${schematic ? 'task-graph-schematic' : ''}`} aria-label={label} data-orientation={horizontal ? 'horizontal' : 'vertical'} data-tone={tone ?? 'neutral'} style={{ '--graph-rail-width': `${horizontal ? rail : geometry.width}px` } as CSSProperties}>
    {label !== artifactTitle && props.label ? <figcaption>{label}</figcaption> : null}
    <div ref={viewport} className="task-graph-viewport" tabIndex={inline ? undefined : 0} aria-label={`${label} graph area`}>
      <div className="task-graph-body" style={{ ...(horizontal ? { width } : {}), height }}>
        <svg className="task-graph-lines" width={width} height={height} aria-hidden="true">{edges.map((edge, index) => {
          const a = positions.get(edge.from)!, b = positions.get(edge.to)!, destination = nodes.find(node => node.id === edge.to)!;
          return <path key={`${edge.from}-${edge.to}-${index}`} d={graphPath(a, b, horizontal)} pathLength={1} data-from={edge.from} data-to={edge.to} data-prospective={edge.prospective || undefined} className={`graph-edge status-${edge.status ?? 'neutral'} tone-${nodeTone(destination)}`} />;
        })}</svg>
        {horizontal && branchLabels?.map((branch, index) => { const branchId = `${branch.label}-${index}`, point = geometry.labels.get(branchId) ?? targetLabels.get(branchId)!; return <span key={branchId} data-branch-id={branchId} className={`task-graph-branch-label tone-${tone === 'merged' && branch.tone === 'blue' ? 'purple' : branch.tone ?? 'neutral'}`} style={{ left: point.x, top: point.y }}>{branch.label}</span>; })}
        <ol>{nodes.map(node => {
          const position = positions.get(node.id)!, status = node.status ?? 'neutral', compact = horizontal && (schematic || node.kind === 'point' || node.kind === 'endpoint');
          const related = edges.filter(edge => edge.from === node.id || edge.to === node.id).map(edge => {
            const other = nodes.find(item => item.id === (edge.from === node.id ? edge.to : edge.from));
            return `${edge.from === node.id ? 'To' : 'From'} ${other?.label}${edge.label ? `: ${edge.label}` : ''}`;
          });
          const tip = `${id}-${encodeURIComponent(node.id)}`, visualTone = nodeTone(node);
          const content = <>
            <span className={`task-graph-dot status-${status} tone-${visualTone}`} style={horizontal ? undefined : { left: position.x }} />
            <span className="task-node-copy"><span className="task-node-label"><span className="task-node-title">{node.label}</span>{node.branch && <span className={`task-node-branch tone-${visualTone}`}>{node.branch}</span>}</span>{node.detail && <small>{node.detail}</small>}</span>
            {node.conflictCount !== undefined && node.conflictCount > 0 && <span className="task-node-conflicts">{node.conflictCount}<span className="sr-only"> conflicts</span></span>}
            {(node.hash || node.author || node.time) && <span className="task-node-meta">{node.hash && <code className="task-node-hash">{node.hash}</code>}{node.author && <span className="task-node-author">{node.author}</span>}{node.time && <span className="task-node-time">{node.time}</span>}</span>}
            <span className={`task-node-status status-${status}`}><StatusIcon status={status} /><span className="sr-only">{status}</span></span>
            {horizontal && node.kind === 'endpoint' && <span className={`task-node-endpoint-label status-${status}`}>{node.label}</span>}
            <NodeContext node={node} related={related} id={tip} />
          </>;
          const className = `task-node ${horizontal ? 'task-node-horizontal' : ''} ${compact ? 'task-node-point' : ''} ${node.dimmed ? 'task-node-dimmed' : ''} ${mergePulse && (visualTone === 'purple' || status === 'merged') ? 'task-node-merge-pulse' : ''}`;
          return <li key={node.id} data-node-id={node.id} data-kind={node.kind ?? 'commit'} className={compact ? 'task-point-position' : undefined} style={{ transform: horizontal ? `translate3d(${position.x}px,${position.y}px,0) translateX(-50%)` : `translate3d(0,${position.y - ROW_HEIGHT / 2}px,0)`, opacity: Math.min(1, Math.max(0, geometry.opacity?.get(node.id) ?? (geometry.positions.has(node.id) ? 1 : 0))) }}>{typeof props.stateKey === 'string' ? <button type="button" className={className} aria-label={node.label} aria-describedby={tip} aria-pressed={selected === node.id} onClick={() => store.set(statePath(props.stateKey), node.id)}>{content}</button> : <div className={className} tabIndex={0} aria-label={node.label} aria-describedby={tip}>{content}</div>}</li>;
        })}</ol>
      </div>
    </div>
    <MotionRegion open={Boolean(checkView.items.length || summary || conflictCount || hasActions)} duration={TASK_MOTION.status} className="task-graph-footer">
      {checkView.items.length ? <div className={`task-graph-checks${checkView.leaving ? ' is-leaving' : ''}`} aria-label="Source check summaries" aria-hidden={checkView.leaving || undefined} inert={checkView.leaving}>{checkView.items.map((check, index) => <span key={check.label} className={`task-graph-check status-${check.status}`} tabIndex={0} style={{ animationDelay: `${index * TASK_MOTION.check}ms` }} aria-describedby={`${id}-check-${index}`}><StatusIcon status={check.status} /><span>{check.label}</span>{check.detail && <GraphTooltip id={`${id}-check-${index}`} compact>{check.detail}</GraphTooltip>}</span>)}</div> : null}
      <div className="task-graph-footer-row">
        {(summary || conflictCount > 0) && <div ref={summaryElement} className={`task-graph-summary status-${summary?.status ?? 'pending'}`} role="status"><StatusIcon status={summary?.status ?? 'pending'} /><span>{conflictCount > 0 ? <button type="button" className="task-graph-conflict-summary" aria-label={`Inspect ${conflictCount} conflicts`} aria-describedby={conflictTip}>{summary?.label ?? `${conflictCount} conflicts`}<GraphTooltip id={conflictTip} wide><strong>{conflictCount} conflicts in the supplied source</strong>{conflicts.slice(0, 4).map(node => <span key={node.id} className="task-conflict-group"><strong>{node.label}</strong><Excerpts node={node} /></span>)}{conflicts.length > 4 && <small>Inspect source for {conflicts.length - 4} more comparisons.</small>}</GraphTooltip></button> : summary?.label}{summary?.detail && <small>{summary.detail}</small>}</span></div>}
        {hasActions && <div className="task-graph-footer-actions">{children}</div>}
      </div>
    </MotionRegion>
    <details className="task-graph-relationships"><summary>Inspect source</summary>{(props.source || source) && <p>{String(props.source ?? source)}</p>}<ul>{edges.map((edge, index) => <li key={`${id}-${index}`}>{nodes.find(node => node.id === edge.from)?.label}<ArrowRight size={11} aria-label="to" />{nodes.find(node => node.id === edge.to)?.label}{edge.label && <small>{edge.label}</small>}{edge.status && <span className={`status-${edge.status}`}>{edge.status}</span>}</li>)}</ul></details>
  </figure>;
}
