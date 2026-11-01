import { lstat, realpath } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentMessage, AgentOptions, ModelListItem, Run, SDKAgent, StoredSdkCredentials } from '@cursor/sdk';
import { HarnessError, type ModelInfo } from '../contracts/index.ts';
import { bounded, textContent, type WireInput } from './internal.ts';
import { officialRuntimeEnvironment } from './environment.ts';
import { secureDirectory, within } from './manifest.ts';
import { assertCursorLoginUrl, CURSOR_LOGIN_BACKEND, CURSOR_LOGIN_WEBSITE, cursorAuthRequired, cursorCredentialStore } from './cursor-credentials.ts';
import { createCursorMcpGate } from './cursor-mcp.ts';
import {MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';

export interface CursorWorkerInit {
  mode: 'run' | 'discover' | 'history' | 'login'; dataDir: string; taskDir?: string;
  sessionId?: string | null; modelId?: string; thinkingLevel?: string | null; systemPrompt?: string;modelOnly?:boolean;
  mcp?: { url: string; headers: Record<string, string>; names: string[] };
}
export type CursorWorkerEvent =
  | { type: 'ready'; sessionId: string; models: ModelInfo[] }
  | { type: 'models'; models: ModelInfo[] }
  | { type: 'history'; sessionId: string; messages: string[] }
  | { type: 'receipt'; sessionId: string; uuid: string; text: string }
  | { type: 'assistant'; uuid: string; text: string }
  | { type: 'usage'; uuid: string; inputTokens: number | null; outputTokens: number | null }
  | { type: 'settled' } | { type: 'closed' } | { type: 'login-complete' }
  | { type: 'login-url'; url: string } | { type: 'error'; code: string; message: string };
export interface CursorWorkerController { submit(input: WireInput): Promise<void>; acknowledgeReceipt(uuid: string, sessionId: string): void; close(): Promise<void> }
type CursorSdk = Pick<typeof import('@cursor/sdk'), 'Cursor' | 'Agent' | 'JsonlLocalAgentStore'>;
const aborted = () => new HarnessError('OFFICIAL_RUN_ABORTED', 'Official Cursor run authority was revoked.');
const invalid = () => new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Cursor returned invalid session or run evidence.');
const sessionValid = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id) && !id.startsWith('bc-');
const safeCodes = new Set(['OFFICIAL_SUBSCRIPTION_REQUIRED', 'OFFICIAL_MODEL_UNAVAILABLE', 'OFFICIAL_SESSION_MISMATCH', 'OFFICIAL_PROTOCOL_INVALID', 'OFFICIAL_RUN_ABORTED', 'OFFICIAL_TOOL_POLICY', 'OFFICIAL_WORKSPACE_UNSUPPORTED']);
/** Native exception text can contain credentials or request headers. */
export function cursorSafeError(error: unknown): { type: 'error'; code: string; message: string } {
  const code = error instanceof HarnessError && safeCodes.has(error.code) ? error.code : 'OFFICIAL_CURSOR_FAILED';
  const message = code === 'OFFICIAL_SUBSCRIPTION_REQUIRED' ? cursorAuthRequired().message : code === 'OFFICIAL_MODEL_UNAVAILABLE' ? 'Select an available model and supported parameters from the authenticated Cursor model catalog.' : code === 'OFFICIAL_RUN_ABORTED' ? aborted().message : code === 'OFFICIAL_WORKSPACE_UNSUPPORTED' ? `Cursor storage path cannot contain "${delimiter}". Choose another storage folder.` : 'The official Cursor SDK could not complete this operation. Delivery remains unresolved until canonical native history confirms it.';
  return { type: 'error', code, message };
}
function supportedSelection(row: ModelListItem): boolean {
  return !row.parameters?.length && (!row.variants?.length || row.variants.some(variant => variant.isDefault && variant.params.length === 0 && !variant.isMaxMode));
}
function catalogModels(rows: ModelListItem[]): ModelInfo[] {
  if (!Array.isArray(rows)) throw invalid();
  return rows.filter(row => typeof row.id === 'string' && /^[^\s\u0000]{1,200}$/.test(row.id) && typeof row.displayName === 'string' && supportedSelection(row)).map(row => ({ id: `cursor-sdk/${row.id}`, provider: 'cursor-sdk', name: row.displayName }));
}
/** Canonical checkpoint history is distinct from a streamed input echo. */
function canonicalUserText(row: AgentMessage, sessionId: string): string | undefined {
  if (row.type !== 'user' || row.agent_id !== sessionId || !row.message || typeof row.message !== 'object') return;
  const message = row.message as any;
  const turn = message.type === 'agentConversationTurn' ? message.turn : message.turn?.case === 'agentConversationTurn' ? message.turn.value : message.agentConversationTurn;
  return turn && typeof turn.userMessage?.text === 'string' ? turn.userMessage.text : undefined;
}

/** The fixed transport installs a private environment before calling this loader. */
export async function runCursorWorker(init: CursorWorkerInit, emit: (event: CursorWorkerEvent) => void, loadSdk: () => Promise<CursorSdk> = () => import('@cursor/sdk')): Promise<CursorWorkerController | undefined> {
  if (!['run', 'discover', 'history', 'login'].includes(init.mode) || typeof init.dataDir !== 'string' || !init.dataDir) throw invalid();
  const store = cursorCredentialStore(init.dataDir, init.mode === 'login');
  let credentials: StoredSdkCredentials | undefined;
  if (init.mode !== 'login' && init.mode !== 'history') { credentials = await store.load(); if (!credentials) throw cursorAuthRequired(); }
  const sdk = await loadSdk();
  if (init.mode === 'login') {
    await sdk.Cursor.auth.login({ backendUrl: CURSOR_LOGIN_BACKEND, websiteUrl: CURSOR_LOGIN_WEBSITE, store, openBrowser: true, apiKeyName: 'Generative Harness official browser login', onLoginUrl: url => emit({ type: 'login-url', url: assertCursorLoginUrl(url) }) });
    if (!await store.load()) throw cursorAuthRequired();
    emit({ type: 'login-complete' }); return;
  }
  let nativeModels: ModelListItem[] = []; let models: ModelInfo[] = [];
  const accountCatalog = async () => {
    const currentCredentials = await store.load();
    if (!currentCredentials || currentCredentials.apiKey !== credentials?.apiKey || currentCredentials.backendUrl !== CURSOR_LOGIN_BACKEND) throw cursorAuthRequired();
    const status = await sdk.Cursor.auth.status({ store });
    if (status.status !== 'logged-in' || status.backendUrl !== CURSOR_LOGIN_BACKEND) throw cursorAuthRequired();
    const identity = await sdk.Cursor.me({ apiKey: currentCredentials.apiKey });
    if (!Number.isSafeInteger(identity.userId) || identity.userId! <= 0) throw cursorAuthRequired();
    const rows = await sdk.Cursor.models.list({ apiKey: currentCredentials.apiKey });
    return { rows, models: catalogModels(rows) };
  };
  const assertSelection = (rows: ModelListItem[], advertised: ModelInfo[]) => {
    if (!init.modelId || !advertised.some(model => model.id === `cursor-sdk/${init.modelId}`) || init.thinkingLevel != null) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'Cursor model or parameters are unavailable.');
    const nativeModel = rows.find(model => model.id === init.modelId)!;
    if (!supportedSelection(nativeModel)) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'This Cursor model requires unsupported native parameters.');
  };
  if (init.mode !== 'history') {
    const catalog = await accountCatalog(); nativeModels = catalog.rows; models = catalog.models;
    if (init.mode === 'discover') { emit({ type: 'models', models }); return; }
    assertSelection(nativeModels, models);
  }
  if (typeof init.taskDir !== 'string' || !within(resolve(init.dataDir, 'official', 'cursor-sdk', 'tasks'), resolve(init.taskDir))) throw invalid();
  const taskDir = init.mode === 'history' ? await realpath(init.taskDir) : await secureDirectory(init.dataDir, init.taskDir);
  if (!within(await realpath(init.dataDir), taskDir)) throw invalid();
  const nativePath = join(taskDir, 'native-history');
  const nativeRoot = init.mode === 'history' ? await realpath(nativePath) : await secureDirectory(init.dataDir, nativePath);
  if (!within(taskDir, nativeRoot)) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Cursor native history escaped its owning task.');
  const assertNativeFiles = async () => {
    for (const name of ['agents.ndjson', 'runs.ndjson', 'run_events.ndjson', 'checkpoints.ndjson']) {
      const path = join(nativeRoot, name);
      try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || !within(nativeRoot, await realpath(path))) throw invalid(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  };
  await assertNativeFiles();
  const nativeStore = new sdk.JsonlLocalAgentStore(nativeRoot);
  const readHistory = async (sessionId: string): Promise<string[]> => {
    await assertNativeFiles();
    const metadata = await nativeStore.agents.get({ agentId: sessionId });
    if (!metadata || metadata.agentId !== sessionId || typeof metadata.cwd !== 'string' || resolve(metadata.cwd) !== taskDir) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Cursor native history belongs to a different task.');
    const rows = await sdk.Agent.messages.list(sessionId, { runtime: 'local', cwd: taskDir, store: nativeStore, limit: 10_001 });
    if (rows.length > 10_000 || Buffer.byteLength(JSON.stringify(rows)) > 4 * 1024 * 1024) throw invalid();
    return rows.flatMap(row => { const text = canonicalUserText(row, sessionId); return text === undefined ? [] : [text]; });
  };
  if (init.mode === 'history') {
    if (!sessionValid(init.sessionId)) throw invalid();
    emit({ type: 'history', sessionId: init.sessionId, messages: await readHistory(init.sessionId) }); return;
  }
  if (!init.mcp || typeof init.systemPrompt !== 'string' || !init.systemPrompt.trim()) throw invalid();
  const url = new URL(init.mcp.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash || !url.port || Object.keys(init.mcp.headers).length !== 1 || !/^Bearer [^\s]+$/.test(init.mcp.headers.Authorization ?? init.mcp.headers.authorization ?? '') || !Array.isArray(init.mcp.names) || init.mcp.names.some(name => !/^[a-z][a-z0-9_]*$/.test(name))) throw invalid();
  if((init.modelOnly!==undefined&&typeof init.modelOnly!=='boolean')||(init.modelOnly&&init.mcp.names.length))throw invalid();
  if (init.sessionId && !sessionValid(init.sessionId)) throw invalid();
  if (init.sessionId) await readHistory(init.sessionId);
  let closed = false; let settled = false; let active: Run | undefined;
  let activeWire: WireInput | undefined; let entry: { uuid: string; native: boolean; acknowledged: boolean; promise: Promise<void>; resolve(): void; reject(error: Error): void } | undefined;
  const gate = await createCursorMcpGate(init.mcp, init.mcp.names, async () => { const current = entry; if (closed || settled || !activeWire || !current || current.uuid !== activeWire.uuid) throw aborted(); await current.promise; if (closed || settled || current !== entry || !current.native || !current.acknowledged) throw aborted(); });
  const options: AgentOptions = { apiKey: credentials!.apiKey, model: { id: init.modelId! }, tools: init.modelOnly?[]:['mcp'], agents: {}, systemPrompt: init.systemPrompt, local: { cwd: taskDir, settingSources: [], store: nativeStore, enableAgentRetries: false }, mcpServers: init.modelOnly?{}:{ host: { type: 'http', url: gate.url, headers: gate.headers } } };
  let agent: SDKAgent;
  try { agent = init.sessionId ? await sdk.Agent.resume(init.sessionId, options) : await sdk.Agent.create(options); }
  catch (error) { await gate.close(); throw error; }
  if (!sessionValid(agent.agentId) || (init.sessionId && agent.agentId !== init.sessionId)) { await gate.close(); agent.close(); throw invalid(); }
  let chain: Promise<void> = Promise.resolve(); let queued = 0;
  const assert = () => { if (closed || settled) throw aborted(); };
  const controller: CursorWorkerController = {
    async submit(wire) {
      assert();
      if (!wire || !sessionValid(wire.uuid) || typeof wire.text !== 'string' || Buffer.byteLength(wire.text) > (init.modelOnly?MODEL_ONLY_MAX_WIRE_BYTES:2*1024*1024) || !wire.text.startsWith('[harness-input:v1] ') || !Array.isArray(wire.inputIds)) throw invalid();
      queued++;
      const operation = chain.then(async () => {
        assert();
        const catalog = await accountCatalog(); assertSelection(catalog.rows, catalog.models); assert();
        activeWire = wire;
        let resolveEntry!: () => void; let rejectEntry!: (error: Error) => void;
        const entryPromise = new Promise<void>((yes, no) => { resolveEntry = yes; rejectEntry = no; }); void entryPromise.catch(() => {});
        const currentEntry = entry = { uuid: wire.uuid, native: false as boolean, acknowledged: false as boolean, promise: entryPromise, resolve: resolveEntry, reject: rejectEntry };
        const run = active = await agent.send(wire.text, { idempotencyKey: wire.uuid, onDelta: async ({ update }) => {
          assert();
          if (update.type !== 'user-message-appended') return;
          if (entry !== currentEntry || update.userMessage.session_id !== agent.agentId || update.userMessage.text !== wire.text) throw invalid();
          if (!currentEntry.native) { currentEntry.native = true; emit({ type: 'receipt', sessionId: agent.agentId, uuid: wire.uuid, text: wire.text }); }
          await bounded(currentEntry.promise, 10_000, 'Cursor native entry was not acknowledged.'); assert();
        } });
        if (closed) { await run.cancel().catch(() => {}); throw aborted(); }
        if (run.agentId !== agent.agentId || !sessionValid(run.id)) throw invalid();
        let evidence = false; let output = ''; let usage: { inputTokens: number | null; outputTokens: number | null } | undefined;
        const mcpCalls = new Map<string, { providerIdentifier?: unknown; toolName?: unknown }>();
        for await (const frame of run.stream()) {
          if (closed) throw aborted();
          if (frame.agent_id !== agent.agentId || frame.run_id !== run.id) throw invalid();
          if (frame.type === 'system' && frame.tools?.some(tool => init.modelOnly||tool !== 'mcp')) throw new HarnessError('OFFICIAL_TOOL_POLICY', 'Cursor exposed an unexpected native tool.');
          // SDK `summary` updates use the public `task` display category. Native
          // Task execution is excluded by the MCP-only tool capability above.
          if (frame.type === 'tool_call') {
            if(init.modelOnly)throw new HarnessError('MODEL_ONLY_TOOL_DENIED','The native model attempted to execute a tool.');
            const allowed = new Set(init.mcp!.names.flatMap(name => [name, `host__${name}`, `mcp__host__${name}`]));
            const fields = frame.args as { providerIdentifier?: unknown; toolName?: unknown } | undefined;
            const args = { ...mcpCalls.get(frame.call_id), ...fields };
            if (frame.name === 'mcp') mcpCalls.set(frame.call_id, args);
            const knownIdentity = args.providerIdentifier === 'host' && typeof args.toolName === 'string' && init.mcp!.names.includes(args.toolName);
            const partialIdentity = frame.status === 'running' && (args.providerIdentifier === undefined || args.providerIdentifier === 'host') && (args.toolName === undefined || (typeof args.toolName === 'string' && init.mcp!.names.includes(args.toolName)));
            const nativeMcp = frame.name === 'mcp' && (knownIdentity || partialIdentity);
            if (!nativeMcp && !allowed.has(frame.name)) throw new HarnessError('OFFICIAL_TOOL_POLICY', 'Cursor exposed an unexpected tool.');
            evidence = true;
          }
          if (frame.type === 'assistant') { output += textContent(frame.message.content); if (output) evidence = true; }
          if (frame.type === 'usage') usage = { inputTokens: frame.usage.inputTokens, outputTokens: frame.usage.outputTokens };
        }
        const result = await run.wait();
        if (closed) throw aborted();
        if (result.id !== run.id || !['finished', 'error', 'cancelled'].includes(result.status)) throw invalid();
        if (result.status === 'finished') evidence = true;
        const messages = await readHistory(agent.agentId);
        if (closed) throw aborted();
        if (evidence && !currentEntry.native && messages.includes(wire.text)) emit({ type: 'receipt', sessionId: agent.agentId, uuid: wire.uuid, text: wire.text });
        if (output) emit({ type: 'assistant', uuid: wire.uuid, text: output });
        usage ??= { inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null };
        emit({ type: 'usage', uuid: wire.uuid, ...usage });
        if (result.status !== 'finished') throw new HarnessError('OFFICIAL_CURSOR_FAILED', 'Cursor turn did not finish.');
      }).catch(error => { if (!closed && !settled) { settled = true; emit(cursorSafeError(error)); } throw error; }).finally(() => { entry?.reject(aborted()); entry = undefined; activeWire = undefined; queued--; active = undefined; if (!closed && queued === 0) { settled = true; emit({ type: 'settled' }); } });
      chain = operation.catch(() => {});
      return operation;
    },
    acknowledgeReceipt(uuid, sessionId) { if (!closed && !settled && sessionId === agent.agentId && entry?.uuid === uuid && entry.native) { entry.acknowledged = true; entry.resolve(); } },
    async close() {
      if (closed) return; closed = true; settled = true;
      entry?.reject(aborted()); await gate.close();
      await bounded(active?.cancel().catch(() => {}) ?? Promise.resolve(), 500, 'Cursor cancellation grace elapsed.').catch(() => {});
      await bounded(agent[Symbol.asyncDispose]?.() ?? Promise.resolve(agent.close()), 500, 'Cursor SDK close grace elapsed.').catch(() => {});
    },
  };
  emit({ type: 'ready', sessionId: agent.agentId, models });
  return controller;
}

/** Importing this module does not start a worker or import the native SDK. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.send) {
  let initialized = false; let closing = false; let controller: CursorWorkerController | undefined;
  const emit = (event: CursorWorkerEvent) => { if (process.connected && (!closing || event.type === 'closed')) process.send?.(event); };
  const close = async () => { if (closing) return; closing = true; await controller?.close(); emit({ type: 'closed' }); };
  process.on('disconnect', () => { void close(); });
  process.on('message', (message: any) => {
    if (message?.type === 'close') { void close(); return; }
    if (!initialized && message?.type === 'initialize') {
      initialized = true;
      const init = message.init as CursorWorkerInit;
      const environment = officialRuntimeEnvironment(init?.dataDir, 'cursor-sdk', process.cwd());
      for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, environment);
      void runCursorWorker(init, emit).then(async value => { controller = value; if (closing) await controller?.close(); else if (!controller) await close(); }).catch(async error => { emit(cursorSafeError(error)); await close(); });
    } else if (message?.type === 'submit' && controller && !closing) {
      void controller.submit(message.input).catch(async error => { emit(cursorSafeError(error)); await close(); });
    } else if (message?.type === 'receipt-ack' && controller && !closing) {
      controller.acknowledgeReceipt(message.uuid, message.sessionId);
    } else { emit(cursorSafeError(invalid())); void close(); }
  });
}
