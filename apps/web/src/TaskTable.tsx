import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { tableChangesData } from '../../../packages/ui-catalog/workflow';
import { ArtifactInline, ArtifactTitle, inputPath, statePath } from './task-context';
import { animateTask, reducedMotion } from './task-motion';
import { useTableControls } from './TaskTableControls';
import { tableIdentity, tableObject as object, tableText as text } from './task-table-model';
import './task-table.css';

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function visibleBounds(container: HTMLElement, inline: boolean) {
  const bounds = container.getBoundingClientRect(), chat = inline ? container.closest('.conversation-scroll')?.getBoundingClientRect() : null;
  return chat ? { top: Math.max(bounds.top, chat.top), bottom: Math.min(bounds.bottom, chat.bottom), left: Math.max(bounds.left, chat.left), right: Math.min(bounds.right, chat.right) } : bounds;
}

export function Table({ element: { props }, bindings }: ComponentRenderProps) {
  const inline = useContext(ArtifactInline), artifactTitle = useContext(ArtifactTitle);
  const store = useStateStore(), scroll = useRef<HTMLDivElement>(null), sweep = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);
  const followMotion = useRef({ frame: 0, target: null as number | null, velocity: 0, position: 0, time: 0, started: 0 });
  const stopScroll = () => { const motion = followMotion.current; cancelAnimationFrame(motion.frame); motion.frame = 0; motion.target = null; motion.velocity = 0; motion.position = scroll.current?.scrollTop ?? 0; };
  const takeOver = () => { if (inline) return; stopScroll(); setFollowing(false); };
  const rows = array(typeof props.rowsBinding === 'string' ? store.get(inputPath(props.rowsBinding)) : props.rows);
  const rawChanges = typeof props.changesBinding === 'string' ? store.get(inputPath(props.changesBinding)) : undefined;
  const parsed = useMemo(() => tableChangesData.safeParse(rawChanges), [rawChanges]);
  const changes = parsed.success ? parsed.data : undefined;
  const rowChanges = useMemo(() => new Map(changes?.rows.map(row => [row.id, row]) ?? []), [changes]);
  const sourceColumns = useMemo(() => array(props.columns).length ? array(props.columns).map(column => { const value = typeof column === 'string' ? { key: column, label: column } : object(column); return { key: String(value.key), label: String(value.label ?? value.key) }; }) : Object.keys(object(rows[0])).map(key => ({ key, label: key })), [props.columns, rows]);
  const controls = useTableControls(sourceColumns, rows, scroll, takeOver, Boolean(props.stateKey));
  const columns = controls.columns;
  const identity = useMemo(() => tableIdentity(rows, String(props.rowKey ?? 'id')), [rows, props.rowKey]);
  // Selection and scroll-following state do not change source cell content.
  // Reuse those nodes while retaining live checkbox and active-row controls.
  const renderedRows = useMemo(() => controls.view.map(({ item, index }) => {
    const id = identity.ids[index]!, change = rowChanges.get(id);
    const cells = columns.map(column => {
      const key = String(column.key), cell = change?.cells?.find(cell => cell.key === key), status = cell?.status ?? change?.status;
      const before = cell && Object.hasOwn(cell, 'before') ? JSON.stringify(cell.before) : undefined;
      const showBefore = status === 'updated' && cell && Object.hasOwn(cell, 'before') && text(cell.before) !== text(item[key]);
      return <td key={key} data-column-key={key} data-change={status} data-before={before} className={typeof item[key] === 'number' ? 'task-table-number' : undefined} title={cell ? [before !== undefined ? `Previously: ${before}` : '', cell.detail].filter(Boolean).join(' · ') : text(item[key])}>
        {showBefore && <><span className="task-table-before">{text(cell.before)}</span><span className="task-table-change-arrow" role="img" aria-label="changed to">→</span></>}
        <span className="task-table-value">{text(item[key])}</span>{status && <span className="sr-only"> ({status})</span>}
      </td>;
    });
    return { id, change, cells, index };
  }), [controls.view, columns, rowChanges, identity]);
  const selectionPath = bindings?.value ?? statePath(props.stateKey);
  const selected = array(store.get(selectionPath));
  const previousIdentity = useRef(identity);
  useLayoutEffect(() => {
    if ((!identity.stable || !previousIdentity.current.stable) && previousIdentity.current.rowOrderKey !== identity.rowOrderKey && selected.length) store.set(selectionPath, []);
    previousIdentity.current = identity;
  }, [identity, selectionPath, store, selected]);
  const animatedChanges = useRef(new Map<string, string>());
  const sourceIdentity = `${String(props.rowsBinding ?? '')}:${String(props.changesBinding ?? '')}`;
  const previousSource = useRef(sourceIdentity);
  const previousValues = useRef(new Map<string, string>()), previousColumns = useRef(new Map<string, { x: number; width: number }>());
  const activeAnimations = useRef(new Map<HTMLElement, { animations: Animation[]; overlay?: HTMLElement }>());
  const columnAnimations = useRef<Animation[]>([]), sweepAnimation = useRef<Animation | undefined>(undefined);
  const columnKey = JSON.stringify(columns.map(column => column.key));
  const rowOrderKey = identity.rowOrderKey;
  const viewOrderKey = JSON.stringify(controls.view.map(row => identity.ids[row.index]));
  const changeCounts = useMemo(() => {
    const counts = { added: 0, updated: 0, removed: 0 };
    for (const [id, change] of rowChanges) {
      if (!identity.ids.includes(id)) continue;
      // A field being added/removed updates its existing row. Only an explicit
      // row status declares that the record itself was added or removed.
      const status = change?.status ?? (change?.cells?.some(cell => cell.status) ? 'updated' : undefined);
      if (status) counts[status]++;
    }
    return counts;
  }, [rowChanges, identity]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount cleanup reads the mounted table refs.
  useLayoutEffect(() => () => {
    for (const active of activeAnimations.current.values()) { active.animations.forEach(animation => { animation.cancel(); }); active.overlay?.remove(); }
    activeAnimations.current.clear();
    columnAnimations.current.forEach(animation => { animation.cancel(); }); sweepAnimation.current?.cancel(); stopScroll();
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: source and column identities trigger DOM geometry reconciliation.
  useLayoutEffect(() => {
    const container = scroll.current, table = container?.querySelector('table'); if (!container || !table) return;
    const offsets = new Map<string, number>();
    for (const header of table.querySelectorAll<HTMLElement>('th[data-column-key]')) offsets.set(header.dataset.columnKey!, new DOMMatrixReadOnly(getComputedStyle(header).transform).m41);
    columnAnimations.current.forEach(animation => { animation.cancel(); }); columnAnimations.current = [];
    const bounds = visibleBounds(container, inline), origin = table.getBoundingClientRect(), next = new Map<string, { x: number; width: number }>();
    for (const header of table.querySelectorAll<HTMLElement>('th[data-column-key]')) {
      const box = header.getBoundingClientRect(), key = header.dataset.columnKey!; next.set(key, { x: box.x - origin.x, width: box.width });
      if (!previousColumns.current.size || reducedMotion() || controls.skipMotion.current) continue;
      const old = previousColumns.current.get(key);
      for (const cell of table.querySelectorAll<HTMLElement>('[data-column-key]')) {
        if (cell.dataset.columnKey !== key) continue;
        const rect = cell.getBoundingClientRect(); if (rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) continue;
        const delta = old ? old.x + (offsets.get(key) ?? 0) - (box.x - origin.x) : 0;
        const animation = old && Math.abs(delta) > .5 ? animateTask(cell, [{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], 280) : !old ? animateTask(cell, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0% 0 0)' }], 220) : undefined;
        if (animation) columnAnimations.current.push(animation);
      }
    }
    previousColumns.current = next; controls.skipMotion.current = false;
  }, [columnKey, sourceIdentity, inline]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only accepted source data triggers change animations.
  useLayoutEffect(() => {
    if (previousSource.current !== sourceIdentity) { animatedChanges.current.clear(); previousValues.current.clear(); previousSource.current = sourceIdentity; }
    const accepted = new Map<string, string>(), values = new Map<string, string>(), container = scroll.current;
    const area = container ? visibleBounds(container, inline) : undefined, visibleRows = new Set<Element>();
    for (const row of container?.querySelectorAll('tbody tr') ?? []) { const box = row.getBoundingClientRect(); if (area && box.bottom > area.top && box.top < area.bottom) visibleRows.add(row); }
    for (const cell of container?.querySelectorAll<HTMLTableCellElement>('td[data-column-key]') ?? []) values.set(`${cell.closest('tr')?.dataset.rowId}:${cell.dataset.columnKey}`, cell.querySelector('.task-table-value')?.textContent ?? '');
    let animated = 0;
    for (const cell of scroll.current?.querySelectorAll<HTMLTableCellElement>('td[data-change]') ?? []) {
      const rowId = cell.closest('tr')?.dataset.rowId, key = `${rowId}:${cell.dataset.columnKey}`;
      const value = values.get(key) ?? '', signature = JSON.stringify([cell.dataset.change, cell.dataset.before, cell.title, value]);
      accepted.set(key, signature);
      if (animatedChanges.current.get(key) === signature || !visibleRows.has(cell.closest('tr')!) || animated >= 200) continue;
      const box = cell.getBoundingClientRect(); if (!area || box.right < area.left || box.left > area.right) continue;
      animated++;
      const prior = activeAnimations.current.get(cell); prior?.animations.forEach(animation => { animation.cancel(); }); prior?.overlay?.remove();
      const animations: Animation[] = [], highlight = animateTask(cell, [{ backgroundColor: 'color-mix(in srgb,var(--success) 15%,var(--surface))' }, { backgroundColor: 'transparent' }], 400);
      if (highlight) animations.push(highlight);
      const content = cell.querySelector<HTMLElement>('.task-table-value'), previous = previousValues.current.get(key);
      let overlay: HTMLElement | undefined;
      if (content && previous !== undefined && previous !== value && !reducedMotion()) {
        if (!cell.querySelector('.task-table-before')) {
          overlay = document.createElement('span'); overlay.className = 'task-table-previous-value'; overlay.textContent = previous; overlay.setAttribute('aria-hidden', 'true'); cell.append(overlay);
          const outgoing = animateTask(overlay, [{ opacity: .7, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-2px)' }], 160);
          if (outgoing) animations.push(outgoing);
        }
        const incoming = animateTask(content, [{ opacity: .2, transform: 'translateY(2px)' }, { opacity: 1, transform: 'translateY(0)' }], 400);
        if (incoming) animations.push(incoming);
      }
      const active = { animations, overlay }; activeAnimations.current.set(cell, active);
      void Promise.allSettled(animations.map(animation => animation.finished)).then(() => { overlay?.remove(); if (activeAnimations.current.get(cell) === active) activeAnimations.current.delete(cell); });
    }
    animatedChanges.current = accepted; previousValues.current = values;
  }, [changes, rows, sourceIdentity, inline]);
  const previousSweep = useRef<number | null>(null), activeRow = identity.ids.includes(changes?.activeRowId ?? '') ? changes?.activeRowId : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: view identities reposition the active-row DOM marker.
  useLayoutEffect(() => {
    const container = scroll.current, marker = sweep.current; if (!container || !marker || !activeRow) { previousSweep.current = null; return; }
    const place = () => {
      const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]')).find(row => row.dataset.rowId === activeRow);
      if (!row) { marker.hidden = true; return; }
      const area = container.getBoundingClientRect(), before = previousSweep.current !== null && !marker.hidden ? marker.getBoundingClientRect().top - area.top + container.scrollTop : null;
      sweepAnimation.current?.cancel(); marker.hidden = false; const box = row.getBoundingClientRect(), top = box.top - area.top + container.scrollTop;
      marker.style.top = `${top}px`; marker.style.height = `${box.height}px`;
      if (before !== null && Math.abs(before - top) > .5 && !reducedMotion()) sweepAnimation.current = animateTask(marker, [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], Math.min(360, 180 + Math.abs(before - top) * .8));
      previousSweep.current = top;
    };
    place(); const observer = new ResizeObserver(place); observer.observe(container);
    return () => observer.disconnect();
  }, [activeRow, columnKey, viewOrderKey, sourceIdentity]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow retargets only for accepted source identities and the explicit follow toggle.
  useLayoutEffect(() => {
    const container = scroll.current;
    if (inline || !container || !following || !activeRow) { stopScroll(); return; }
    const request = () => {
      const active = Array.from(container.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]')).find(row => row.dataset.rowId === activeRow);
      if (!active || !container.clientHeight) { stopScroll(); return; }
      const area = container.getBoundingClientRect(), row = active.getBoundingClientRect(), motion = followMotion.current;
      if (row.bottom <= area.bottom - 16 && row.top >= area.top + 40) { stopScroll(); return; }
      const target = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + row.top - area.top - container.clientHeight / 2));
      if (Math.abs(target - (motion.target ?? container.scrollTop)) < 1) return;
      // Viewport following should never coast away from newly accepted evidence.
      // Retain speed in the same direction; reverse immediately without a bounce.
      if (motion.velocity * (target - container.scrollTop) < 0) motion.velocity = 0;
      motion.target = target; motion.started = performance.now();
      if (reducedMotion()) { container.scrollTop = target; stopScroll(); return; }
      if (motion.frame) return; // Retarget the one active movement, preserving velocity.
      motion.position = container.scrollTop; motion.time = motion.started = performance.now();
      const advance = (now: number) => {
        const destination = motion.target; if (destination === null || !container.clientHeight) { stopScroll(); return; }
        const dt = Math.min(.05, Math.max(0, (now - motion.time) / 1000)); motion.time = now;
        const displacement = motion.position - destination, term = motion.velocity + 22 * displacement, decay = Math.exp(-22 * dt);
        const candidate = destination + (displacement + term * dt) * decay;
        const next = Math.max(Math.min(motion.position, destination), Math.min(Math.max(motion.position, destination), candidate));
        motion.velocity = (motion.velocity - 22 * term * dt) * decay;
        if (next !== candidate) motion.velocity = 0;
        container.scrollTop = next; motion.position = container.scrollTop;
        if (now - motion.started > 900 || Math.abs(next - destination) < .5 && Math.abs(motion.velocity) < 4 || document.visibilityState === 'hidden') { container.scrollTop = destination; stopScroll(); }
        else motion.frame = requestAnimationFrame(advance);
      };
      motion.frame = requestAnimationFrame(advance);
    };
    request(); const observer = new ResizeObserver(request); observer.observe(container);
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => { if (preference.matches && followMotion.current.target !== null) { container.scrollTop = followMotion.current.target; stopScroll(); } };
    preference.addEventListener('change', preferenceChanged);
    return () => { observer.disconnect(); preference.removeEventListener('change', preferenceChanged); };
  }, [activeRow, following, rowOrderKey, columnKey, sourceIdentity, inline]);
  return <div className="task-table" data-column-controls={columns.length > 0}>
    <div className="task-table-summary"><span>{controls.view.length} of {rows.length} {rows.length === 1 ? 'row' : 'rows'}</span>{(Object.keys(changeCounts) as (keyof typeof changeCounts)[]).filter(status => changeCounts[status]).map(status => <span key={status} data-change={status}>{changeCounts[status]} {status}</span>)}{columns.length > 0 && controls.filter}</div>
    {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the overflow region must be keyboard-scrollable. */}
    <section ref={scroll} className="table-scroll task-table-scroll" tabIndex={0} aria-label={String(props.caption ?? props.title ?? 'Table records')} data-following={!inline && following} onWheel={takeOver} onTouchStart={takeOver} onPointerDown={takeOver} onScroll={event => { if (following && Math.abs(event.currentTarget.scrollTop - followMotion.current.position) > 1) takeOver(); }} onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) takeOver(); }}>
      <table style={columns.length ? { width: controls.widths.reduce((total, value) => total + value, Boolean(props.stateKey) ? 40 : 0) } : undefined}><caption className={artifactTitle === String(props.title ?? props.caption ?? '') ? 'sr-only' : undefined}>{String(props.title ?? props.caption ?? '')}</caption>
        {columns.length > 0 && <colgroup>{Boolean(props.stateKey) && <col style={{ width: 40 }} />}{columns.map((column, index) => <col key={column.key} style={{ width: controls.widths[index] }} />)}</colgroup>}
        <thead><tr>{Boolean(props.stateKey) && <th scope="col" className="task-table-select"><span className="sr-only">Selected</span></th>}{controls.headers}</tr></thead>
        <tbody>{renderedRows.map(({ id, change, cells, index }) => {
          return <tr key={id} data-row-id={id} data-change={change?.status} data-active={activeRow === id}>
            {Boolean(props.stateKey) && <td className="task-table-select"><input aria-label={`Select row ${index + 1}`} type="checkbox" checked={selected.includes(id)} onChange={event => store.set(selectionPath, event.target.checked ? [...selected, id] : selected.filter(key => key !== id))} /></td>}
            {cells}
          </tr>;
        })}</tbody>
      </table>
      {controls.decorations}
      <i ref={sweep} className="task-table-sweep" aria-hidden="true" hidden={!activeRow} />
      {!controls.view.length && <p className="muted table-empty">{rows.length ? <>No matching rows. <button type="button" className="task-table-clear" onClick={controls.clear}>Clear filter</button></> : String(props.emptyText ?? 'No rows in this data source.')}</p>}
    </section>
    {controls.live}
    {Boolean(props.changesBinding) && !inline && !following && <button type="button" className="quiet task-table-follow" onClick={() => setFollowing(true)}>Resume following changes</button>}
    {Boolean(props.changesBinding) && rawChanges !== undefined && !parsed.success && <small className="task-table-source-error" role="status">Change metadata is unavailable from this source.</small>}
  </div>;
}
