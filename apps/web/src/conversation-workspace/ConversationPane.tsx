import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import type {ConversationReadState} from './reader';
import type {ScopedConversation} from './useScopedConversation';
import './conversation-pane.css';

export interface ConversationPaneProps {
  conversation: ScopedConversation;
  hidden?: boolean;
  renderComposer?: (state: ConversationReadState) => ReactNode;
  renderContext?: (state: ConversationReadState) => ReactNode;
}
/** Presentation only. The ordinary composer and all command admission belong to the parent. */
export function ConversationPane({conversation: {state, reader}, hidden = false, renderComposer, renderContext}: ConversationPaneProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const reading = useRef<{key: string | null; follow: boolean; top: number; anchor: {id: string; offset: number} | null; latest: string | null}>({key: null, follow: true, top: 0, anchor: null, latest: null});
  const focusAfterRead = useRef<string | null>(null);
  const [atBottom, setAtBottom] = useState(true), [newMessages, setNewMessages] = useState(false);
  const latest = state.messages.at(-1)?.head.id ?? null;
  function remember() {
    const element = viewport.current;
    if (!element || hidden || !state.messages.length || !element.getClientRects().length) return;
    const value = reading.current, top = element.getBoundingClientRect().top;
    value.top = element.scrollTop;
    value.follow = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.getBoundingClientRect().bottom > top + 1);
    value.anchor = anchor ? {id: anchor.dataset.messageId!, offset: anchor.getBoundingClientRect().top - top} : null;
    setAtBottom(value.follow); if (value.follow) setNewMessages(false);
  }
  useLayoutEffect(() => {
    const element = viewport.current, value = reading.current;
    if (value.key !== state.selectionKey) {
      reading.current = {key: state.selectionKey, follow: true, top: 0, anchor: null, latest: null};
      setAtBottom(true); setNewMessages(false); focusAfterRead.current = null;
    }
    if (!element || hidden || !state.messages.length) return;
    const saved = reading.current;
    if (saved.latest && latest !== saved.latest && !saved.follow) setNewMessages(true);
    saved.latest = latest;
    function restore() {
      if (!element || !element.getClientRects().length) return;
      if (saved.follow) element.scrollTop = element.scrollHeight;
      else {
        const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.dataset.messageId === saved.anchor?.id);
        element.scrollTop = anchor && saved.anchor ? element.scrollTop + anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.anchor.offset : saved.top;
      }
    }
    restore();
    if (focusAfterRead.current && !state.historyPending && !state.messages.some(item => item.pending)) {
      if (document.activeElement === document.body) Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.dataset.messageId === focusAfterRead.current)?.focus({preventScroll: true});
      focusAfterRead.current = null;
    }
    remember();
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [state.selectionKey, state.messages, state.historyPending, hidden, latest]);
  const pending = state.pending || state.historyPending;
  return <section className="scoped-conversation" hidden={hidden} aria-label="Optional conversation">
    {renderContext && <div className="scoped-conversation-context">{renderContext(state)}</div>}
    <div ref={viewport} className="scoped-conversation-transcript" role="region" aria-label="Conversation transcript" aria-busy={pending} tabIndex={0} onScroll={remember}>
      <div className="scoped-conversation-messages">
        {state.nextCursor && <button type="button" className="ui-action-trigger" disabled={pending || state.historyLimited} onClick={() => {focusAfterRead.current = reading.current.anchor?.id ?? state.messages[0]?.head.id ?? null; void reader.loadOlder();}}>{state.historyLimited ? 'History limit reached' : state.historyPending ? 'Loading older messages…' : 'Load older messages'}</button>}
        {state.messages.map(message => <article key={message.head.id} data-message-id={message.head.id} className="scoped-conversation-message" tabIndex={-1} aria-label={message.head.role === 'user' ? 'You' : message.head.role === 'assistant' ? 'Assistant' : 'Activity'}>
          <span className="scoped-conversation-role">{message.head.role === 'user' ? 'You' : message.head.role === 'assistant' ? 'Assistant' : 'Activity'}</span>
          <div className="scoped-conversation-text">{message.text}</div>
          {message.tail.nextContentCursor && <button type="button" className="ui-action-trigger" disabled={message.pending || message.limited} onClick={() => {focusAfterRead.current = message.head.id; void reader.loadContent(message.head.id);}}>{message.limited ? 'Content limit reached' : message.pending ? 'Loading text…' : 'Read more'}</button>}
        </article>)}
        {state.pending && <p role="status">{state.phase === 'resync' ? 'Refreshing conversation…' : 'Loading conversation…'}</p>}
        {!state.pending && state.phase === 'ready' && !state.messages.length && <p>No messages yet.</p>}
        {state.error && <div role="alert"><p>{state.error}</p>{state.phase === 'error' && <button type="button" className="ui-action-trigger" onClick={() => {void reader.retry();}}>Retry</button>}</div>}
      </div>
    </div>
    {!atBottom && state.messages.length > 0 && <div className="scoped-conversation-jump"><button type="button" className="ui-action-trigger" onClick={() => {reading.current.follow = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; remember();}}>{newMessages ? 'New messages · Jump to latest' : 'Jump to latest'}</button></div>}
    {renderComposer && <div className="scoped-conversation-composer">{renderComposer(state)}</div>}
  </section>;
}
