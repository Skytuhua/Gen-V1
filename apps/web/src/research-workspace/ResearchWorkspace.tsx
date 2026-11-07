import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {ResearchDocument, ResearchPassage, ResearchSource} from '../../../../packages/contracts/research';
import {ActionMenu} from '../../../../packages/ui-shell/ActionMenu';
import {isComposing} from '../../../../packages/ui-shell/list-navigation';
import {LoadingState, PendingStatus} from '../LoadingState';
import {ApiError} from '../api';
import {researchClient, researchError, researchScope, type ResearchDocumentHead, type ResearchDocumentRead, type ResearchResource, type ResearchSelection} from './client';
import {researchDrafts, type ResearchDraft, type ResearchDrafts} from './drafts';
import {SourceImport, type ResearchGrantedFile, type ResearchBrowserCapability} from './SourceImport';
import {SourceReader} from './SourceReader';
import {PassageInspector} from './PassageInspector';
import './research-workspace.css';

export type {ResearchSelection, ResearchResource} from './client';
export type {ResearchGrantedFile, ResearchBrowserCapability} from './SourceImport';
export interface ResearchWorkspaceProps {
  selection: ResearchSelection; topic: string; onNavigate: (selection: ResearchSelection) => void;
  grantedFiles?: readonly ResearchGrantedFile[]; browserCapture?: ResearchBrowserCapability;
  chat?: ReactNode; chatOpen?: boolean; onChatOpenChange?: (open: boolean) => void; drafts?: ResearchDrafts;
}
export function ResearchWorkspace(props: ResearchWorkspaceProps) {
  if (props.selection.authority.kind !== 'personal') return <p role="alert">Research is available in personal conversations.</p>;
  return <ResearchBody key={researchScope(props.selection)} {...props} />;
}
function ResearchBody({selection, topic, onNavigate, grantedFiles = [], browserCapture, chat, chatOpen = false, onChatOpenChange, drafts = researchDrafts}: ResearchWorkspaceProps) {
  const [resource, setResource] = useState<ResearchResource | null>(selection.resource), [sources, setSources] = useState<ResearchSource[]>([]), [documents, setDocuments] = useState<ResearchDocumentHead[]>([]);
  const [cursors, setCursors] = useState<{sources: string | null; documents: string | null}>({sources: null, documents: null});
  const [pending, setPending] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [importOpen, setImportOpen] = useState(false), [menuOpen, setMenuOpen] = useState(false), [draftVersion, setDraftVersion] = useState(0), [target, setTarget] = useState<string>();
  const [passage, setPassage] = useState<ResearchPassage>(), [passageVisit, setPassageVisit] = useState(0), [width, setWidth] = useState(244), [chatSize, setChatSize] = useState(45);
  const owner = useRef<HTMLDivElement>(null), current = useRef(true), pageRequest = useRef(false);
  useEffect(() => {current.current = true; return () => {current.current = false;};}, []);
  const bump = () => setDraftVersion(v => v + 1);
  const resourceKey = JSON.stringify(selection.resource);
  useEffect(() => {setResource(selection.resource);}, [resourceKey]); // Parent navigation is revision/resource scoped.
  useEffect(() => {
    const controller = new AbortController(); setPending(true); setError('');
    void Promise.all([researchClient.list(selection, 'sources', undefined, controller.signal), researchClient.list(selection, 'documents', undefined, controller.signal)])
      .then(([a, b]) => {if (!controller.signal.aborted) {setSources(a.items); setDocuments(b.items); setCursors({sources: a.nextCursor, documents: b.nextCursor});}})
      .catch(cause => {if (!controller.signal.aborted) setError(researchError(cause));})
      .finally(() => {if (!controller.signal.aborted) setPending(false);});
    return () => controller.abort();
  }, [refresh]);
  function navigate(next: ResearchResource) {setResource(next); setPassage(undefined); if (next.kind === 'document') setTarget(next.id); onNavigate({...selection, resource: next});}
  function create(kind: ResearchDocument['kind']) {const draft = drafts.create(selection, kind); bump(); navigate({kind: 'document', id: draft.id});}
  async function more(kind: 'sources' | 'documents') {
    if (pageRequest.current || !cursors[kind]) return;
    pageRequest.current = true; setPending(true); setError('');
    try {
      const page = await researchClient.list(selection, kind, cursors[kind]!);
      if (!current.current) return;
      if (kind === 'sources') setSources(values => [...values, ...page.items as ResearchSource[]].filter((v, i, all) => all.findIndex(other => other.id === v.id) === i));
      else setDocuments(values => [...values, ...page.items as ResearchDocumentHead[]].filter((v, i, all) => all.findIndex(other => other.id === v.id) === i));
      setCursors(values => ({...values, [kind]: page.nextCursor}));
    } catch (cause) {if (current.current) setError(researchError(cause));}
    finally {pageRequest.current = false; if (current.current) setPending(false);}
  }
  function cite(ref: ResearchPassage) {
    let draft = target ? drafts.get(selection, target) : undefined;
    if (!draft) draft = drafts.create(selection, 'findings');
    if (!draft.citations.some(item => JSON.stringify(item) === JSON.stringify(ref))) drafts.edit(selection, draft.id, {citations: [...draft.citations, ref]});
    bump(); navigate({kind: 'document', id: draft.id});
  }
  const localDrafts = drafts.all(selection), rows = [...documents, ...localDrafts.filter(d => !documents.some(item => item.id === d.id)).map(d => ({id: d.id, title: d.title, kind: d.kind, revision: d.expectedRevision}))];
  return <section className="research-workspace" aria-label="Research workspace" data-chat={chatOpen && Boolean(chat)}>
    <header className="research-toolbar"><span className="research-topic" title={topic}>{topic}</span><button onClick={() => setImportOpen(true)}>Add source</button>
      <ActionMenu label="New document" open={menuOpen} onOpenChange={setMenuOpen} items={[{id: 'findings', label: 'Findings', onSelect: () => create('findings')}, {id: 'notes', label: 'Working notes', onSelect: () => create('working-notes')}]} />
      {onChatOpenChange && <button aria-pressed={chatOpen} onClick={() => onChatOpenChange(!chatOpen)}>{chatOpen ? 'Hide chat' : 'Show chat'}</button>}
    </header>
    <div className="research-main" ref={owner} style={{'--research-nav-width': `${width}px`, '--research-chat-size': `${chatSize}%`} as CSSProperties}>
      <nav className="research-navigator" aria-label="Research sources and documents"><div className="research-actions"><h2>Sources</h2><button aria-label="Refresh research" disabled={pending} onClick={() => setRefresh(v => v + 1)}>Refresh</button></div>
        <LoadingState pending={pending} hasContent={sources.length + rows.length > 0} label="Loading research…">
          {!sources.length && <p className="research-meta">Add text or a granted file to begin.</p>}
          <div className="research-source-list">{sources.map(source => <button key={source.id} className="research-source-row" aria-current={resource?.kind === 'source' && resource.id === source.id ? 'page' : undefined} onClick={() => navigate({kind: 'source', id: source.id})}>
            <span>{source.title}</span><small>{source.status === 'captured' ? `${source.identity.kind} · captured · r${source.revision}` : 'Bookmark · not captured'}</small>
          </button>)}</div>
          {cursors.sources && <button disabled={pending} onClick={() => void more('sources')}>More sources</button>}
          <h2>Documents</h2>{!rows.length && <p className="research-meta">Keep findings and working notes here.</p>}
          <div className="research-source-list">{rows.map(document => <button key={document.id} className="research-source-row" aria-current={resource?.kind === 'document' && resource.id === document.id ? 'page' : undefined} onClick={() => navigate({kind: 'document', id: document.id})}>
            <span>{drafts.get(selection, document.id)?.title ?? document.title}</span><small>{document.kind === 'findings' ? 'Findings' : 'Working notes'} · {drafts.get(selection, document.id)?.dirty ? 'Unsaved draft' : `r${document.revision}`}</small>
          </button>)}</div>
          {cursors.documents && <button disabled={pending} onClick={() => void more('documents')}>More documents</button>}
        </LoadingState>{error && <p role="alert">{error} <button onClick={() => setRefresh(v => v + 1)}>Retry research</button></p>}
      </nav>
      <div className="research-divider" role="separator" aria-label="Resize source navigator" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={380} aria-valuenow={width} tabIndex={0}
        onKeyDown={event => {if (isComposing(event)) return; if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault(); setWidth(value => event.key === 'Home' ? 200 : event.key === 'End' ? 380 : Math.max(200, Math.min(380, value + (event.key === 'ArrowLeft' ? -16 : 16))));}}}
        onPointerDown={event => {event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event => {if (event.currentTarget.hasPointerCapture(event.pointerId) && owner.current) setWidth(Math.max(200, Math.min(380, event.clientX - owner.current.getBoundingClientRect().left)));}}
        onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
      <div className="research-reading" aria-label="Selected research item">
        {resource ? resource.kind === 'source' ? <SourcePanel key={JSON.stringify(resource)} selection={selection} resource={resource} onCite={cite} /> :
          <DocumentEditor key={resource.id} selection={selection} resource={resource} drafts={drafts} version={draftVersion} onChange={bump} onInspect={ref => {setPassage({...ref}); setPassageVisit(value => value + 1);}} onSaved={id => {setRefresh(v => v + 1); navigate({kind: 'document', id});}} /> :
          <div className="research-empty"><p>Select a source or start a findings document.</p><button onClick={() => create('findings')}>Start findings</button></div>}
        {passage && <PassageInspector key={JSON.stringify([passage, passageVisit])} selection={selection} passage={passage} onClose={() => setPassage(undefined)} />}
      </div>
      {Boolean(chat) && <aside className="research-chat" aria-label="Research chat" hidden={!chatOpen}><label className="research-chat-size">Chat height<input type="range" aria-label="Chat height" min={20} max={50} value={chatSize} onChange={event => setChatSize(Number(event.target.value))} /></label><div className="research-chat-content">{chat}</div></aside>}
    </div>
    <SourceImport selection={selection} open={importOpen} onClose={() => setImportOpen(false)} files={grantedFiles} browser={browserCapture} onCaptured={source => {setRefresh(v => v + 1); navigate({kind: 'source', id: source.id});}} />
  </section>;
}

function SourcePanel({selection, resource, onCite}: {selection: ResearchSelection; resource: ResearchResource; onCite: (passage: ResearchPassage) => void}) {
  const [source, setSource] = useState<ResearchSource>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setSource(undefined); setError('');
    void researchClient.source(selection, resource.id, resource.revision, controller.signal).then(value => {if (!controller.signal.aborted) setSource(value);}).catch(cause => {if (!controller.signal.aborted) setError(researchError(cause));});
    return () => controller.abort();
  }, [resource.id, resource.revision, retry]);
  return <LoadingState pending={!source && !error} hasContent={Boolean(source)} label="Loading source…">{source && <SourceReader selection={selection} source={source} onCite={onCite} />}{error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Retry source</button></p>}</LoadingState>;
}

function DocumentEditor({selection, resource, drafts, onChange, onInspect, onSaved}: {selection: ResearchSelection; resource: ResearchResource; drafts: ResearchDrafts; version: number; onChange: () => void; onInspect: (ref: ResearchPassage) => void; onSaved: (id: string) => void}) {
  const [loaded, setLoaded] = useState<ResearchDocumentRead>(), [pending, setPending] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState(''), [retry, setRetry] = useState(0);
  const live = useRef(true), saving = useRef(false);
  useEffect(() => {live.current = true; return () => {live.current = false;};}, []);
  useEffect(() => {
    if (drafts.get(selection, resource.id)?.expectedRevision === 0) return;
    const controller = new AbortController(); setPending(true); setError('');
    void researchClient.document(selection, resource.id, resource.revision, controller.signal).then(document => {
      if (!controller.signal.aborted) {setLoaded(document); drafts.open(selection, document); onChange();}
    }).catch(cause => {if (!controller.signal.aborted) setError(researchError(cause));}).finally(() => {if (!controller.signal.aborted) setPending(false);});
    return () => controller.abort();
  }, [resource.id, resource.revision, retry]);
  const draft = drafts.get(selection, resource.id);
  function edit(patch: Partial<Pick<ResearchDraft, 'title' | 'body' | 'citations'>>) {drafts.edit(selection, resource.id, patch); setStatus(''); onChange();}
  const canSave = Boolean(draft && !pending && draft.title.trim() && draft.dirty && !draft.conflict);
  async function save(copy = false) {
    if (!draft || saving.current || (copy ? pending : !canSave)) return;
    saving.current = true; setPending(true); setError(''); setStatus('');
    const attempt = drafts.beginSave(selection, draft.id, copy), sent = attempt.sent;
    let acknowledged = false;
    try {
      const receipt = await researchClient.save(selection, {documentId: sent.id, title: sent.title, kind: sent.kind, body: sent.body, citations: sent.citations, expectedRevision: sent.expectedRevision}, attempt.commandId);
      const result = receipt.result as {documentId?: unknown; revision?: unknown; sha256?: unknown} | null;
      if (receipt.commandId !== attempt.commandId || result?.documentId !== sent.id || result.revision !== sent.expectedRevision + 1 || typeof result.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.sha256)) throw Error('Save receipt unavailable. Retry this save.');
      if (!drafts.finishSave(selection, draft.id, attempt, copy, {revision: result.revision as number, sha256: result.sha256})) return;
      acknowledged = true;
      if (live.current) {setStatus(`Saved revision ${result.revision}`); onChange();}
      const document = await researchClient.document(selection, sent.id, result.revision as number);
      if (live.current) setLoaded(document);
    } catch (cause) {
      if (!acknowledged && cause instanceof ApiError && ['INVALID_INPUT', 'PRECONDITION_FAILED', 'ACCESS_DENIED', 'CAPABILITY_DENIED', 'NOT_FOUND', 'INVALID_CITATION', 'INVALID_SOURCE', 'RESOURCE_LIMIT'].includes(cause.code)) drafts.finishSave(selection, draft.id, attempt, copy);
      if (!acknowledged && cause instanceof ApiError && cause.code === 'PRECONDITION_FAILED') {
        try {const remote = await researchClient.document(selection, sent.id); drafts.open(selection, remote); if (live.current) setLoaded(remote);} catch { /* Retain the original CAS and draft even when the conflict read is offline. */ }
      }
      if (live.current) {setError(researchError(cause)); onChange();}
    } finally {saving.current = false; if (live.current) {setPending(false); if (acknowledged) onSaved(sent.id);}}
  }
  return <LoadingState pending={pending && !draft} hasContent={Boolean(draft)} label="Loading document…">
    {draft && <article className="research-document"><h2>{draft.title}</h2><p className="research-meta">{draft.kind === 'findings' ? 'Findings · synthesis' : 'Working notes'} · {draft.dirty ? 'Unsaved draft' : `Saved revision ${draft.expectedRevision}`}</p>
      <label>Document title<input aria-label="Document title" maxLength={300} value={draft.title} onChange={event => edit({title: event.target.value})} /></label>
      <label>Document body<textarea aria-label="Document body" rows={14} value={draft.body} onChange={event => edit({body: event.target.value})} onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !isComposing(event)) {event.preventDefault(); void save();}
      }} /></label>
      <div className="research-actions"><button disabled={!canSave} onClick={() => void save()}>Save document</button><PendingStatus pending={pending} label="Saving document…" />{status && <span role="status">{status}</span>}</div>
      {loaded && <details className="research-meta"><summary>Saved document identity</summary><p>Revision {loaded.revision} · {loaded.savedAt}</p><code>{loaded.sha256}</code></details>}
      {draft.conflict && <section className="research-conflict" aria-label="Saved version"><h3>Saved version · revision {draft.conflict.revision}</h3><p>Your draft is preserved above.</p><pre>{draft.conflict.body}</pre><button disabled={pending} onClick={() => void save(true)}>Save draft as separate document</button></section>}
      {draft.citations.length > 0 && <section aria-label="Document citations"><h3>Citations</h3><ol>{draft.citations.map((ref, index) => <li key={`${index}:${ref.sourceId}`}><button aria-label={`Inspect citation ${index + 1}, revision ${ref.revision}, bytes ${ref.start} to ${ref.end}`} onClick={() => onInspect(ref)}>Source {index + 1} · r{ref.revision} · bytes {ref.start}–{ref.end}</button><span className="research-meta">{loaded?.citations.find(item => JSON.stringify([item.sourceId, item.revision, item.sha256, item.start, item.end]) === JSON.stringify([ref.sourceId, ref.revision, ref.sha256, ref.start, ref.end]))?.status ?? 'unverified'} · live source unverified</span><button aria-label={`Remove citation ${index + 1}`} onClick={() => edit({citations: draft.citations.filter((_, i) => i !== index)})}>Remove</button></li>)}</ol></section>}
    </article>}
    {error && <p role="alert">{error} <button onClick={() => setRetry(v => v + 1)}>Reload saved version</button></p>}
  </LoadingState>;
}
