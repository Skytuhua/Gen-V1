import {useCallback, useEffect, useRef, useState} from 'react';
import type {NavigationPage} from '../../../packages/contracts/shell-read-models';
import {getShellNavigation} from './shell-read-api';

/** Navigation rows are metadata, including empty drafts; never an agent inventory or Snapshot. */
export function useShellNavigation(text: string) {
  const [page, setPage] = useState<NavigationPage | null>(null), [pending, setPending] = useState(false), [error, setError] = useState('');
  const current = useRef(page), active = useRef<AbortController | undefined>(undefined), alive = useRef(true);
  const query = useRef(text); query.current = text; current.current = page;
  const load = useCallback(async (more = false) => {
    active.current?.abort(); const controller = active.current = new AbortController();
    const before = current.current, cursor = more ? before?.nextCursor : undefined;
    setPending(true); setError('');
    try {
      const value = await getShellNavigation({limit: 100, text: query.current.trim() || undefined, ...(cursor ? {cursor} : {})}, controller.signal);
      if (!alive.current || controller.signal.aborted) return;
      const items = cursor && before ? [...before.items, ...value.items.filter(item => !before.items.some(previous => previous.id === item.id))] : value.items;
      const next = {...value, items}; current.current = next; setPage(next);
    } catch (cause) {
      if (alive.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Threads could not load. Retry.');
    } finally {if (alive.current && !controller.signal.aborted) setPending(false);}
  }, []);
  useEffect(() => {
    alive.current = true; active.current?.abort(); current.current = null; setPage(null);
    const timer = setTimeout(() => {void load();}, text ? 180 : 0);
    return () => {clearTimeout(timer); active.current?.abort();};
  }, [text, load]);
  useEffect(() => () => {alive.current = false; active.current?.abort();}, []);
  return {page, pending, error, refresh: () => load(), more: () => load(true)};
}
