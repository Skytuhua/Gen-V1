import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import type { Snapshot, TaskMemory as Note } from '../../../packages/contracts';
import { command } from './api';
import { journalRead, journalWrite, journalCompareAndSwap, journalGeneration } from './journal';
import './task-memory.css';

function MemoryNote({ note, threadId, fresh = false }: { note: Note; threadId: string; fresh?: boolean }) {
  const [key, setKey] = useState(note.key), [content, setContent] = useState(note.content), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(''); const dirty = useRef(false); const baseRevision = useRef(note.revision); const journalKey = `memory-draft:${threadId}:${fresh ? 'create' : 'saved:' + note.key}`;
  useEffect(() => { let alive = true; void journalRead<{ key: string; content: string; baseRevision: number }>(journalKey).then(saved => { if (alive && saved && !dirty.current) { setKey(saved.key); setContent(saved.content); baseRevision.current = Number.isSafeInteger(saved.baseRevision) ? saved.baseRevision : -1; generation.current = journalGeneration(journalKey) ?? ''; dirty.current = true; } }).catch(() => { if (alive) setError('Note recovery is unavailable. Keep this window open until you save.'); }); return () => { alive = false; }; }, [journalKey]);
  useEffect(() => { if (!dirty.current) { setKey(note.key); setContent(note.content); baseRevision.current = note.revision; } }, [note.key, note.content, note.revision]);
  const edit = (nextKey: string, nextContent: string) => { dirty.current = true; setKey(nextKey); setContent(nextContent); void journalWrite(journalKey, { key: nextKey, content: nextContent, baseRevision: baseRevision.current }).catch(() => setError('Draft recovery could not be saved. Save this note before closing.')); generation.current = journalGeneration(journalKey) ?? ''; };
  const act = async (remove = false) => {
    if (busy) return; const submitted = generation.current; setBusy(true); setError('');
    try {
      const receipt = await command(remove ? 'memory.delete' : 'memory.save', remove ? { key: note.key, baseRevision: baseRevision.current } : { key, content, baseRevision: baseRevision.current }, threadId);
      if (submitted) await journalCompareAndSwap(journalKey, submitted, null);
      if (generation.current === submitted) { dirty.current = false; baseRevision.current = fresh ? 0 : (receipt.result as Note)?.revision ?? note.revision; if (fresh) { setKey(''); setContent(''); } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The note could not be saved. Your draft is retained.'); }
    finally { setBusy(false); }
  };
  return <form className="memory-note" onSubmit={event => { event.preventDefault(); void act(); }}>
    {fresh ? <label>Note key<input required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}" maxLength={64} placeholder="e.g. date-format" value={key} disabled={busy} onChange={e => edit(e.target.value, content)} /></label> : <header><strong>{note.key}</strong><small>{note.author === 'agent' ? 'Agent note' : 'Your note'}</small></header>}
    <label><span className="sr-only">{fresh ? 'New thread note' : `Note ${note.key}`}</span><textarea required rows={3} maxLength={768} disabled={busy} placeholder="A decision or constraint to remember…" value={content} onChange={e => edit(key, e.target.value)} /></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    {!fresh && dirty.current && note.revision !== baseRevision.current && <details><summary>A newer saved note is available</summary><p>{note.content}</p><button type="button" className="secondary" disabled={busy} onClick={() => { const version = generation.current; dirty.current = false; baseRevision.current = note.revision; setContent(note.content); setError(''); if (version) void journalCompareAndSwap(journalKey, version, null).catch(() => setError('Draft recovery could not be cleared.')); }}>Use saved note</button></details>}
    <footer>{!fresh && <button type="button" className="icon-button" aria-label={`Forget ${note.key}`} disabled={busy} onClick={() => void act(true)}><Trash2 size={14} /></button>}<button className="secondary" disabled={busy || !content.trim() || !key.trim()}>{busy ? 'Saving…' : fresh ? 'Add note' : 'Save note'}</button></footer>
  </form>;
}
export function TaskMemory({ snapshot, threadId }: { snapshot: Snapshot; threadId?: string }) {
  const [adding, setAdding] = useState(false);
  const notes = (snapshot.memory ?? []).filter(note => note.threadId === threadId);
  return <section className="task-memory" aria-label="Thread memory"><header><BookOpen size={16} /><h3>Thread memory</h3><span>{notes.length}/12</span><button className="icon-button" aria-label="Add memory note" disabled={!threadId || notes.length >= 12} onClick={() => setAdding(value => !value)}><Plus size={15} /></button></header><p className="muted">Brief notes retained across sessions and compaction. Only this thread can use them. Notes never authorize actions.</p>{!notes.length && !adding && <p className="muted">No saved notes.</p>}{threadId && notes.map(note => <MemoryNote key={`${threadId}:saved:${note.key}`} note={note} threadId={threadId} />)}{threadId && adding && <MemoryNote key={`${threadId}:create`} fresh threadId={threadId} note={{ id: '', threadId, key: '', content: '', revision: 0, author: 'user', updatedAt: '' }} />}</section>;
}
