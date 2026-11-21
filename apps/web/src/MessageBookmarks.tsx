import {useEffect, useId, useRef, useState} from 'react';
import {Bookmark, X} from 'lucide-react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {readBookmarks, subscribeBookmarks, type BookmarkList} from './message-bookmarks';
import './message-bookmarks.css';

/** Live bookmark list for the visible thread only — no reads for other owners. */
export function useBookmarks(threadId: string | undefined): {list: BookmarkList; loading: boolean; refresh: () => void} {
  const [list, setList] = useState<BookmarkList>({kind: 'empty'});
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!threadId) { setList({kind: 'empty'}); setLoading(false); return; }
    let live = true;
    setLoading(true);
    void readBookmarks(threadId).then(next => { if (live) { setList(next); setLoading(false); } }).catch(() => { if (live) { setList({kind: 'unavailable'}); setLoading(false); } });
    const unsubscribe = subscribeBookmarks(threadId, next => { if (live) setList(next); });
    return () => { live = false; unsubscribe(); };
  }, [threadId, tick]);
  return {list, loading, refresh: () => setTick(value => value + 1)};
}

/** Per-message 32px bookmark toggle. */
export function BookmarkToggle({pressed, onToggle}: {pressed: boolean; onToggle: () => void}) {
  return <button type="button" className="icon-button bookmark-toggle" aria-pressed={pressed} aria-label={pressed ? 'Remove bookmark' : 'Bookmark message'} title={pressed ? 'Remove bookmark' : 'Bookmark message'} onClick={event => {event.stopPropagation(); onToggle();}}><Bookmark size={15} fill={pressed ? 'currentColor' : 'none'} /></button>;
}

const formatSavedAt = (savedAt: number) => {
  const date = new Date(savedAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
};

interface BookmarksControlProps {
  list: BookmarkList;
  loading: boolean;
  onJump: (messageId: string) => Promise<boolean>;
  onRemove: (messageId: string) => void;
  onRetry: () => void;
}
/** Non-modal disclosure listing the visible thread's bookmarks, newest first. */
export function BookmarksControl({list, loading, onJump, onRemove, onRetry}: BookmarksControlProps) {
  const [open, setOpen] = useState(false);
  const [jumping, setJumping] = useState<string | null>(null);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const items = list.kind === 'ready' ? list.items : [];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const jump = async (messageId: string) => {
    if (jumping) return;
    setJumping(messageId);
    try {
      const landed = await onJump(messageId);
      setMissing(previous => {
        const next = new Set(previous);
        if (landed) next.delete(messageId); else next.add(messageId);
        return next;
      });
      if (landed) setOpen(false);
    } finally { setJumping(null); }
  };
  return <div className="bookmarks-disclosure">
    <button type="button" ref={trigger} className="icon-button bookmarks-trigger" aria-label="Bookmarks" aria-expanded={open} aria-controls={open ? panelId : undefined} title="Bookmarks" onClick={() => setOpen(value => !value)}>
      <Bookmark size={17} />
      {items.length > 0 && <span className="bookmarks-count" aria-hidden="true">{items.length}</span>}
    </button>
    <Popover anchor={trigger} contentRef={panel} open={open} width={320} height={Math.min(240, Math.max(84, items.length * 36 + 16))} preferredSide="below" align="end" onDismiss={close} id={panelId} role="dialog" aria-label="Bookmarks" className="bookmarks-panel">
      <div className="bookmarks-panel-body">
        {loading && <p className="bookmarks-panel-status" role="status">Loading bookmarks…</p>}
        {!loading && list.kind === 'empty' && <p className="bookmarks-panel-status">No bookmarks yet.</p>}
        {!loading && (list.kind === 'unavailable' || list.kind === 'corrupt') && <p className="bookmarks-panel-status" role="alert">Bookmarks could not be loaded. <button type="button" className="quiet" onClick={onRetry}>Retry</button></p>}
        {!loading && items.length > 0 && <ul className="bookmarks-list" role="list">
          {items.map(item => <li className="bookmarks-row" key={item.messageId}>
            <button type="button" className="bookmarks-jump" disabled={jumping === item.messageId || missing.has(item.messageId)} onClick={() => void jump(item.messageId)}>
              <span className="bookmarks-role">{item.role === 'user' ? 'You' : 'Assistant'}</span>
              <span className="bookmarks-time">{formatSavedAt(item.savedAt)}</span>
              {missing.has(item.messageId) && <span className="bookmarks-missing">Message no longer available</span>}
            </button>
            <button type="button" className="icon-button" aria-label={`Remove bookmark on ${item.role === 'user' ? 'your' : 'assistant'} message`} onClick={() => { setMissing(previous => { const next = new Set(previous); next.delete(item.messageId); return next; }); onRemove(item.messageId); }}><X size={14} /></button>
          </li>)}
        </ul>}
      </div>
    </Popover>
  </div>;
}
