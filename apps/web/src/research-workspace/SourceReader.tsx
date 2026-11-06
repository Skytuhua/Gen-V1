import {useEffect, useRef, useState} from 'react';
import type {ResearchPassage, ResearchSource} from '../../../../packages/contracts/research';
import {ApiError} from '../api';
import {PendingStatus} from '../LoadingState';
import {researchClient, researchError, type ResearchSelection} from './client';

export function SourceIdentity({source}: {source: ResearchSource}) {
  const identity = source.identity;
  return <dl className="research-metadata"><div><dt>Source</dt><dd>{identity.kind === 'file' ? `Granted file · ${identity.resourceId}` : identity.kind === 'text' ? 'Pasted text' : identity.url}</dd></div>
    <div><dt>ID</dt><dd>{source.id}</dd></div>
    <div><dt>Revision</dt><dd>{source.revision} · {source.bytes} bytes</dd></div>
    {source.capturedAt && <div><dt>Captured</dt><dd><time dateTime={source.capturedAt}>{new Date(source.capturedAt).toLocaleString()}</time></dd></div>}
    {source.sha256 && <div><dt>SHA-256</dt><dd><code>{source.sha256}</code></dd></div>}
  </dl>;
}
export function SourceReader({selection, source, onCite}: {selection: ResearchSelection; source: ResearchSource; onCite: (passage: ResearchPassage) => void}) {
  const [page, setPage] = useState<{text: string; ref: ResearchPassage; status: string}>(), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [range, setRange] = useState<{start: number; end: number}>(), [history, setHistory] = useState<number[]>([]);
  const reading = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    // Re-check cached file text on focus; revocation must not replay a cached passage.
    const clear = () => {reading.current?.abort(); reading.current = undefined; setPending(false); setPage(undefined); setRange(undefined);};
    window.addEventListener('blur', clear); return () => {reading.current?.abort(); window.removeEventListener('blur', clear);};
  }, []);
  async function load(start: number) {
    if (!source.sha256) return;
    reading.current?.abort();
    const controller = reading.current = new AbortController();
    setPending(true); setError(''); setPage(undefined); setRange(undefined);
    try {
      let end = Math.min(source.bytes, start + 64000);
      // A page boundary can bisect one UTF-8 character. Move only its end back to a valid boundary.
      for (let attempt = 0; ; attempt++, end--) {
        const ref = {sourceId: source.id, revision: source.revision, sha256: source.sha256, start, end};
        try {const result = await researchClient.passage(selection, ref, controller.signal); if (!controller.signal.aborted) setPage({...result, ref}); break;}
        catch (cause) {if (!(cause instanceof ApiError) || cause.code !== 'INVALID_SOURCE' || attempt === 3) throw cause;}
      }
    } catch (cause) {if (!controller.signal.aborted) setError(researchError(cause));}
    finally {if (reading.current === controller) {reading.current = undefined; setPending(false);}}
  }
  return <article className="research-document"><h2>{source.title}</h2><SourceIdentity source={source} />
    {source.status !== 'captured' ? <p>Bookmark only. Page content has not been read.</p> : <>
      <div className="research-actions"><button disabled={pending} onClick={() => {setHistory([]); void load(0);}}>Read captured source</button><span className="research-meta">Captured material · live source unverified</span></div>
      <PendingStatus pending={pending} label="Reading capture…" />
      {page && <><p className="research-meta">{page.status === 'stale' ? 'Stale capture' : 'Current capture'} · bytes {page.ref.start}–{page.ref.end} of {source.bytes}</p>
        <textarea aria-label="Captured passage" readOnly value={page.text} rows={12} onSelect={event => {
          const node = event.currentTarget, encoder = new TextEncoder();
          setRange(node.selectionEnd > node.selectionStart ? {start: page.ref.start + encoder.encode(page.text.slice(0, node.selectionStart)).length, end: page.ref.start + encoder.encode(page.text.slice(0, node.selectionEnd)).length} : undefined);
        }} />
        <div className="research-actions"><button onClick={() => onCite({...page.ref, ...(range ?? {})})}>Cite passage in findings</button>
          {history.length > 0 && <button disabled={pending} onClick={() => {const previous = history.at(-1)!; setHistory(history.slice(0, -1)); void load(previous);}}>Previous passage</button>}
          {page.ref.end < source.bytes && <button disabled={pending} onClick={() => {setHistory([...history, page.ref.start]); void load(page.ref.end);}}>Next passage</button>}
        </div></>}
      {error && <p role="alert">{error} <button onClick={() => void load(0)}>Retry passage</button></p>}
    </>}
  </article>;
}
