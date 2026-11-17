import { useEffect, useRef, useState, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ThreadNavigationRow as Thread } from '../../../packages/contracts/shell-read-models';

export type SidebarSection = 'pinned' | 'working' | 'flat' | 'settled';
type Patch = NonNullable<Thread['presentation']>;
export type SidebarLists = Record<SidebarSection, Thread[]>;
export interface DropTarget { list: SidebarSection; index: number }
export interface OrderWrite { id: string; order: number }

/** The section a row occupies after a presentation patch, mirroring the sidebar filters. */
export function sectionOf(item: Thread, showWorking: boolean, patch: Patch = {}): SidebarSection {
  const pinned = patch.pinned ?? item.presentation?.pinned ?? false;
  const settled = patch.settled ?? item.presentation?.settled ?? false;
  if (pinned) return 'pinned';
  if (showWorking && (Boolean(item.runId) || item.status === 'working' || item.status === 'awaiting_input')) return 'working';
  if (settled) return 'settled';
  return 'flat';
}

/** Order value inserting at index into a list, or null when neighbors leave no gap. */
export function orderFor(list: readonly Thread[], index: number): number | null {
  const before = index > 0 ? list[index - 1] : undefined;
  const after = index < list.length ? list[index] : undefined;
  const b = before ? (before.presentation?.order ?? 0) : null;
  const a = after ? (after.presentation?.order ?? 0) : null;
  if (b === null && a === null) return 1;
  if (b === null) return (a as number) - 1;
  if (a === null) return b + 1;
  if (a - b > 1e-9) return (a + b) / 2;
  return null;
}

/** Dense integer orders for the list with item injected at index; only changed rows are written. */
export function rebalance(list: readonly Thread[], item: Thread, index: number): OrderWrite[] {
  const without = list.filter(row => row.id !== item.id);
  const at = Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, at), item, ...without.slice(at)]
    .map((row, i) => ({ id: row.id, order: i + 1 }))
    .filter(write => write.id === item.id || (list.find(row => row.id === write.id)?.presentation?.order ?? 0) !== write.order);
}

/** The flag patch a drop onto list produces for item, or null when the drop is invalid. */
export function dropPatch(item: Thread, target: DropTarget, showWorking: boolean): Patch | null {
  if (target.list === 'pinned') return { pinned: true };
  const patch: Patch = { pinned: false };
  return sectionOf(item, showWorking, patch) === target.list ? patch : null;
}

/** Clamp an insertion into the run of rows that shares item's group, the only positions grouping can render. */
export function withinGroup(rows: readonly Thread[], item: Thread, index: number, groupKey?: (item: Thread) => string | null): number {
  const key = groupKey?.(item);
  if (key === undefined || key === null) return index;
  const run = rows.flatMap((candidate, at) => (groupKey!(candidate) === key ? [at] : []));
  return run.length ? Math.min(Math.max(index, run[0]!), run.at(-1)! + 1) : index;
}

const row = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('.sidebar-thread-row[data-thread-id]') : null);

/** Rows of a drop list in document order with the dragged row removed. */
function listRows(container: HTMLElement, excludeId: string): { id: string; rect: DOMRect }[] {
  return [...container.querySelectorAll<HTMLElement>('.sidebar-thread-row[data-thread-id]')]
    .filter(node => node.dataset.threadId !== excludeId && !node.closest('[inert]'))
    .map(node => ({ id: node.dataset.threadId!, rect: node.getBoundingClientRect() }));
}

/** Resolve a pointer position into a concrete insertion target inside the nav. */
export function insertionAt(nav: HTMLElement, _x: number, y: number, excludeId: string): { target: DropTarget; top: number } | null {
  const container = [...nav.querySelectorAll<HTMLElement>('[data-thread-list]')]
    .find(node => { const rect = node.getBoundingClientRect(); return y >= rect.top && y <= rect.bottom; });
  if (!container) return null;
  const list = container.dataset.threadList as SidebarSection;
  const rows = listRows(container, excludeId);
  const bounds = container.getBoundingClientRect();
  let index = rows.length, top = bounds.bottom;
  for (let n = 0; n < rows.length; n++) {
    const mid = rows[n]!.rect.top + rows[n]!.rect.height / 2;
    if (y < mid) { index = n; top = rows[n]!.rect.top; break; }
  }
  if (index === rows.length) top = rows.length ? rows.at(-1)!.rect.bottom : Math.min(bounds.top + 30, bounds.bottom);
  return { target: { list, index }, top };
}

export function useThreadReorder(nav: RefObject<HTMLElement | null>, options: {
  lists: () => SidebarLists;
  locked: () => boolean;
  showWorking: boolean;
  /** Group a row belongs to when the list renders grouped runs; drops stay inside them. */
  groupKey?: (item: Thread) => string | null;
  presentation: (item: Thread, patch: Patch) => Promise<boolean>;
  ensureManualOrder?: () => Promise<boolean>;
  prepareMove: (id: string, order: number, viaPointer?: boolean) => void;
  toast: (message: string) => void;
}) {
  const [dragging, setDragging] = useState<Thread | null>(null);
  const [target, setTarget] = useState<{ target: DropTarget; top: number; valid: boolean } | null>(null);
  const state = useRef(options);
  state.current = options;
  const dragged = useRef<Thread | null>(null);

  const itemOf = (id: string) => Object.values(state.current.lists()).flat().find(row => row.id === id);
  const clear = () => { dragged.current = null; setDragging(null); setTarget(null); };

  const commit = async (item: Thread, patch: Patch, writes: OrderWrite[], viaPointer = true) => {
    const mine = writes.find(write => write.id === item.id)?.order ?? writes.at(-1)?.order ?? 0;
    state.current.prepareMove(item.id, mine, viaPointer);
    const ok = await state.current.presentation(item, { ...patch, order: mine });
    if (!ok) return;
    for (const write of writes) {
      if (write.id === item.id) continue;
      const other = itemOf(write.id);
      if (other) await state.current.presentation(other, { order: write.order });
    }
    const switched = await state.current.ensureManualOrder?.();
    if (switched) state.current.toast('Sidebar order is now manual. Change it back in Settings.');
    else if (switched === false) state.current.toast('Order saved. Switch sidebar order to Manual in Settings to see it.');
  };

  const resolve = (item: Thread, point: { x: number; y: number }) => {
    const element = nav.current;
    if (!element || state.current.locked()) return null;
    const hit = insertionAt(element, point.x, point.y, item.id);
    if (!hit) return null;
    const patch = dropPatch(item, hit.target, state.current.showWorking);
    if (!patch) return { ...hit, valid: false as const };
    const rows = state.current.lists()[hit.target.list].filter(row => row.id !== item.id);
    const index = withinGroup(rows, item, hit.target.index, state.current.groupKey);
    const order = orderFor(rows, index);
    const writes = order === null ? rebalance(state.current.lists()[hit.target.list], item, index) : [{ id: item.id, order }];
    return { ...hit, valid: true as const, patch, writes };
  };

  const drop = (item: Thread, point: { x: number; y: number }) => {
    const resolved = resolve(item, point);
    clear();
    if (resolved?.valid) void commit(item, resolved.patch, resolved.writes);
  };

  const move = (item: Thread, delta: -1 | 1) => {
    if (state.current.locked()) return false;
    const section = sectionOf(item, state.current.showWorking);
    const rows = state.current.lists()[section];
    const from = rows.findIndex(row => row.id === item.id);
    if (from < 0) return false;
    const to = from + delta;
    if (to < 0 || to >= rows.length) return false;
    const without = rows.filter(row => row.id !== item.id);
    const index = withinGroup(without, item, to, state.current.groupKey);
    // Grouping keeps runs contiguous, so a move it cannot render is refused rather than saved.
    if (index === from) return false;
    const order = orderFor(without, index);
    const writes = order === null ? rebalance(rows, item, index) : [{ id: item.id, order }];
    void commit(item, {}, writes, false);
    return true;
  };

  /* HTML5 pointer drag: delegated over the nav so workspace payloads keep working. */
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const over = (event: DragEvent) => {
      const item = dragged.current;
      if (!item || !event.dataTransfer) return;
      const resolved = resolve(item, { x: event.clientX, y: event.clientY });
      const rect = element.getBoundingClientRect();
      if (event.clientY - rect.top < 28) element.scrollTop -= 10;
      else if (rect.bottom - event.clientY < 28) element.scrollTop += 10;
      if (resolved?.valid) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setTarget(current => current?.valid && current.target.list === resolved.target.list && current.target.index === resolved.target.index ? current : { target: resolved.target, top: resolved.top, valid: true });
      } else {
        event.dataTransfer.dropEffect = 'none';
        setTarget(current => current?.valid ? { ...current, valid: false } : current);
      }
    };
    const leave = (event: DragEvent) => { if (!element.contains(event.relatedTarget as Node | null)) setTarget(null); };
    const onDrop = (event: DragEvent) => {
      const item = dragged.current;
      if (!item) return;
      event.preventDefault();
      drop(item, { x: event.clientX, y: event.clientY });
    };
    element.addEventListener('dragover', over);
    element.addEventListener('dragleave', leave);
    element.addEventListener('drop', onDrop);
    return () => { element.removeEventListener('dragover', over); element.removeEventListener('dragleave', leave); element.removeEventListener('drop', onDrop); };
  }, [nav]);

  /* Long-press pointer drag for touch. Native scroll wins until the hold engages. */
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    let held: { item: Thread; node: HTMLElement; pointerId: number; startY: number; active: boolean; timer: number } | null = null;
    const cancel = () => {
      if (!held) return;
      clearTimeout(held.timer);
      if (held.active) { held.node.style.transform = ''; held.node.classList.remove('sidebar-touch-drag'); }
      held = null;
      dragged.current = null;
      setDragging(null);
      setTarget(null);
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || held) return;
      const node = row(event.target);
      if (!node) return;
      const item = itemOf(node.dataset.threadId!);
      if (!item || state.current.locked()) return;
      const timer = window.setTimeout(() => {
        if (!held || held.node !== node) return;
        held.active = true;
        dragged.current = held.item;
        setDragging(held.item);
        node.classList.add('sidebar-touch-drag');
        try { node.setPointerCapture(held.pointerId); } catch { /* best-effort */ }
      }, 420);
      held = { item, node, pointerId: event.pointerId, startY: event.clientY, active: false, timer };
    };
    const moveTouch = (event: PointerEvent) => {
      if (!held || event.pointerId !== held.pointerId) return;
      if (!held.active) { if (Math.abs(event.clientY - held.startY) > 9) cancel(); return; }
      event.preventDefault();
      held.node.style.transform = `translateY(${event.clientY - held.startY}px)`;
      const resolved = resolve(held.item, { x: event.clientX, y: event.clientY });
      setTarget(current => {
        if (!resolved) return current?.valid ? { ...current, valid: false } : current;
        return resolved.valid ? { target: resolved.target, top: resolved.top, valid: true } : (current ? { ...current, valid: false } : current);
      });
    };
    const up = (event: PointerEvent) => {
      if (!held || event.pointerId !== held.pointerId) return;
      const was = held;
      const point = { x: event.clientX, y: event.clientY };
      cancel();
      if (was.active) {
        event.preventDefault();
        const swallow = (click: Event) => { click.preventDefault(); click.stopPropagation(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400);
        drop(was.item, point);
      }
    };
    const cancelled = (event: PointerEvent) => { if (held && event.pointerId === held.pointerId) cancel(); };
    // touch-action is fixed when the gesture starts, so cancelling a pointermove
    // cannot stop native panning. Preventing the cancellable touchmove does,
    // and an engaged hold has not panned yet.
    const pan = (event: TouchEvent) => { if (held?.active && event.cancelable) event.preventDefault(); };
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', moveTouch, { passive: false });
    window.addEventListener('touchmove', pan, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    return () => {
      cancel();
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', moveTouch);
      window.removeEventListener('touchmove', pan);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
    };
  }, [nav]);

  /* Escape cancels an in-flight touch drag (HTML5 dragend covers the pointer path). */
  useEffect(() => {
    if (!dragging) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [dragging]);

  return {
    dragging,
    indicatorTop: target?.valid ? target.top - (nav.current?.getBoundingClientRect().top ?? 0) + (nav.current?.scrollTop ?? 0) : null,
    /** Call from the row's onDragStart after the workspace payload has been written. */
    begin(item: Thread) { dragged.current = item; setDragging(item); },
    end: clear,
    /** Alt+ArrowUp/Down reorder inside the row's own section. Returns true when handled. */
    key(item: Thread, event: ReactKeyboardEvent<HTMLButtonElement>) {
      if (!event.altKey) return false;
      if (event.key === 'ArrowUp') { event.preventDefault(); return move(item, -1); }
      if (event.key === 'ArrowDown') { event.preventDefault(); return move(item, 1); }
      return false;
    },
  };
}
