import {useEffect, useRef, useState} from 'react';
import type {ResearchFileReference, ResearchSource} from '../../../../packages/contracts/research';
import {Modal} from '../../../../packages/ui-shell/Modal';
import {Select} from '../../../../packages/ui-shell/Select';
import {PendingStatus} from '../LoadingState';
import {researchClient, researchError, type ResearchSelection} from './client';

export interface ResearchImportDraft {fields?:{mode:string;title:string;text:string;url:string;fileIndex:string;path:string};operation?:{signature:string;sourceId:string;commandId:string}}
export interface ResearchFilePage {pending:boolean;hasMore:boolean;error?:string;more():void}
export interface ResearchGrantedFile {resourceId: string; label: string; relativePath?: string}
export type ResearchBrowserCapability = {available: false} | {available: true; authorized: true; browserId: string; navigationId: string; label: string};
export function SourceImport({selection, draft, disabled=false, open, onClose, files, browser, filePage, onCaptured}: {
  selection: ResearchSelection; draft?:ResearchImportDraft; disabled?: boolean; open: boolean; onClose: () => void; files: readonly ResearchGrantedFile[];
  browser?: ResearchBrowserCapability; filePage?: ResearchFilePage; onCaptured: (source: ResearchSource) => void;
}) {
  const [mode, setMode] = useState(draft?.fields?.mode??'text'), [title, setTitle] = useState(draft?.fields?.title??''), [text, setText] = useState(draft?.fields?.text??''), [url, setUrl] = useState(draft?.fields?.url??'');
  const [fileIndex, setFileIndex] = useState(draft?.fields?.fileIndex??'0'), [path, setPath] = useState(draft?.fields?.path??''), [reference, setReference] = useState<ResearchFileReference>();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const operation = useRef<{signature: string; sourceId: string; commandId: string} | undefined>(draft?.operation);
  const file = files[Number(fileIndex)],live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{if(draft)draft.fields={mode,title,text,url,fileIndex,path};},[draft,mode,title,text,url,fileIndex,path]);
  useEffect(()=>{setReference(undefined);},[file?.resourceId,file?.relativePath]);
  const available=()=>live.current&&(!selection.isCurrent||selection.isCurrent());
  async function verify() {
    if (!file||disabled||!available()) return;
    setPending(true); setError(''); setReference(undefined);
    try {const value=await researchClient.fileReference(selection, file.resourceId, file.relativePath ?? (path || undefined));if(available())setReference(value);}
    catch (cause) {setError(researchError(cause));} finally {setPending(false);}
  }
  async function capture() {
    setPending(true); setError('');
    try {
      if(disabled||!available())return;
      const signature = JSON.stringify([mode, title, text, url, file?.resourceId, file?.relativePath, path, reference, browser]);
      if (operation.current?.signature !== signature) operation.current = {signature, sourceId: crypto.randomUUID(), commandId: crypto.randomUUID()};
      if(draft)draft.operation=operation.current;
      const {sourceId, commandId} = operation.current, base = {sourceId, title: title.trim(), expectedRevision: 0};
      if (mode === 'bookmark') await researchClient.bookmark(selection, {...base, url}, commandId);
      else {
        const input = mode === 'text' ? {kind: 'text' as const, text} : mode === 'file' && file && reference ?
          {kind: 'file' as const, resourceId: file.resourceId, relativePath: file.relativePath ?? (path || undefined), expected: reference} :
          mode === 'browser' && browser?.available && browser.authorized ? {kind: 'browser' as const, browserId: browser.browserId, navigationId: browser.navigationId} : null;
        if (!input) return;
        await researchClient.capture(selection, {...base, input}, commandId);
      }
      if(!available())return;const source=await researchClient.source(selection, sourceId);if(!available())return;onCaptured(source);
      setTitle(''); setText(''); setUrl(''); setReference(undefined); operation.current = undefined;if(draft){draft.operation=undefined;draft.fields=undefined;} onClose();
    } catch (cause) {if(live.current)setError(researchError(cause)); if (available()&&mode === 'file') setReference(undefined);}
    finally {setPending(false);}
  }
  return <Modal open={open} title="Add source" onClose={() => {if (!pending) onClose();}} className="research-import">
    <form onSubmit={event => {event.preventDefault(); void capture();}}><fieldset disabled={pending||disabled}>
      <label>Source type<Select aria-label="Source type" value={mode} onValueChange={value => {setMode(value); setError('');}} options={[
        {value: 'text', label: 'Pasted text'}, {value: 'file', label: 'Granted file'}, {value: 'bookmark', label: 'URL bookmark'}, {value: 'browser', label: 'Browser capture'},
      ]} /></label>
      <label>Source title<input aria-label="Source title" required maxLength={300} value={title} onChange={event => setTitle(event.target.value)} /></label>
      {mode === 'text' && <label>Source text<textarea aria-label="Source text" required value={text} onChange={event => setText(event.target.value)} rows={8} /></label>}
      {mode === 'bookmark' && <><label>Source URL<input aria-label="Source URL" type="url" required value={url} onChange={event => setUrl(event.target.value)} /></label><p className="research-meta">Bookmark only. No page content is read or captured.</p></>}
      {mode === 'file' && <>{files.length ? <>
        <label>Granted file<Select aria-label="Granted file" value={fileIndex} onValueChange={value => {setFileIndex(value); setReference(undefined); setPath('');}} options={files.map((file, index) => ({value: String(index), label: file.label}))} /></label>
        {file?.relativePath === undefined && <label>Path inside grant (optional)<input aria-label="Path inside grant" value={path} onChange={event => {setPath(event.target.value); setReference(undefined);}} /></label>}
        <button type="button" onClick={() => void verify()}>Verify granted file</button>
        {reference && <p className="research-meta">Verified · {reference.bytes} bytes <code>{reference.sha256}</code></p>}
      </> : <p>No file grants. Grant a file from this conversation, then retry.</p>}{filePage&&(filePage.hasMore||filePage.error)&&<button type="button" disabled={filePage.pending} onClick={filePage.more}>{filePage.error?'Retry granted files':'More granted files'}</button>}{filePage?.error&&<p role="alert">{filePage.error}</p>}<PendingStatus pending={Boolean(filePage?.pending)} label="Loading granted files..."/></>}
      {mode === 'browser' && <p>{browser?.available && browser.authorized ? `Authorized capture: ${browser.label}` : 'Browser capture is unavailable on this host. Paste text or save a bookmark.'}</p>}
      <button type="submit" disabled={!title.trim() || mode === 'file' && !reference || mode === 'browser' && !(browser?.available && browser.authorized)}> {mode === 'bookmark' ? 'Save bookmark' : 'Capture source'}</button>
    </fieldset><PendingStatus pending={pending} label="Capturing source…" />{error && <p role="alert">{error}</p>}</form>
  </Modal>;
}
