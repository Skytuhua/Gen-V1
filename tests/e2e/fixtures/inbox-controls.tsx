import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {InboxView} from '../../../apps/web/src/InboxView';
import type {AttentionItem} from '../../../packages/contracts/attention';
import '../../../apps/web/src/styles.css';

type Mode = 'success' | 'reject' | 'throw' | 'source-error';
type Call = {type: 'refresh' | 'read' | 'unread' | 'open'; id?: string};
declare global {interface Window {inboxControls: {calls: Call[]; items: AttentionItem[]; refreshMode: Mode; readMode: Mode; openMode: Mode; unreadMode?: Mode; holdRead?: Promise<void>; holdUnread?: Promise<void>; holdRefresh?: Promise<void>; holdOpen?: Promise<void>}}}
window.inboxControls = {calls: [], items: [], refreshMode: 'success', readMode: 'success', openMode: 'success'};
const initial: AttentionItem[] = [
  {id: 'question', threadId: 'thread-question', kind: 'request', title: 'Question', summary: 'Choose the destination in the canonical conversation.', state: 'needs-input', read: false, actionable: true},
  {id: 'review', threadId: 'thread-review', kind: 'operation', title: 'Review', summary: 'The change awaits canonical review.', state: 'needs-review', read: true, actionable: true},
  {id: 'failed', threadId: 'thread-failed', kind: 'thread-failed', title: 'Failed task', summary: 'Inspect the reported failure.', state: 'failed', read: false, actionable: false},
  {id: 'completed', threadId: 'thread-completed', kind: 'thread-completed', title: 'Completed task', summary: 'Read the supplied result.', state: 'completed', read: false, actionable: false},
  {id: 'resolved', threadId: 'thread-resolved', kind: 'request', title: 'Resolved question', summary: 'The request is already resolved.', state: 'resolved', read: true, actionable: false},
].map(item => ({...item, createdAt: '2026-11-06T12:00:00Z', updatedAt: '2026-11-06T12:00:00Z', popupDismissed: false, notificationKey: item.id + ':' + item.state, destination: {threadId: item.threadId}} as AttentionItem));

function Fixture() {
  const [items, setItems] = useState(initial), [error, setError] = useState('');
  window.inboxControls.items = items;
  const result = (mode: Mode, message: string, succeed: () => void) => {
    if (mode === 'throw') throw Error(message);
    if (mode === 'reject') return Promise.reject(Error(message));
    succeed(); return Promise.resolve();
  };
  const change = (id: string, read: boolean) => {
    window.inboxControls.calls.push({type: read ? 'read' : 'unread', id});
    const mode=read?window.inboxControls.readMode:window.inboxControls.unreadMode??'success';
    const apply = () => result(mode, read?'Read state could not save.':'Unread state could not save.', () => setItems(current => current.map(item => item.id === id ? {...item, read} : item)));
    const hold=read?window.inboxControls.holdRead:window.inboxControls.holdUnread;return hold?hold.then(apply):apply();
  };
  return <main><p>Synthetic source fixture · no live host or approval authority</p><div className="fixture-inbox"><InboxView projectColorFor={() => undefined}
    attention={{items, unread: items.filter(item => !item.read).length, error,
      refresh: () => {
        window.inboxControls.calls.push({type: 'refresh'});
        const mode=window.inboxControls.refreshMode;const apply=()=>result(mode, 'Refresh failed.', () => {
          if (mode === 'source-error') {setError('Inbox could not load.'); return;}
          setError(''); setItems(current => current.map(item => ({...item, summary: item.summary + ' Refreshed.'})));
        });
        return window.inboxControls.holdRefresh?window.inboxControls.holdRefresh.then(apply):apply();
      }, markRead: id => change(id, true), markUnread: id => change(id, false)}}
    onOpenThread={id => {window.inboxControls.calls.push({type: 'open', id}); const mode=window.inboxControls.openMode,apply=()=>result(mode, 'Navigation failed.', () => {});return window.inboxControls.holdOpen?window.inboxControls.holdOpen.then(apply):apply();}}/>
  </div></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
