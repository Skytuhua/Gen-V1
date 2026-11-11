import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { ThreadNavigationRow } from '../../../packages/contracts/shell-read-models';
import { animateTask } from './task-motion';
import { observeMotionPolicy, readMotionPolicy } from './motion-policy';

type Position = { node: HTMLElement; x: number; y: number; visible: boolean };

/** Arm only an explicit move; ordinary snapshots and mounts never infer motion. */
export function useThreadMove(sidebar: RefObject<HTMLElement | null>, matching: ThreadNavigationRow[], enabled: boolean, scope: string) {
  const pointer = useRef(false);
  const active = useRef(new Map<HTMLElement, Animation>());
  const pending = useRef<{
    id: string; order: number; scope: string;
    positions: Map<string, Position>; scrollTop: number;
  } | null>(null);
  const previous = useRef({ matching, scope });
  const stop = () => {
    for (const [node, animation] of active.current) { delete node.dataset.threadMoving; animation.cancel(); }
    active.current.clear();
  };
  const offset = (node: HTMLElement) => {
    const transform = active.current.has(node) ? getComputedStyle(node).transform : 'none';
    const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
    return { x: matrix?.m41 ?? 0, y: matrix?.m42 ?? 0 };
  };
  const positions = (final = false) => {
    const rows = new Map<string, Position>(), list = sidebar.current?.querySelector('.thread-list');
    if (!list) return rows;
    const clip = list.getBoundingClientRect();
    for (const node of list.querySelectorAll<HTMLElement>('.sidebar-thread-row[data-thread-id]')) {
      if (node.closest('[inert], [aria-hidden="true"]') || !node.getClientRects().length) continue;
      const rect = node.getBoundingClientRect(), translation = offset(node);
      const x = rect.left - translation.x, y = rect.top - translation.y;
      const left = final ? x : rect.left, top = final ? y : rect.top;
      const visible = top + rect.height > Math.max(0, clip.top) && top < Math.min(innerHeight, clip.bottom) &&
        left + rect.width > Math.max(0, clip.left) && left < Math.min(innerWidth, clip.right);
      rows.set(node.dataset.threadId!, { node, x, y, visible });
    }
    return rows;
  };

  useLayoutEffect(() => {
    const request = pending.current, changed = previous.current.matching !== matching, scopeChanged = previous.current.scope !== scope;
    previous.current = { matching, scope };
    if (!enabled || readMotionPolicy() !== 'full' || scopeChanged || request && request.scope !== scope) {
      pending.current = null; stop(); return;
    }
    if (!request) { if (changed) stop(); return; }
    if (matching.find(item => item.id === request.id)?.presentation?.order !== request.order) {
      // A different publication invalidates the intent, including a failed
      // command followed by background sorting or restoration.
      if (changed) { pending.current = null; stop(); }
      return;
    }
    pending.current = null;
    const after = positions(true), visibleIds = (rows: Map<string, Position>) => [...rows].filter(([, position]) => position.visible).map(([id]) => id);
    const beforeIds = visibleIds(request.positions), afterIds = visibleIds(after);
    const reordered = beforeIds.length !== afterIds.length || beforeIds.some((id, index) => id !== afterIds[index]);
    const scrolled = sidebar.current?.querySelector('.thread-list')?.scrollTop !== request.scrollTop;
    const moves: { node: HTMLElement; x: number; y: number }[] = [];
    if (reordered && !scrolled) for (const [id, last] of after) {
      const first = request.positions.get(id);
      if (!first || first.node !== last.node || !last.visible) continue;
      // Sample the old effect at commit time, even if the command was delayed.
      // Subtracting its transform above gives the new, final layout position.
      const translation = offset(last.node), x = first.x - last.x + translation.x, y = first.y - last.y + translation.y;
      if (Math.abs(x) > .5 || Math.abs(y) > .5) moves.push({ node: last.node, x, y });
    }
    stop();
    for (const { node, x, y } of moves) {
      if (node.dataset.threadId === request.id) node.dataset.threadMoving = 'true';
      const animation = animateTask(node, [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0px, 0px)' }], 180,
        { duration: '--ui-motion-insert', easing: '--ui-ease-move' });
      if (!animation) continue;
      active.current.set(node, animation);
      const cleanup = () => {
        if (active.current.get(node) === animation) { delete node.dataset.threadMoving; active.current.delete(node); }
      };
      animation.addEventListener('finish', cleanup, { once: true });
      animation.addEventListener('cancel', cleanup, { once: true });
    }
  });

  useLayoutEffect(() => {
    const unobserve = observeMotionPolicy(policy => { if (policy !== 'full') { pending.current = null; stop(); } });
    return () => { unobserve(); pending.current = null; stop(); };
  }, []);

  return {
    // React capture follows the menu portal too. Keyboard selection can call
    // onSelect directly, so clear the source before its key handler runs.
    menuEvents: {
      onClickCapture: (event: { detail: number }) => { pointer.current = event.detail > 0; },
      onKeyDownCapture: () => { pointer.current = false; },
    },
    prepare: (id: string, order: number) => {
      const animate = pointer.current && enabled && readMotionPolicy() === 'full';
      pointer.current = false;
      pending.current = animate ? { id, order, scope, positions: positions(), scrollTop: sidebar.current?.querySelector('.thread-list')?.scrollTop ?? 0 } : null;
      if (!animate) stop();
    },
  };
}
