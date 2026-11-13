import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { GripVertical, Search } from 'lucide-react';
import { Popover } from '../../../packages/ui-shell/Popover';
import { columnWidth, cycleSort, keyboardWidth, moveColumn, reconcileOrder, tableCellText, tableObject, tableView, type TableColumn, type TableSort } from './task-table-model';

type Gesture = { kind: 'resize' | 'move'; key: string; scale: number; startX: number; x: number; y: number; startWidth: number; width: number; position: number | null; line: number | null; moved: boolean };

function SortLabel({ label, direction, sort }: { label: string; direction?: 'ascending' | 'descending'; sort: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null), text = useRef<HTMLSpanElement>(null), id = useId();
  const [open, setOpen] = useState(false);
  const show = () => setOpen(Boolean(text.current && text.current.scrollWidth > text.current.clientWidth));
  return <><button ref={anchor} type="button" className="task-table-sort" aria-label={`Sort ${label}`} aria-describedby={open ? id : undefined} onFocus={show} onBlur={() => setOpen(false)} onMouseEnter={show} onMouseLeave={() => { if (document.activeElement !== anchor.current) setOpen(false); }} onClick={sort}><span ref={text}>{label}</span>{direction && <span className="task-table-sort-arrow" aria-hidden="true">{direction === 'ascending' ? '↑' : '↓'}</span>}</button>
    <Popover anchor={anchor} open={open} width={Math.min(420, label.length * 7 + 24)} height={Math.min(180, Math.ceil(label.length / 48) * 16 + 16)} onDismiss={() => setOpen(false)} role="tooltip" id={id} className="task-table-label-help">{label}</Popover></>;
}

export function useTableControls(sourceColumns: TableColumn[], rows: unknown[], scroll: RefObject<HTMLDivElement | null>, takeOver: () => void, selectable: boolean) {
  const [order, setOrder] = useState<string[]>([]), [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<TableSort>(null), [query, setQuery] = useState(''), [settledQuery, setSettledQuery] = useState('');
  const [announcement, setAnnouncement] = useState(''), [gesture, setGesture] = useState<Gesture | null>(null);
  const composing = useRef(false), input = useRef<HTMLInputElement>(null), active = useRef<Gesture | null>(null), cleanup = useRef<() => void>(() => {});
  const skipMotion = useRef(false), focusKey = useRef<string | null>(null), helpId = useId();
  const sourceKey = JSON.stringify(sourceColumns.map(column => column.key));
  const keys = useMemo<string[]>(() => JSON.parse(sourceKey), [sourceKey]);
  const orderedKeys = useMemo(() => reconcileOrder(order, keys), [order, keys]);
  const columns = useMemo(() => orderedKeys.map(key => sourceColumns.find(column => column.key === key)!), [orderedKeys, sourceColumns]);
  const currentSort = sort && keys.includes(sort.key) ? sort : null;
  const view = useMemo(() => tableView(rows, sourceColumns, settledQuery, currentSort), [rows, sourceColumns, settledQuery, currentSort]);
  const label = useCallback((key: string) => sourceColumns.find(column => column.key === key)?.label ?? key, [sourceColumns]);
  const canvas = useRef<CanvasRenderingContext2D | null>(null);
  const measure = useCallback((value: string, font: string) => {
    if (!canvas.current) canvas.current = document.createElement('canvas').getContext('2d');
    const context = canvas.current; if (!context) return value.length * 8; context.font = font; return context.measureText(value).width;
  }, []);
  const fonts = useCallback(() => {
    const header = scroll.current?.querySelector('th[data-column-key]'), cell = scroll.current?.querySelector('td[data-column-key]');
    const font = (node: Element | null | undefined, fallback: string) => { if (!node) return fallback; const style = getComputedStyle(node); return `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; };
    return { header: font(header, '10px monospace'), cell: font(cell, '14px sans-serif') };
  }, [scroll]);
  // Measure numeric text with the table's actual tabular figures, including hidden rows.
  const [minima, setMinima] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const container = scroll.current; if (!container) return;
    const sample = document.createElement('span');
    sample.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-variant-numeric:tabular-nums';
    sample.style.font = fonts().cell; sample.style.fontVariantNumeric = 'tabular-nums';
    container.append(sample);
    const next = Object.fromEntries(keys.map(key => [key, rows.reduce<number>((minimum, row) => {
      const value = tableObject(row)[key]; if (typeof value !== 'number') return minimum;
      sample.textContent = tableCellText(value, sourceColumns.find(column => column.key === key)!);
      return Math.max(minimum, sample.scrollWidth + 26);
    }, 90)]));
    sample.remove(); setMinima(next);
  }, [rows, keys, fonts, scroll, sourceColumns]);
  const minimum = useCallback((key: string) => minima[key] ?? 90, [minima]);
  const fitColumn = useCallback((key: string) => {
    const font = fonts();
    return columnWidth(Math.max(measure(label(key), font.header) + 65, ...rows.map(row => measure(tableCellText(tableObject(row)[key], sourceColumns.find(column => column.key === key)!), font.cell) + 25)), minimum(key));
  }, [fonts, measure, label, rows, minimum, sourceColumns]);
  const width = (key: string) => columnWidth(widths[key] ?? 140, minimum(key));
  const announce = useCallback((message: string) => setAnnouncement(previous => previous === message ? `${message}\u00a0` : message), []);
  const commitWidth = (key: string, next: number) => { takeOver(); setWidths(values => ({ ...values, [key]: next })); announce(`${label(key)} column width ${next} pixels.`); };
  const move = (key: string, position: number) => {
    takeOver(); skipMotion.current = orderedKeys.indexOf(key) !== position; focusKey.current = key;
    setOrder(moveColumn(orderedKeys, key, position));
    announce(`${label(key)} moved to position ${position + 1} of ${columns.length}.`);
  };
  useLayoutEffect(() => {
    setOrder(previous => reconcileOrder(previous, keys));
    setWidths(previous => {
      const available = (scroll.current?.clientWidth ?? 0) - (selectable ? 40 : 0) - 12;
      const fitted = keys.map(key => previous[key] ?? fitColumn(key));
      const spare = Object.keys(previous).length ? 0 : Math.max(0, available - fitted.reduce((total, value) => total + value, 0)) / Math.max(1, keys.length);
      return Object.fromEntries(keys.map((key, index) => [key, previous[key] ?? columnWidth(fitted[index]! + spare, minimum(key))]));
    });
    if (sort && !keys.includes(sort.key)) setSort(null);
    if (active.current && !keys.includes(active.current.key)) cleanup.current();
  }, [keys, fitColumn, minimum, selectable, scroll, sort]);
  useLayoutEffect(() => {
    if (!focusKey.current || !scroll.current) return;
    const grip = Array.from(scroll.current.querySelectorAll<HTMLButtonElement>('.task-table-grip')).find(node => node.closest<HTMLElement>('th')?.dataset.columnKey === focusKey.current);
    focusKey.current = null;
    if (!grip) return;
    grip.focus({ preventScroll: true });
    const header = grip.closest('th')!.getBoundingClientRect(), bounds = scroll.current.getBoundingClientRect(), scale = bounds.width / scroll.current.offsetWidth;
    if (header.left < bounds.left) scroll.current.scrollLeft += (header.left - bounds.left) / scale;
    else if (header.right > bounds.right) scroll.current.scrollLeft += (header.right - bounds.right) / scale;
  });
  useEffect(() => () => cleanup.current(), []);
  useEffect(() => {
    const timer = setTimeout(() => announce(`${view.length} of ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} shown.`), 180);
    return () => clearTimeout(timer);
  }, [view.length, rows.length, announce]);

  const begin = (event: ReactPointerEvent<HTMLElement>, key: string, kind: Gesture['kind']) => {
    if (!event.isPrimary || event.button !== 0 || active.current) return;
    event.preventDefault(); takeOver();
    event.currentTarget.focus({ preventScroll: true });
    const target = event.currentTarget, pointer = event.pointerId;
    const current: Gesture = { kind, key, scale: scroll.current!.getBoundingClientRect().width / scroll.current!.offsetWidth, startX: event.clientX, x: event.clientX, y: event.clientY, startWidth: width(key), width: width(key), position: null, line: null, moved: false };
    active.current = current; setGesture({ ...current }); target.setPointerCapture(pointer);
    const container = scroll.current!;
    let frame = 0;
    const place = () => {
      const headers = Array.from(container.querySelectorAll<HTMLElement>('th[data-column-key]'));
      const header = headers.find(node => node.dataset.columnKey === key);
      if (!header) { finish(false); return; }
      const bounds = container.getBoundingClientRect(), box = header.getBoundingClientRect();
      if (kind === 'resize') {
        current.width = columnWidth(current.startWidth + (current.x - current.startX) / current.scale, minimum(key));
        current.line = (box.right - bounds.left) / current.scale + container.scrollLeft + current.width - current.startWidth;
      } else {
        const first = headers[0]!.getBoundingClientRect(), last = headers.at(-1)!.getBoundingClientRect();
        const inside = current.x >= Math.max(bounds.left, first.left) && current.x <= Math.min(bounds.right, last.right) && current.y >= Math.max(bounds.top, first.top) && current.y <= first.bottom;
        const boundary = headers.findIndex(node => current.x < node.getBoundingClientRect().left + node.getBoundingClientRect().width / 2);
        const insert = boundary < 0 ? headers.length : boundary;
        current.position = inside ? insert - (orderedKeys.indexOf(key) < insert ? 1 : 0) : null;
        current.line = inside ? ((insert === headers.length ? last.right : headers[insert]!.getBoundingClientRect().left) - bounds.left) / current.scale + container.scrollLeft : null;
      }
      setGesture({ ...current });
    };
    const track = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      current.x = next.clientX; current.y = next.clientY;
      current.moved ||= Math.abs(current.x - current.startX) > 3;
      place();
    };
    const finish = (commit: boolean) => {
      if (active.current !== current) return;
      active.current = null; cancelAnimationFrame(frame);
      target.removeEventListener('pointermove', track); target.removeEventListener('pointerup', release); target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel); window.removeEventListener('keydown', cancelOnEscape, true);
      if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
      setGesture(null); cleanup.current = () => {};
      if (!commit) announce(kind === 'resize' ? 'Resize cancelled.' : 'Move cancelled.');
      else if (kind === 'resize' && current.moved) commitWidth(key, current.width);
      else if (kind === 'move' && current.moved && current.position !== null) move(key, current.position);
      else if (kind === 'move') announce('Move cancelled.');
    };
    const release = (next: PointerEvent) => { if (next.pointerId === pointer) { track(next); finish(true); } };
    const cancel = (next?: PointerEvent) => { if (!next || next.pointerId === pointer) finish(false); };
    const cancelOnEscape = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(false); } };
    const autoScroll = () => {
      if (active.current !== current) return;
      if (kind === 'move' && current.moved) {
        const bounds = container.getBoundingClientRect(), header = container.querySelector('th[data-column-key]')!.getBoundingClientRect();
        if (current.y >= header.top && current.y <= header.bottom && current.x >= bounds.left && current.x <= bounds.right) {
          const delta = current.x < bounds.left + 32 ? -12 : current.x > bounds.right - 32 ? 12 : 0;
          if (delta) { container.scrollLeft += delta; place(); }
        }
      }
      frame = requestAnimationFrame(autoScroll);
    };
    cleanup.current = () => cancel();
    target.addEventListener('pointermove', track); target.addEventListener('pointerup', release); target.addEventListener('pointercancel', cancel); target.addEventListener('lostpointercapture', cancel); window.addEventListener('keydown', cancelOnEscape, true);
    place(); frame = requestAnimationFrame(autoScroll);
  };
  const clear = () => { takeOver(); setQuery(''); setSettledQuery(''); input.current?.focus(); announce(`${rows.length} of ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} shown.`); };
  const headers = columns.map(column => {
    const key = column.key, value = width(key), direction = currentSort?.key === key ? currentSort.direction : undefined;
    return <th scope="col" key={key} data-column-key={key} aria-sort={direction} data-moving={gesture?.kind === 'move' && gesture.key === key} className={column.type === 'number' ? 'number' : undefined}>
      <div className="task-table-heading">
        <button type="button" className="task-table-grip" aria-label={`Move ${column.label} column`} aria-describedby={helpId} title="Drag or use Alt+Left/Right to move" onPointerDown={event => begin(event, key, 'move')} onKeyDown={event => {
          if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || active.current) return;
          event.preventDefault(); takeOver();
          const position = orderedKeys.indexOf(key) + (event.key === 'ArrowRight' ? 1 : -1);
          if (position < 0 || position >= columns.length) announce(`${column.label} is already ${position < 0 ? 'first' : 'last'}.`);
          else move(key, position);
        }}><GripVertical size={12} aria-hidden="true" /></button>
        <SortLabel label={column.label} direction={direction} sort={() => { if (active.current) return; takeOver(); setSort(cycleSort(currentSort, key)); }} />
      </div>
      <hr tabIndex={0} className="task-table-resizer" aria-orientation="vertical" aria-label={`Resize ${column.label} column`} aria-valuemin={minimum(key)} aria-valuemax={Math.max(420, minimum(key))} aria-valuenow={value} aria-valuetext={`${value} pixels`} onPointerDown={event => begin(event, key, 'resize')} onDoubleClick={() => { cleanup.current(); commitWidth(key, fitColumn(key)); }} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || active.current) return;
        event.preventDefault(); commitWidth(key, keyboardWidth(value, event.key, minimum(key)));
      }} />
    </th>;
  });
  const filter = <div className="task-table-filter"><label className="task-table-filter-field" data-active={Boolean(query.trim())}><Search size={12} aria-hidden="true" /><input ref={input} aria-label="Filter rows" placeholder="Filter rows" value={query} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={event => { composing.current = false; setSettledQuery(event.currentTarget.value); }} onChange={event => { takeOver(); setQuery(event.target.value); if (!composing.current) setSettledQuery(event.target.value); }} /></label>{query && <button type="button" className="task-table-clear" onClick={clear}>Clear</button>}</div>;
  const decorations = <>
    {gesture?.line !== null && gesture?.line !== undefined && <i aria-hidden="true" className={gesture.kind === 'resize' ? 'task-table-resize-guide' : 'task-table-drop-line'} style={{ left: gesture.line, ...(gesture.kind === 'resize' ? { height: scroll.current?.querySelector('table')?.offsetHeight } : { top: ((scroll.current?.querySelector('thead')?.getBoundingClientRect().top ?? 0) - (scroll.current?.getBoundingClientRect().top ?? 0)) / gesture.scale + (scroll.current?.scrollTop ?? 0) + 3 }) }} />}
    {gesture?.kind === 'move' && gesture.moved && <div aria-hidden="true" className="task-table-drag-preview" style={{ left: (gesture.x - (scroll.current?.getBoundingClientRect().left ?? 0)) / gesture.scale + (scroll.current?.scrollLeft ?? 0) + 12, top: (gesture.y - (scroll.current?.getBoundingClientRect().top ?? 0)) / gesture.scale + (scroll.current?.scrollTop ?? 0) + 12 }}><GripVertical size={12} />{label(gesture.key)}</div>}
  </>;
  const live = <><span id={helpId} className="sr-only">Drag or use Alt+Left/Right to move</span><span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span></>;
  return { columns, view, widths: columns.map(column => width(column.key)), headers, filter, decorations, live, clear, skipMotion };
}
