import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HarnessError, type ModelInfo } from '../contracts/index.ts';
import { hostSystemPrompt } from '../runtime-pi/tool-definitions.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { officialRuntimeCommand, officialRuntimeEnvironment, officialRuntimeHome } from './environment.ts';
import { bounded, finite, type DriverContext, type HistoryReceipt, type OfficialDriver, type WireInput } from './internal.ts';
import { saveManifest, secureDirectory, type ManifestState } from './manifest.ts';
import { leadingReceipts } from './receipts.ts';
import { assertCursorLoginUrl, cursorAuthPath } from './cursor-credentials.ts';
import { cursorSafeError, type CursorWorkerEvent, type CursorWorkerInit } from './cursor-worker.ts';
import {MODEL_ONLY_SYSTEM_PROMPT,MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';

const aborted = () => new HarnessError('OFFICIAL_RUN_ABORTED', 'Official Cursor run authority was revoked.');
const protocol = () => new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official Cursor returned invalid session or run evidence.');
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject }; }
function safeError(value: unknown): HarnessError {
  const frame = value as { code?: unknown } | undefined;
  if (frame?.code === 'OFFICIAL_PROCESS_IO_FAILED') return new HarnessError('OFFICIAL_PROCESS_IO_FAILED', 'The native Cursor connection closed unexpectedly. Reconnect the provider and refresh models.');
  const candidate = typeof frame?.code === 'string' ? new HarnessError(frame.code, '') : value;
  const safe = cursorSafeError(candidate); return new HarnessError(safe.code, safe.message);
}
function models(value: unknown): ModelInfo[] {
  if (!Array.isArray(value) || value.some(row => !row || row.provider !== 'cursor-sdk' || typeof row.id !== 'string' || !/^cursor-sdk\/[^\s\u0000]{1,200}$/.test(row.id) || typeof row.name !== 'string' || row.thinkingLevels !== undefined)) throw protocol();
  return value.map(row => ({ id: row.id, provider: 'cursor-sdk', name: row.name }));
}

function startWorker(dataDir: string, cwd: string, spawnChild: typeof spawn, own?: (child: ChildProcess) => void) {
  const command = officialRuntimeCommand('cursor-sdk');
  let child: ChildProcess;
  try { child = spawnChild(command.file, command.args, { cwd, env: officialRuntimeEnvironment(dataDir, 'cursor-sdk', cwd), stdio: ['ignore', 'pipe', 'pipe', 'ipc'], detached: process.platform !== 'win32', windowsHide: true }); }
  catch (error) { throw safeError(error); }
  const exited = deferred<void>(); const closeAck = deferred<void>(); let closed = false;
  const failed = () => exited.reject(safeError(new HarnessError('OFFICIAL_PROCESS_IO_FAILED', '')));
  child.on('error', failed); child.stdout?.on('error', failed); child.stderr?.on('error', failed);
  own?.(child); // Must precede readiness, SDK initialization and every asynchronous wait.
  child.stdout?.resume(); child.stderr?.resume();
  child.once('exit', () => exited.resolve());
  child.on('message', (frame: any) => { if (frame?.type === 'closed') closeAck.resolve(); });
  const send = (message: unknown) => new Promise<void>((resolve, reject) => {
    if (closed || child.exitCode !== null || child.signalCode !== null) { reject(aborted()); return; }
    try { child.send(message as any, error => error ? reject(safeError(error)) : resolve()); } catch (error) { reject(safeError(error)); }
  });
  return {
    child, exited: exited.promise, send,
    async close() {
      if (closed) return; closed = true;
      try { if (child.connected && child.exitCode === null && child.signalCode === null) child.send({ type: 'close' }, () => {}); } catch { /* Force termination below. */ }
      await bounded(Promise.race([exited.promise.catch(() => {}), closeAck.promise]), 1000, 'Cursor close grace elapsed.').catch(() => {});
      await terminateProcessTree(child);
    },
  };
}

export async function openCursor(context: DriverContext, spawnChild: typeof spawn, modelId?: string, maintenance = false): Promise<OfficialDriver> {
  if (maintenance) throw new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'The pinned Cursor SDK does not advertise a verifiable native compaction operation.');
  if (!context.current()) throw aborted();
  const worker = startWorker(context.dataDir, context.taskDir, spawnChild, child => context.own(child));
  const startup = deferred<void>(); let closed = false; let settled = false; let initialized = false;
  let failure: Error | undefined; let processing = Promise.resolve(); const submitted = new Map<string, WireInput>();
  const assert = () => { if (closed || settled || !context.current()) throw aborted(); if (failure) throw failure; };
  const driver: OfficialDriver = {
    models: [],
    async submit(wire) { assert(); if (!initialized || submitted.has(wire.uuid)) throw protocol(); submitted.set(wire.uuid, structuredClone(wire)); await worker.send({ type: 'submit', input: wire }); assert(); },
    async compact() { throw new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'The pinned Cursor SDK does not advertise a verifiable native compaction operation.'); },
    async close() { if (closed) return; closed = true; startup.reject(aborted()); await worker.close(); },
  };
  context.ready(driver); // Startup cancellation owns the driver before the first await.
  const fail = (error: unknown) => {
    failure = safeError(error); startup.reject(failure);
    if (context.current() && !closed && !settled) {
      settled = true;
      try { context.event('error', { message: failure.message }); } catch { /* Notification cannot prevent teardown. */ }
      try { context.event('settled', { aborted: false }); } catch { /* Notification cannot prevent teardown. */ }
    }
    void driver.close().catch(() => {});
  };
  worker.child.on('message', (value: unknown) => {
    processing = processing.then(async () => {
      if (!context.current() || closed || settled) return;
      if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value)) > (context.modelOnly?MODEL_ONLY_MAX_WIRE_BYTES:4*1024*1024)) throw protocol();
      const frame = value as CursorWorkerEvent;
      if (frame.type === 'error') throw safeError(frame);
      if (frame.type === 'ready') {
        if (initialized || typeof frame.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(frame.sessionId) || frame.sessionId.startsWith('bc-') || (context.manifest.value.sessionId && context.manifest.value.sessionId !== frame.sessionId)) throw protocol();
        const advertised = models(frame.models);
        if (modelId && !advertised.some(model => model.id === `cursor-sdk/${modelId}`)) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'Cursor model is unavailable.');
        context.manifest.value.sessionId = frame.sessionId; await saveManifest(context.manifest); assert();
        driver.models = advertised; initialized = true; startup.resolve(); return;
      }
      if (!initialized) throw protocol();
      if (frame.type === 'receipt') {
        const wire = submitted.get(frame.uuid);
        if (!wire || frame.sessionId !== context.manifest.value.sessionId || frame.text !== wire.text) return;
        if (leadingReceipts(context.manifest, frame.text).some(receipt => receipt.uuid === wire.uuid && JSON.stringify(receipt.inputIds) === JSON.stringify(wire.inputIds))) { await context.observed(wire.uuid); assert(); await worker.send({ type: 'receipt-ack', uuid: wire.uuid, sessionId: frame.sessionId }); assert(); }
      } else if (frame.type === 'assistant') {
        if (!submitted.has(frame.uuid) || typeof frame.text !== 'string') throw protocol();
        context.event('assistant.message', { messageId: randomUUID(), content: frame.text, inputIds: context.inputIds([frame.uuid]) });
      } else if (frame.type === 'usage') {
        if (!submitted.has(frame.uuid)) throw protocol();
        context.event('usage', { usage: { contextTokens: null, contextWindow: null, inputTokens: finite(frame.inputTokens), outputTokens: finite(frame.outputTokens), cost: null, sessionPercent: null, weeklyPercent: null, activity: 'idle' } });
      } else if (frame.type === 'settled') {
        settled = true; context.event('settled', { aborted: false });
      } else if (frame.type !== 'closed') throw protocol();
    }).catch(fail);
  });
  void worker.exited.then(() => { if (!closed && !settled) fail(protocol()); }, fail);
  try {
    await worker.send({ type: 'initialize', init: { mode: 'run', dataDir: context.dataDir, taskDir: context.taskDir, sessionId: context.manifest.value.sessionId, modelId, thinkingLevel: context.thinkingLevel, systemPrompt: context.modelOnly?MODEL_ONLY_SYSTEM_PROMPT:hostSystemPrompt(context.memory),...(context.modelOnly?{modelOnly:true}:{}), mcp: { url: context.mcp.url, headers: context.mcp.headers, names: [...context.mcp.names] } } satisfies CursorWorkerInit });
    await bounded(startup.promise, 30_000, 'Official Cursor initialization timed out.'); assert(); return driver;
  } catch (error) { await driver.close(); throw safeError(error); }
}

async function operation(dataDir: string, init: CursorWorkerInit, spawnChild: typeof spawn, resultType: 'models' | 'history' | 'login-complete'): Promise<CursorWorkerEvent> {
  const cwd = init.taskDir ?? await secureDirectory(dataDir, officialRuntimeHome(dataDir, 'cursor-sdk'));
  const worker = startWorker(dataDir, cwd, spawnChild); const result = deferred<CursorWorkerEvent>();
  worker.child.on('message', (value: unknown) => {
    if (!value || typeof value !== 'object' || Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) { result.reject(protocol()); return; }
    const frame = value as CursorWorkerEvent;
    if (frame.type === 'error') result.reject(safeError(frame));
    else if (frame.type === resultType) result.resolve(frame);
    else if (frame.type === 'login-url' && init.mode === 'login') { try { console.log(`Open this official Cursor sign-in page: ${assertCursorLoginUrl(frame.url)}`); } catch (error) { result.reject(safeError(error)); } }
  });
  void worker.exited.then(() => result.reject(protocol()), error => result.reject(safeError(error)));
  try { await worker.send({ type: 'initialize', init }); return await bounded(result.promise, init.mode === 'login' ? 180_000 : 30_000, 'Official Cursor operation timed out.'); }
  finally { await worker.close(); }
}

export async function discoverCursor(dataDir: string, spawnChild: typeof spawn): Promise<ModelInfo[]> {
  try { const info = await lstat(cursorAuthPath(dataDir)); if (!info.isFile() || info.isSymbolicLink() || info.size > 32_768) return []; } catch { return []; }
  const frame = await operation(dataDir, { mode: 'discover', dataDir }, spawnChild, 'models');
  if (frame.type !== 'models') throw protocol(); return models(frame.models);
}

export async function cursorHistory(dataDir: string, manifest: ManifestState, spawnChild: typeof spawn): Promise<HistoryReceipt[]> {
  if (!manifest.value.sessionId) return [];
  const frame = await operation(dataDir, { mode: 'history', dataDir, taskDir: dirname(manifest.path), sessionId: manifest.value.sessionId }, spawnChild, 'history');
  if (frame.type !== 'history' || frame.sessionId !== manifest.value.sessionId || !Array.isArray(frame.messages) || frame.messages.some(text => typeof text !== 'string')) throw protocol();
  const receipts = frame.messages.flatMap(text => leadingReceipts(manifest, text));
  return [...new Map(receipts.map(receipt => [receipt.uuid, receipt])).values()];
}

/** Explicit console mode is the only path that starts the official browser login. */
export async function cursorLogin(dataDir: string): Promise<void> {
  await operation(dataDir, { mode: 'login', dataDir }, spawn, 'login-complete');
}
