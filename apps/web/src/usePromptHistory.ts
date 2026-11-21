import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {KeyboardEvent, RefObject} from 'react';
import type {Message, Thread} from '../../../packages/contracts';
import {matchesShortcut} from './shell-layout';
import {getThreadMessages} from './api';
import {collectPromptHistory, stepHistory, type HistoryState, type PromptHistoryEntry} from './prompt-history';

export type HistoryKeyAction = 'older' | 'newer' | 'search' | 'restore' | 'none';

interface KeyLike {key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean}

/** Pure key decision for the composer's history shortcuts; the registry test reads the comparisons in this file. */
export function historyKeyAction(event: KeyLike, context: {draft: string; selectionStart: number; selectionEnd: number; shown: string; browsing: boolean; composing: boolean; disabled: boolean}): HistoryKeyAction {
  if (context.disabled || context.composing) return 'none';
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r') return 'search';
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'ArrowUp')
    return context.browsing
      ? (context.shown.slice(0, context.selectionStart).includes('\n') ? 'none' : 'older')
      : (context.draft.trim() ? 'none' : 'older');
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'ArrowDown')
    return context.browsing && !context.shown.slice(context.selectionEnd).includes('\n') ? 'newer' : 'none';
  if (context.browsing && matchesShortcut(event, 'Escape')) return 'restore';
  return 'none';
}

export interface PromptHistoryOptions {
  messages: readonly Message[];
  threads: readonly Thread[];
  /** messagesTruncated[threadId]: how many older prompts the store has not delivered. */
  truncated: number;
  /** Current thread; undefined for a new conversation. */
  threadId: string | undefined;
  draft: string;
  /** Writes an ordinary draft through the composer's normal path (journaled). */
  write: (value: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
}

export function usePromptHistory(options: PromptHistoryOptions) {
  const {messages, threads, truncated, threadId, draft, write, input, disabled} = options;
  const [state, setState] = useState<HistoryState>({mode: 'idle'});
  const [shown, setShown] = useState('');
  const [older, setOlder] = useState<Message[]>([]);
  const [remaining, setRemaining] = useState(truncated);
  const [paging, setPaging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const live = useRef({state, draft});
  live.current = {state, draft};

  const entries = useMemo(() => collectPromptHistory({messages, threads, currentThreadId: threadId, older}), [messages, threads, threadId, older]);

  useEffect(() => { setState({mode: 'idle'}); setOlder([]); setRemaining(truncated); setPaging(false); setSearchOpen(false); }, [threadId, disabled, truncated]);

  const placeCaret = useCallback(() => {
    requestAnimationFrame(() => {
      const field = input.current;
      if (field) { field.selectionStart = field.selectionEnd = field.value.length; field.scrollTop = field.scrollHeight; }
    });
  }, [input]);

  const pageOlder = useCallback((list: PromptHistoryEntry[], index: number) => {
    const lastCurrent = list.filter(entry => entry.current).at(-1);
    if (!threadId || !lastCurrent || list[index]?.id !== lastCurrent.id || remaining <= 0 || paging) return;
    const oldest = [...messages, ...older].filter(message => message.threadId === threadId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!oldest) return;
    setPaging(true);
    getThreadMessages(threadId, oldest.id, 300)
      .then(page => {
        const known = new Set([...messages, ...older].map(message => message.id));
        setOlder(previous => [...previous, ...page.messages.filter(message => !known.has(message.id))]);
        setRemaining(page.truncated);
      })
      .catch(() => { if (import.meta.env.DEV) console.warn('Prompt history page failed; it will retry at the same boundary.'); })
      .finally(() => setPaging(false));
  }, [threadId, remaining, paging, messages, older]);

  const keyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const action = historyKeyAction(event, {
      draft: live.current.draft, selectionStart: field.selectionStart, selectionEnd: field.selectionEnd,
      shown: live.current.state.mode === 'browsing' ? shown : live.current.draft,
      browsing: live.current.state.mode === 'browsing',
      composing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
      disabled,
    });
    if (action === 'none') return false;
    if (action === 'search') { event.preventDefault(); setSearchOpen(true); return true; }
    if (action === 'restore') { event.preventDefault(); event.stopPropagation(); setState({mode: 'idle'}); return true; }
    const step = stepHistory(live.current.state, entries, action, live.current.draft);
    if (!step) return false;
    event.preventDefault();
    setState(step.state);
    setShown(step.text);
    if (step.state.mode === 'browsing') { pageOlder(entries, step.state.index); }
    placeCaret();
    return true;
  }, [disabled, entries, pageOlder, placeCaret, shown]);

  const onDraftChange = useCallback(() => { if (live.current.state.mode === 'browsing') setState({mode: 'idle'}); }, []);

  const choose = useCallback((entry: PromptHistoryEntry) => {
    setState({mode: 'idle'});
    setSearchOpen(false);
    write(entry.text);
    placeCaret();
    requestAnimationFrame(() => input.current?.focus());
  }, [write, input, placeCaret]);

  const closeSearch = useCallback(() => { setSearchOpen(false); requestAnimationFrame(() => input.current?.focus()); }, [input]);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  const position = state.mode === 'browsing'
    ? Math.max(1, (entries.findIndex(entry => entry.id === state.entryId) + 1) || state.index + 1)
    : 0;
  const current = state.mode === 'browsing' ? entries[position - 1] : undefined;
  const sourceTitle = current && !current.current ? threads.find(thread => thread.id === current.threadId)?.title ?? null : null;

  // Keep the last chip briefly after browsing ends so the caption can animate out.
  const total = entries.length;
  const [heldChip, setHeldChip] = useState<{position: number; total: number; sourceTitle: string | null} | null>(null);
  useEffect(() => {
    if (state.mode === 'browsing') { setHeldChip(previous => (previous?.position === position && previous?.total === total && previous?.sourceTitle === sourceTitle) ? previous : {position, total, sourceTitle}); return; }
    if (!heldChip) return;
    const timer = setTimeout(() => setHeldChip(null), 140);
    return () => clearTimeout(timer);
  }, [state.mode, position, total, sourceTitle]);

  return {
    browsing: state.mode === 'browsing',
    shown,
    entries,
    position,
    total,
    sourceTitle,
    chip: heldChip,
    chipExiting: state.mode !== 'browsing' && heldChip !== null,
    searchOpen,
    keyDown,
    openSearch,
    closeSearch,
    choose,
    onDraftChange,
  };
}
