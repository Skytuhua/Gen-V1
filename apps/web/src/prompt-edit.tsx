import {useEffect, useRef, useState} from 'react';
import type {Message, Thread} from '../../../packages/contracts/index.ts';
import type {ConversationTurns} from '../../../packages/contracts/conversation-read-models.ts';
import {command} from './api.ts';
import {getConversationContext, getConversationTurns} from './conversation-read-api.ts';
import {CopyButton} from './CopyButton.tsx';
import './prompt-edit.css';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

// In-place edit + rerun of the newest user prompt on an idle main
// conversation (#1532). The server decides eligibility — the surface only
// offers the control on the newest user message of an idle writable main
// thread; rejections stay inline without clearing the typed replacement.
export function PromptEdit({thread, message, editable, onEdited}: {thread: Thread; message: Message; editable: boolean; onEdited: () => void}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ConversationTurns | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const edited = message.turnId !== undefined;

  useEffect(() => { if (open) area.current?.focus(); }, [open]);
  useEffect(() => { setOpen(false); setShowVersions(false); setTurns(null); setError(null); }, [thread.id, message.id]);

  const loadTurns = async () => {
    const context = await getConversationContext({authority: 'personal', threadId: thread.id});
    return getConversationTurns(context, message.turnId ? {turnId: message.turnId} : {});
  };

  const begin = async () => {
    setBusy(true); setError(null);
    try {
      let current = 0;
      if (edited) current = (await loadTurns()).turns[0]?.revision ?? 0;
      setRevision(current); setText(message.content); setOpen(true);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const submit = async () => {
    const content = text;
    if (!content.trim() || content === message.content) { setError('Enter a changed prompt before rerunning.'); return; }
    setBusy(true); setError(null);
    try {
      await command('message.editRerun', {messageId: message.id, expectedRevision: revision, content}, thread.id);
      setOpen(false); setShowVersions(false); onEdited();
    } catch (cause) {
      // The edit stays typed; a stale revision just needs one retry after refresh.
      setError(messageOf(cause));
      void loadTurns().then(next => { const latest = next.turns[0]?.revision; if (latest !== undefined) setRevision(latest); }).catch(() => undefined);
    } finally { setBusy(false); }
  };

  const toggleVersions = async () => {
    if (showVersions) { setShowVersions(false); return; }
    setBusy(true); setError(null);
    try { setTurns(await loadTurns()); setShowVersions(true); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const earlier = turns?.turns.flatMap(turn => turn.versions.filter(version => version.status === 'superseded')) ?? [];
  return <div className="prompt-edit">
    {error && <p className="error-text" role="alert">{error}</p>}
    {open ? <div className="prompt-edit-editor">
      <textarea ref={area} value={text} rows={Math.min(12, Math.max(3, text.split('\n').length))} disabled={busy}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); setOpen(false); setError(null); }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
        }}/>
      <div className="prompt-edit-actions">
        <button className="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Rerunning…' : 'Rerun'}</button>
        <button className="quiet" disabled={busy} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
      </div>
    </div> : <div className="prompt-edit-actions">
      {editable && <button className="quiet" disabled={busy} onClick={() => void begin()} aria-label="Edit prompt and rerun">Edit</button>}
      {edited && <button className="quiet prompt-edit-edited" disabled={busy} onClick={() => void toggleVersions()} aria-expanded={showVersions}>
        Edited{turns ? ` · ${turns.turns[0]?.revision ?? ''}` : ''} · Earlier versions</button>}
    </div>}
    {showVersions && <div className="prompt-edit-versions" role="region" aria-label="Earlier prompt versions">
      {earlier.length === 0 && <p className="muted">Earlier versions unavailable.</p>}
      {earlier.map(version => <div className="prompt-edit-version" key={version.messageId}>
        <div className="prompt-edit-version-head"><span className="muted">v{version.version}</span><CopyButton text={version.content} label="Copy earlier prompt"/></div>
        <p className="prompt-edit-version-prompt">{version.content}</p>
        {version.reply && <details><summary className="muted">Earlier reply</summary><p className="prompt-edit-version-reply">{version.reply}</p></details>}
      </div>)}
    </div>}
  </div>;
}
