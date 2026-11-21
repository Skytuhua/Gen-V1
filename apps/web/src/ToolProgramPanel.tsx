import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  nestedCallV1Schema, pythonKernelV1Schema, toolProgramV1Schema,
  type NestedCallV1, type PythonKernelV1, type ToolProgramV1,
} from '../../../packages/contracts/tool-program';
import { sameToolOwner } from '../../../packages/contracts/tool-results';
import { ApiError, authenticated, command, read } from './api';
import './tool-programs.css';

const PAGE_BYTES = 16 * 1024;
const POLL_MS = 4000;
const RESET_NOTICE = 'Reset clears variables. It does not undo files or prior remote effects. Previous cells are never replayed.';
const modelSchema = z.strictObject({
  programs: z.array(z.strictObject({ program: toolProgramV1Schema, calls: z.array(nestedCallV1Schema).max(64), sourceRefs: z.array(z.string().min(1).max(200)).max(256) })).max(200),
  kernels: z.array(pythonKernelV1Schema).max(200),
  available: z.strictObject({ javascript: z.boolean(), python: z.boolean(), replay: z.boolean() }),
  resetNotice: z.string().max(4096),
});
type ProgramModel = z.infer<typeof modelSchema>;
type ProgramEntry = ProgramModel['programs'][number];
const rangeSchema = z.strictObject({
  resultRef: z.string().min(1).max(200), revision: z.literal(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative().max(8 * 1024 * 1024), status: z.enum(['SUCCEEDED', 'FAILED']),
  contentType: z.enum(['application/json', 'text/plain']), offset: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(), totalBytes: z.number().int().nonnegative().max(8 * 1024 * 1024),
  text: z.string().max(PAGE_BYTES), units: z.literal('UTF-8 bytes'),
});
type ResultPage = z.infer<typeof rangeSchema>;
type Execute = (type: string, payload: Record<string, unknown>, isCurrent: () => boolean) => Promise<void>;
const ownerKey = (owner: ToolProgramV1['owner']) => JSON.stringify(owner);
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : 'The requested program action failed.';
const invalidResponse = () => new Error('The host returned an unexpected program response.');
const stateLabels: Record<string, string> = { WAITING_TOOL: 'Waiting for tool', RESET_REQUIRED: 'Reset required', UNKNOWN: 'Outcome unknown' };
const label = (value: string) => stateLabels[value] ?? value.charAt(0) + value.slice(1).toLowerCase();
const language = (value: ToolProgramV1['language']) => value === 'JAVASCRIPT' ? 'JavaScript' : 'Python';
const elapsed = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
const size = (bytes: number) => bytes % 1024 === 0 ? `${bytes / 1024} KiB` : `${bytes.toLocaleString()} bytes`;
const activeProgram = (state: ToolProgramV1['state']) => ['PREPARED', 'RUNNING', 'WAITING_TOOL'].includes(state);

/** Active duration is a local display value; terminal duration remains host-owned. */
function ProgramElapsed({ program }: { program: ToolProgramV1 }) {
  const startedAt = program.startedAt, ticking = activeProgram(program.state) && startedAt !== null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const update = () => setClock(Date.now());
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [ticking, startedAt]);
  return elapsed(ticking && startedAt !== null ? Math.max(program.elapsedMs, clock - startedAt) : program.elapsedMs);
}

function parseModel(body: unknown, threadId: string): ProgramModel {
  const parsed = modelSchema.safeParse(body);
  if (!parsed.success) throw invalidResponse();
  for (const entry of parsed.data.programs) {
    if (entry.program.owner.threadId !== threadId || entry.calls.some(call => call.parentProgramId !== entry.program.programId || !sameToolOwner(call.owner, entry.program.owner))) throw invalidResponse();
  }
  if (parsed.data.kernels.some(kernel => kernel.identity.owner.threadId !== threadId)) throw invalidResponse();
  return parsed.data;
}

function useCommand(execute: Execute, disabled: boolean) {
  const live = useRef(true), running = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const send = async (type: string, payload: Record<string, unknown>) => {
    if (running.current || disabled || !live.current) return;
    running.current = true; setBusy(true); setError('');
    try { await execute(type, payload, () => live.current); }
    catch (cause) { if (live.current) setError(messageOf(cause)); }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  return { busy, error, send };
}

/** Mounted only after an explicit Inspect action. Polling metadata never retrieves result bytes. */
function ResultInspector({ threadId, programId, resultRef, close }: { threadId: string; programId: string; resultRef: string; close: () => void }) {
  const [state, setState] = useState<{ page: ResultPage | null; history: number[]; offset: number; loading: boolean; error: string }>({ page: null, history: [], offset: 0, loading: true, error: '' });
  const controller = useRef<AbortController | null>(null), sequence = useRef(0), mounted = useRef(true);
  const load = async (offset: number, history: number[]) => {
    controller.current?.abort();
    const request = ++sequence.current, abort = new AbortController(); controller.current = abort;
    setState({ page: null, history, offset, loading: true, error: '' });
    try {
      const path = `/api/threads/${encodeURIComponent(threadId)}/tool-programs/${encodeURIComponent(programId)}/results/${encodeURIComponent(resultRef)}?offset=${offset}&limit=${PAGE_BYTES}`;
      const body = await authenticated(() => fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal })).then(read<unknown>);
      const parsed = rangeSchema.safeParse(body);
      if (!parsed.success) throw invalidResponse();
      const page = parsed.data;
      if (page.resultRef !== resultRef || page.offset !== offset || page.end < offset || page.end > page.totalBytes || page.bytes !== page.totalBytes ||
        page.end - offset > PAGE_BYTES || new TextEncoder().encode(page.text).byteLength !== page.end - offset ||
        page.nextOffset !== (page.end < page.totalBytes ? page.end : null) || page.nextOffset !== null && page.nextOffset <= offset) throw invalidResponse();
      if (mounted.current && request === sequence.current && !abort.signal.aborted) setState({ page, history, offset, loading: false, error: '' });
    } catch (cause) {
      if (mounted.current && request === sequence.current && !abort.signal.aborted) setState({ page: null, history, offset, loading: false, error: messageOf(cause) });
    }
  };
  useEffect(() => {
    mounted.current = true; void load(0, []);
    return () => { mounted.current = false; sequence.current++; controller.current?.abort(); };
    // Selection identity is the component key. No metadata refresh triggers a private read.
  }, []);
  return <section className="tool-program-inspection" aria-label="Result inspection" aria-busy={state.loading}>
    <header><strong>Retained result</strong><button className="quiet" onClick={close} aria-label="Close result inspection">Close</button></header>
    <code className="tool-program-ref">{resultRef}</code>
    {state.loading && <p role="status">Reading retained result...</p>}
    {state.error && <><p className="tool-program-error" role="alert">{state.error}</p><button className="quiet" onClick={() => void load(state.offset, state.history)}>Retry inspection</button></>}
    {state.page && <>
      <p className="tool-program-source-state" data-state={state.page.status}>{state.page.status === 'FAILED' ? 'Source failed' : 'Source succeeded'} · Revision {state.page.revision}</p>
      <p className="tool-program-muted">Bytes {state.page.offset.toLocaleString()} to {state.page.end.toLocaleString()} of {state.page.totalBytes.toLocaleString()}</p>
      <pre aria-label="Result page">{state.page.text}</pre>
      <div className="tool-program-actions">
        <button className="quiet" disabled={!state.history.length} onClick={() => void load(state.history[state.history.length - 1]!, state.history.slice(0, -1))}>Previous page</button>
        <button className="quiet" disabled={state.page.nextOffset === null} onClick={() => void load(state.page!.nextOffset!, [...state.history, state.page!.offset])}>Next page</button>
      </div>
    </>}
  </section>;
}

function CallRow({ call, inspect, disabled }: { call: NestedCallV1; inspect: (ref: string) => void; disabled: boolean }) {
  return <li className="tool-program-call">
    <div><code>{call.stableCallKey}</code><strong>{call.toolName}</strong><span className="tool-program-state" data-state={call.state}>{label(call.state)}</span></div>
    {call.error && <span className="tool-program-muted">{call.error.code}</span>}
    {call.resultRef && <button className="quiet" disabled={disabled} onClick={() => inspect(call.resultRef!)}>Inspect result of {call.stableCallKey}</button>}
  </li>;
}

function ProgramCard({ entry, threadId, execute, disabled }: { entry: ProgramEntry; threadId: string; execute: Execute; disabled: boolean }) {
  const { program, calls } = entry, actions = useCommand(execute, disabled);
  const [expanded, setExpanded] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const sources = [...new Set([...entry.sourceRefs, ...(program.resultRef ? [program.resultRef] : [])])].filter(ref => ref !== program.error?.originalResultRef);
  return <article className="tool-program-card" aria-label={`${language(program.language)} program ${program.programId}`}>
    <header><strong>{language(program.language)} program</strong><span className="tool-program-state" data-state={program.state}>{label(program.state)}</span></header>
    <dl className="tool-program-metrics">
      <div><dt>Elapsed</dt><dd><ProgramElapsed program={program} /></dd></div>
      <div><dt>Tool calls</dt><dd>{program.nestedCallCount} / {program.limits.maxCalls}</dd></div>
      <div><dt>Output cap</dt><dd>{size(program.limits.maxOutputBytes)}</dd></div>
    </dl>
    <p className="tool-program-tools"><span>Allowed tools</span>{program.allowedTools.length ? program.allowedTools.map(tool => <code key={tool}>{tool}</code>) : <span>None</span>}</p>
    {program.error && <div className="tool-program-failure"><p role="status">{program.error.message}</p>{program.error.originalResultRef && <button className="quiet" disabled={disabled} onClick={() => setSelected(program.error!.originalResultRef)}>Inspect original result</button>}</div>}
    {actions.error && <p role="alert" className="tool-program-error">{actions.error}</p>}
    <div className="tool-program-actions">
      <button className="quiet" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide calls and sources' : 'Show calls and sources'}</button>
      {activeProgram(program.state) && <button className="quiet" disabled={disabled || actions.busy} onClick={() => void actions.send('toolProgram.cancel', { programId: program.programId, owner: program.owner })}>Stop program</button>}
    </div>
    {expanded && <div className="tool-program-details">
      {calls.length ? <ol className="tool-program-call-list" aria-label="Nested calls">{calls.map(call => <CallRow key={call.invocationId} call={call} inspect={setSelected} disabled={disabled} />)}</ol> : <p className="tool-program-muted">No nested calls were admitted.</p>}
      {sources.length > 0 && <ul className="tool-program-sources" aria-label="Retained source handles">{sources.map((ref, index) => <li key={ref}><code className="tool-program-ref">{ref}</code><button className="quiet" disabled={disabled} onClick={() => setSelected(ref)}>Inspect source {index + 1}</button></li>)}</ul>}
    </div>}
    {selected && <ResultInspector key={selected} threadId={threadId} programId={program.programId} resultRef={selected} close={() => setSelected(null)} />}
  </article>;
}

function KernelCard({ kernel, execute, disabled }: { kernel: PythonKernelV1; execute: Execute; disabled: boolean }) {
  const [confirm, setConfirm] = useState(false), actions = useCommand(execute, disabled);
  const payload = { kernelId: kernel.kernelId, owner: kernel.identity.owner, generation: kernel.generation };
  return <article className="tool-program-card tool-program-kernel" aria-label={`Python kernel ${kernel.kernelId}`}>
    <header><strong>Python kernel</strong><span className="tool-program-state" data-state={kernel.state}>{label(kernel.state)}</span></header>
    <p className="tool-program-kernel-state"><span>Generation {kernel.generation}</span><span>{kernel.retainedState ? 'Variables retained' : 'No retained variables'}</span></p>
    {kernel.error && <p role="status" className="tool-program-error">{kernel.error.message}</p>}
    {actions.error && <p role="alert" className="tool-program-error">{actions.error}</p>}
    <div className="tool-program-actions">
      <button className="quiet" disabled={disabled || actions.busy || !['RUNNING', 'READY'].includes(kernel.state)} onClick={() => void actions.send('pythonKernel.stop', payload)}>Stop kernel</button>
      <button className="quiet" disabled={disabled || actions.busy} onClick={() => setConfirm(true)}>Reset kernel</button>
    </div>
    {confirm && <section className="tool-program-reset" aria-label="Confirm kernel reset">
      <p>{RESET_NOTICE}</p>
      <div className="tool-program-actions"><button className="quiet" disabled={actions.busy} onClick={() => setConfirm(false)}>Cancel</button><button className="secondary" disabled={disabled || actions.busy} onClick={() => void actions.send('pythonKernel.reset', payload)}>Confirm reset</button></div>
    </section>}
  </article>;
}

function ProgramPanelOwner({ threadId }: { threadId: string }) {
  const [state, setState] = useState<{ model: ProgramModel | null; error: string; loading: boolean }>({ model: null, error: '', loading: true });
  const refresh = useRef<() => Promise<void>>(async () => {}), live = useRef(true);
  useEffect(() => {
    live.current = true;
    let sequence = 0, timer: ReturnType<typeof setTimeout> | undefined, pending: AbortController | undefined;
    const load = async () => {
      if (!live.current) return;
      if (timer) clearTimeout(timer); pending?.abort();
      const request = ++sequence, abort = new AbortController(); pending = abort;
      setState(current => ({ ...current, loading: true }));
      try {
        const response = await authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/tool-programs`, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal }));
        if (response.status === 404 || response.status === 501) {
          if (live.current && request === sequence) setState({ model: null, error: '', loading: false });
        } else {
          const model = parseModel(await read<unknown>(response), threadId);
          if (live.current && request === sequence && !abort.signal.aborted) setState({ model, error: '', loading: false });
        }
      } catch (cause) {
        if (live.current && request === sequence && !abort.signal.aborted) setState({ model: null, error: messageOf(cause), loading: false });
      } finally {
        if (live.current && request === sequence) timer = setTimeout(() => void load(), POLL_MS);
      }
    };
    refresh.current = load; void load();
    return () => { live.current = false; sequence++; pending?.abort(); if (timer) clearTimeout(timer); refresh.current = async () => {}; };
  }, [threadId]);
  const execute: Execute = async (type, payload, current) => {
    const isCurrent = () => live.current && current();
    if (!isCurrent()) throw new ApiError('OWNER_CHANGED', 'The program owner changed. Reopen its current view.');
    await command(type, payload, threadId, crypto.randomUUID(), isCurrent);
    if (isCurrent()) await refresh.current();
  };
  const model = state.model;
  if (!state.error && (!model || !model.programs.length && !model.kernels.length)) return null;
  return <section className="tool-program-panel" aria-label="Tool programs" aria-busy={state.loading}>
    <header className="tool-program-panel-heading"><h2>Tool programs</h2><button className="quiet" disabled={state.loading} onClick={() => void refresh.current()}>Refresh program status</button></header>
    {state.error && <p className="tool-program-error" role="alert">{state.error}</p>}
    {model?.programs.map(entry => <ProgramCard key={`${entry.program.programId}:${ownerKey(entry.program.owner)}`} entry={entry} threadId={threadId} execute={execute} disabled={state.loading} />)}
    {model?.kernels.map(kernel => <KernelCard key={`${kernel.kernelId}:${kernel.generation}:${ownerKey(kernel.identity.owner)}`} kernel={kernel} execute={execute} disabled={state.loading} />)}
  </section>;
}

/** ownerKey must change with the parent thread's account/project/workspace/run/epoch.
 * Remounting revokes in-flight reads, controls and confirmations before new scope data loads. */
export function ToolProgramPanel({ threadId, ownerKey: scope = threadId }: { threadId: string; ownerKey?: string }) {
  return <ProgramPanelOwner key={`${threadId}:${scope}`} threadId={threadId} />;
}
