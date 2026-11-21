import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import type {ConversationReadState} from './reader';
import type {ConversationMessage} from '../../../../packages/contracts/conversation-read-models';
import type {ScopedConversation} from './useScopedConversation';
import './conversation-pane.css';
import {ConversationFind} from '../ConversationFind';
import {ErrorState} from '../../../../packages/ui-shell/Feedback';
import {addBookmark, removeBookmark, BOOKMARK_FULL_MESSAGE} from '../message-bookmarks';
import {BookmarksControl, BookmarkToggle, useBookmarks} from '../MessageBookmarks';

export interface ConversationPaneProps {
  conversation: ScopedConversation;
  hidden?: boolean;
  renderComposer?: (state: ConversationReadState) => ReactNode;
  renderContext?: (state: ConversationReadState) => ReactNode;
}
/** Presentation only. The ordinary composer and all command admission belong to the parent. */
export function ConversationPane({conversation: {state, reader}, hidden = false, renderComposer, renderContext}: ConversationPaneProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const scope = useRef<HTMLElement>(null);
  const reading = useRef<{key: string | null; follow: boolean; top: number; anchor: {id: string; offset: number} | null; latest: string | null}>({key: null, follow: true, top: 0, anchor: null, latest: null});
  const focusAfterRead = useRef<string | null>(null);
  const focusedMessage = useRef<string | null>(null);
  useLayoutEffect(() => {
    const document = viewport.current?.ownerDocument; if (!document) return;
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target as Element | null, article = target?.closest?.('[data-message-id]') as HTMLElement | null;
      focusedMessage.current = article && viewport.current?.contains(article) ? article.dataset.messageId ?? null : null;
    };
    const releaseFocus = () => {focusedMessage.current = null;};
    document.addEventListener('focusin', rememberFocus); document.addEventListener('pointerdown', releaseFocus, true);
    return () => {document.removeEventListener('focusin', rememberFocus); document.removeEventListener('pointerdown', releaseFocus, true);};
  }, []);
  const [atBottom, setAtBottom] = useState(true), [newMessages, setNewMessages] = useState(false);
  const [notice, setNotice] = useState('');
  const bookmarkOwner = hidden || state.phase !== 'ready' ? undefined : state.context?.owner.threadId;
  const {list: bookmarkList, loading: bookmarkLoading, refresh: refreshBookmarks} = useBookmarks(bookmarkOwner);
  const bookmarkIds = new Set(bookmarkList.kind === 'ready' ? bookmarkList.items.map(item => item.messageId) : []);
  const pendingSeek = useRef<string | null>(null);
  function pulseMessage(id: string) {
    const element = viewport.current;
    const row = element && Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.dataset.messageId === id);
    if (!row) return;
    row.scrollIntoView({block: 'center', behavior: 'auto'});
    row.classList.add('bookmark-pulse');
    setTimeout(() => row.classList.remove('bookmark-pulse'), 800);
    row.focus({preventScroll: true});
  }
  function toggleBookmark(head: ConversationMessage) {
    const owner = state.context?.owner.threadId;
    if (!owner || (head.role !== 'user' && head.role !== 'assistant')) return;
    void (bookmarkIds.has(head.id) ? removeBookmark(owner, head.id) : addBookmark(owner, {messageId: head.id, role: head.role})).then(result => {
      setNotice(result === 'saved' ? 'Bookmark saved.' : result === 'removed' ? 'Bookmark removed.' : result === 'full' ? BOOKMARK_FULL_MESSAGE : result === 'already' ? 'Already bookmarked.' : result === 'absent' ? 'Bookmark already removed.' : 'Bookmark could not be saved.');
    });
  }
  async function jumpToBookmark(messageId: string) {
    if (!state.context) return false;
    const element = viewport.current;
    if (element && Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).some(item => item.dataset.messageId === messageId)) { pulseMessage(messageId); return true; }
    pendingSeek.current = messageId;
    const landed = await reader.seekAnchor(messageId);
    if (!landed) { pendingSeek.current = null; setNotice('Message no longer available.'); }
    return landed;
  }
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
      setAtBottom(true); setNewMessages(false); focusAfterRead.current = null; focusedMessage.current = null;
    }
    if (state.phase !== 'ready') focusedMessage.current = null;
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
    if (pendingSeek.current && state.anchorId === pendingSeek.current && !state.historyPending) {
      const id = pendingSeek.current;
      pendingSeek.current = null;
      pulseMessage(id);
    }
    const restoreFocus = focusAfterRead.current ?? focusedMessage.current;
    if (restoreFocus && !state.historyPending && !state.messages.some(item => item.pending)) {
      if (element.ownerDocument.activeElement === element.ownerDocument.body) Array.from(element.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.dataset.messageId === restoreFocus)?.focus({preventScroll: true});
      focusAfterRead.current = null;
      if (!state.messages.some(item => item.head.id === restoreFocus)) focusedMessage.current = null;
    }
    remember();
    const observer = new ResizeObserver(restore);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [state.selectionKey, state.messages, state.historyPending, state.phase, state.anchorId, hidden, latest]);
  const pending = state.pending || state.historyPending;
  return <section ref={scope} className="scoped-conversation" hidden={hidden} aria-label="Optional conversation">
    <p className="sr-only" role="status">{notice}</p>
    {bookmarkOwner && <div className="scoped-conversation-bookmarks"><BookmarksControl list={bookmarkList} loading={bookmarkLoading} onJump={jumpToBookmark} onRemove={id => { void removeBookmark(bookmarkOwner, id).then(result => setNotice(result === 'removed' ? 'Bookmark removed.' : 'Bookmark could not be removed.')); }} onRetry={refreshBookmarks} /></div>}
    {renderContext && <div className="scoped-conversation-context">{renderContext(state)}</div>}
    <ConversationFind ownerKey={state.selectionKey ?? 'closed'} transcript={viewport} scope={scope} active={!hidden} onNavigate={() => {reading.current.follow = false; remember();}} onLoadEarlier={state.nextCursor ? () => {void reader.loadOlder();} : undefined} historyPending={pending} historyLimited={state.historyLimited} historyError={state.error}/>
    <div ref={viewport} className="scoped-conversation-transcript" role="region" aria-label="Conversation transcript" aria-busy={pending} tabIndex={0} onScroll={remember}>
      <div className="scoped-conversation-messages">
        {state.anchorId && <div className="bookmark-seek-banner" role="status">Viewing older messages<button type="button" className="quiet" onClick={() => { void reader.returnToLatest(); }}>Return to latest</button></div>}
        {state.nextCursor && <button type="button" className="ui-action-trigger" disabled={pending || state.historyLimited} onClick={() => {focusAfterRead.current = reading.current.anchor?.id ?? state.messages[0]?.head.id ?? null; void reader.loadOlder();}}>{state.historyLimited ? 'History limit reached' : state.historyPending ? 'Loading older messages…' : 'Load older messages'}</button>}
        {state.messages.map(message => <article key={message.head.id} data-message-id={message.head.id} className="scoped-conversation-message" tabIndex={-1} aria-label={message.head.role === 'user' ? 'You' : message.head.role === 'assistant' ? 'Assistant' : 'Activity'}>
          <span className="scoped-conversation-role">{message.head.role === 'user' ? 'You' : message.head.role === 'assistant' ? 'Assistant' : 'Activity'}</span>
          {bookmarkOwner && (message.head.role === 'user' || message.head.role === 'assistant') && <BookmarkToggle pressed={bookmarkIds.has(message.head.id)} onToggle={() => toggleBookmark(message.head)} />}
          <div className="scoped-conversation-text">{message.text}</div>
          {message.tail.nextContentCursor && <button type="button" className="ui-action-trigger" disabled={message.pending || message.limited} onClick={() => {focusAfterRead.current = message.head.id; void reader.loadContent(message.head.id);}}>{message.limited ? 'Content limit reached' : message.pending ? 'Loading text…' : 'Read more'}</button>}
        </article>)}
        {state.pending && <p role="status">{state.phase === 'resync' ? 'Refreshing conversation…' : 'Loading conversation…'}</p>}
        {!state.pending && state.phase === 'ready' && !state.messages.length && <p>No messages yet.</p>}
        {state.error && <ErrorState message={state.error} onRetry={state.phase === 'error' ? () => {void reader.retry();} : undefined} />}
      </div>
    </div>
    {!atBottom && state.messages.length > 0 && <div className="scoped-conversation-jump"><button type="button" className="ui-action-trigger" onClick={() => {reading.current.follow = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; remember();}}>{newMessages ? 'New messages · Jump to latest' : 'Jump to latest'}</button></div>}
    {renderComposer && <div className="scoped-conversation-composer">{renderComposer(state)}</div>}
  </section>;
}
