import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Message, Snapshot } from '../../../packages/contracts';
import { getThreadMessages } from './api';

// Snapshot messages are windowed per thread (see store.snapshot). Views that
// render full history merge the window with older pages fetched on demand.
// `eager` keeps paging until nothing older remains (transcript-style views).
export function useThreadMessages(snapshot: Pick<Snapshot, 'messages' | 'messagesTruncated'>, threadId: string | undefined, eager = false) {
  const [older, setOlder] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exhaustedHead, setExhaustedHead] = useState<string>();
  const request = useRef(0);
  const owner = useRef(threadId);
  const lastHead = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    owner.current = threadId;
    lastHead.current = undefined;
    setOlder([]); setLoading(false); setError(''); setExhaustedHead(undefined);
    return () => { request.current++; };
  }, [threadId]);
  const window = threadId ? snapshot.messages.filter(message => message.threadId === threadId) : [];
  const windowIds = new Set(window.map(message => message.id));
  const owned = owner.current === threadId;
  const currentOlder = owned ? older : [];
  const messages = [...currentOlder.filter(message => !windowIds.has(message.id)), ...window];
  const truncated = threadId ? snapshot.messagesTruncated?.[threadId] ?? 0 : 0;
  const remaining = Math.max(0, truncated - currentOlder.length);
  const windowHead = window[0]?.id;
  const exhausted = windowHead !== undefined && exhaustedHead === windowHead;
  const loadMore = useCallback(() => {
    if (!threadId || owner.current !== threadId || !windowHead || exhausted) return Promise.resolve();
    const id = ++request.current;
    setLoading(true); setError('');
    // Anchor on the server window's first message only until it stops moving:
    // the page heals the gap a refetch may have opened. Once the head is
    // stable, page strictly before the earliest fetched message so clicks
    // keep reaching deeper history. Dedupe + createdAt ordering keep the
    // merged list contiguous.
    const anchor = older.length && lastHead.current === windowHead ? older[0].id : windowHead;
    return getThreadMessages(threadId, anchor)
      .then(page => {
        if (request.current !== id) return;
        lastHead.current = windowHead;
        setOlder(previous => {
          const known = new Set(previous.map(message => message.id));
          const fresh = page.messages.filter(message => !known.has(message.id));
          if (!fresh.length) setExhaustedHead(windowHead);
          return [...previous, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      })
      .catch(cause => { if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (request.current === id) setLoading(false); });
  }, [threadId, windowHead, exhausted, older]);
  useEffect(() => { if (eager && remaining > 0 && !loading && !error && !exhausted) void loadMore(); }, [eager, remaining, loading, error, exhausted, loadMore]);
  return { messages, remaining, loadMore, loading: owned && loading, error: owned ? error : '' };
}
