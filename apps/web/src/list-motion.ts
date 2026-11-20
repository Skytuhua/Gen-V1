import { useEffect, useRef, useState } from 'react';

export interface RowMotion<T> {
  /** Ids that newly entered the list while it was mounted, in arrival order (for nth stagger). */
  arrivals: ReadonlyMap<string, number>;
  /** Ids removed from the list still animating their exit. */
  leaving: ReadonlySet<string>;
  /** Cached item for each leaving id (frozen at removal time). */
  cached: (id: string) => T | undefined;
  /** Clear a leaving ghost (call from onAnimationEnd or a motion-off fallback). */
  finishLeaving: (id: string) => void;
}

const MAX_KEPT_ARRIVALS = 40;

/** Shared insert/remove contract for data-leaving ghost lists (resource-chip
 * pattern): rows that arrive while the list is mounted get an arrival index,
 * removed rows stay available as frozen ghosts until their exit animation
 * ends. A wholesale swap (snapshot restore, source switch) clears silently
 * instead of replaying mass entrances/exits. */
export function useRowMotion<T>(items: readonly T[], keyOf: (item: T) => string, enabled = true): RowMotion<T> {
  const cache = useRef(new Map<string, T>());
  const arrivalsRef = useRef(new Map<string, number>());
  const renderedIds = useRef(new Set<string>());
  const mounted = useRef(false);
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());

  const present = new Set(items.map(keyOf));
  for (const item of items) cache.current.set(keyOf(item), item);

  const active = mounted.current && enabled;
  const gone = active ? [...renderedIds.current].filter(id => !present.has(id) && !leaving.has(id)) : [];
  const restored = [...leaving].filter(id => present.has(id));
  // A wholesale list swap (snapshot restore, source switch) is not a row
  // arrival or removal — adopt the new ids silently instead of replaying
  // mass entrances/exits.
  const swap = active && renderedIds.current.size > 4 && gone.length === renderedIds.current.size;
  const freshIds = active && !swap ? items.map(keyOf).filter(id => !renderedIds.current.has(id) && !leaving.has(id)) : [];
  if (gone.length || restored.length || freshIds.length) {
    if (swap) for (const id of gone) cache.current.delete(id);
    setLeaving(previous => {
      const next = new Set(previous);
      if (!swap) for (const id of gone) next.add(id);
      for (const id of restored) next.delete(id);
      return next;
    });
    if (freshIds.length || restored.length) {
      const base = arrivalsRef.current.size;
      freshIds.forEach((id, index) => arrivalsRef.current.set(id, base + index));
      for (const id of restored) arrivalsRef.current.delete(id);
      if (arrivalsRef.current.size > MAX_KEPT_ARRIVALS) arrivalsRef.current = new Map([...arrivalsRef.current.entries()].slice(-MAX_KEPT_ARRIVALS));
      setArrivals(new Map(arrivalsRef.current));
    }
  }
  renderedIds.current = present;
  mounted.current = true;

  const finishLeaving = (id: string) => {
    cache.current.delete(id);
    setLeaving(previous => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  };

  useEffect(() => {
    if (!leaving.size) return;
    // Ghosts clear on animationend; the timer only covers motion-off runs.
    const timers = [...leaving].map(id => window.setTimeout(() => finishLeaving(id), 400));
    return () => timers.forEach(timer => clearTimeout(timer));
  }, [leaving]);

  return { arrivals, leaving, cached: id => cache.current.get(id), finishLeaving };
}
