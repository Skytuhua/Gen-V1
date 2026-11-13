import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Snapshot } from '../../../packages/contracts';
import { getThreadMessages } from './api';

// Snapshot messages are windowed per thread (see store.snapshot). Views that
// render full history merge the window with older pages fetched on demand.
// `eager` keeps paging until nothing older remains (transcript-style views).
export function useThreadMessages(snapshot: Snapshot, threadId: string | undefined, eager = false) {
  const [older, setOlder] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exhausted, setExhausted] = useState(false);
  const request = useRef(0);
  useEffect(() => { request.current++; setOlder([]); setError(''); setExhausted(false); }, [threadId]);
  const window = threadId ? snapshot.messages.filter(message => message.threadId === threadId) : [];
  const windowIds = new Set(window.map(message => message.id));
  const messages = [...older.filter(message => !windowIds.has(message.id)), ...window];
  const truncated = threadId ? snapshot.messagesTruncated?.[threadId] ?? 0 : 0;
  const remaining = Math.max(0, truncated - older.length);
  const windowHead = window[0]?.id;
  const loadMore = useCallback(() => {
    if (!threadId || !windowHead || exhausted) return Promise.resolve();
    const id = ++request.current;
    setLoading(true);
    // Anchor on the server window's first message: the page covers both the gap
    // a refetch may have opened and deeper history. Dedupe + createdAt ordering
    // keep the merged list contiguous.
    return getThreadMessages(threadId, windowHead)
      .then(page => {
        if (request.current !== id) return;
        setOlder(previous => {
          const known = new Set(previous.map(message => message.id));
          const fresh = page.messages.filter(message => !known.has(message.id));
          if (!fresh.length) setExhausted(true);
          return [...previous, ...fresh].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      })
      .catch(cause => { if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (request.current === id) setLoading(false); });
  }, [threadId, windowHead, exhausted]);
  useEffect(() => { if (eager && remaining > 0 && !loading && !error && !exhausted) void loadMore(); }, [eager, remaining, loading, error, exhausted, loadMore]);
  return { messages, remaining, loadMore, loading, error };
}
