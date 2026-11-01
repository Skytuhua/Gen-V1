import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { HarnessError, type ModelInfo, type RuntimeAdapter, type RuntimeCallbacks, type RunContext, type StartRun } from '../contracts/index.ts';
import { OFFICIAL_RUNTIME_PROVIDER_IDS, isConnectionProviderId, isOfficialRuntimeProviderId } from '../contracts/connections.ts';
import { encodeInput } from '../runtime-pi/input-envelope.ts';
import { sameContext } from '../runtime-pi/ipc.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { createHostTools, loadDomainTools } from '../runtime-pi/tool-definitions.ts';
import { openClaude, type ClaudeSdk } from './claude.ts';
import { officialRuntimeHome, type OfficialProvider } from './environment.ts';
import { openManifest, readManifest, saveManifest, secureDirectory, type ManifestState } from './manifest.ts';
import { createHostMcp, type HostMcp } from './mcp.ts';
import { bounded, type DriverContext, type HistoryReceipt, type OfficialDriver } from './internal.ts';

export { officialRuntimeCommand, officialRuntimeHome, officialRuntimeEnvironment } from './environment.ts';
export type { OfficialProvider } from './environment.ts';
export interface OfficialRuntimeDependencies {
  claudeSdk?: ClaudeSdk;
  claudeHistory?: (dataDir: string, manifest: ManifestState, spawnProcess?: typeof spawn) => Promise<HistoryReceipt[]>;
  spawn?: typeof spawn;
}
interface Authority {
  ctx: RunContext; provider: OfficialProvider; revoked: boolean; settled: boolean;
  modelId?: string;
  mcp?: HostMcp; driver?: OfficialDriver; manifest?: ManifestState; children: Set<ChildProcess>; closing?: Promise<void>;
}
function providerModel(modelId: string): { provider: OfficialProvider; modelId: string } {
  const match = /^([^/]+)\/([^\s\u0000]+)$/.exec(modelId);
  if (!match || !isOfficialRuntimeProviderId(match[1])) throw new HarnessError('OFFICIAL_MODEL_UNAVAILABLE', 'Select a model advertised by an available official runtime connection.');
  if (!isConnectionProviderId(match[1])) throw new HarnessError('OFFICIAL_PROVIDER_UNAVAILABLE', 'This official runtime is not yet available.');
  return { provider: match[1], modelId: match[2] };
}

export function createOfficialRuntime({ dataDir }: { dataDir: string }, dependencies: OfficialRuntimeDependencies = {}): RuntimeAdapter {
  const storage = resolve(dataDir);
  const authorities = new Set<Authority>();
  const runs = new Map<string, Authority>();
  const locks = new Map<string, Promise<unknown>>();
  let callbacks: RuntimeCallbacks | undefined;
  let disposed = false;
  let modelCache:ModelInfo[]|undefined,modelDiscovery:Promise<ModelInfo[]>|undefined;
  const current = (authority: Authority) => !disposed && !authority.revoked && runs.get(authority.ctx.threadId) === authority;
  const assert = (authority: Authority) => { if (!current(authority)) throw new HarnessError('OFFICIAL_RUN_ABORTED', 'Official run authority was revoked.'); };
  function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const next = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
    locks.set(key, next);
    void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
    return next;
  }
  function stop(authority: Authority): Promise<void> {
    authority.revoked = true;
    authority.closing ??= (async () => {
      await authority.mcp?.close();
      await authority.driver?.close();
      if (authority.children.size) {
        await new Promise(resolve => setTimeout(resolve, 250));
        await Promise.all([...authority.children].map(child => terminateProcessTree(child)));
      }
      await authority.manifest?.write;
      authorities.delete(authority);
    })().catch(()=>{throw new HarnessError('RUNTIME_TEARDOWN_FAILED','The official runtime did not close completely. Account sign-in remains blocked.');});
    return authority.closing;
  }
  function own(authority: Authority, child: ChildProcess): void {
    authority.children.add(child);
    child.once('exit', () => authority.children.delete(child));
    if (!current(authority)) void terminateProcessTree(child).catch(() => {});
  }
  function ownedSpawn(authority: Authority): typeof spawn {
    return ((...args: Parameters<typeof spawn>) => {
      assert(authority);
      const child = (dependencies.spawn ?? spawn)(...args);
      own(authority, child);
      return child;
    }) as typeof spawn;
  }
  async function auxiliary<T>(provider: OfficialProvider, action: (authority: Authority) => Promise<T>): Promise<T> {
    if (disposed) throw new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.');
    const authority: Authority = { ctx: { threadId: `official-probe-${randomUUID()}`, runId: randomUUID(), epoch: 0 }, provider, revoked: false, settled: false, children: new Set() };
    authorities.add(authority); runs.set(authority.ctx.threadId, authority);
    try { return await action(authority); }
    finally { await stop(authority); runs.delete(authority.ctx.threadId); }
  }
  async function prepareHome(provider: OfficialProvider): Promise<void> {
    const home = await secureDirectory(storage, officialRuntimeHome(storage, provider));
    await Promise.all(['tmp', '.config', '.cache', join('.local', 'share'), join('.local', 'state'), join('AppData', 'Roaming'), join('AppData', 'Local')].map(part => secureDirectory(storage, join(home, part))));
  }
  async function context(authority: Authority, sessionPath: string | null, memory?: string,thinkingLevel?:string|null): Promise<DriverContext> {
    assert(authority);
    await prepareHome(authority.provider); assert(authority);
    const manifest = authority.manifest = await openManifest(storage, authority.provider, authority.ctx.threadId, sessionPath); assert(authority);
    const tools = createHostTools(await loadDomainTools(), async () => { throw new Error('Official tools execute through the host MCP bridge.'); }); assert(authority);
    const mcp = authority.mcp = await createHostMcp({ ctx: authority.ctx, current: () => current(authority), onTool: (call, ctx) => callbacks!.onTool(call, ctx), tools: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters as Record<string, unknown> })) });
    if (!current(authority)) { await mcp.close(); assert(authority); }
    return {
      dataDir: storage, taskDir: dirname(manifest.path), manifest, mcp, memory,thinkingLevel,
      current: () => current(authority),
      event(type, value = {}) {
        if (!current(authority)) return;
        if (type === 'session.identity') { void saveManifest(manifest).catch(() => stop(authority)); return; }
        if (type === 'settled') {
          authority.settled = true;
          void stop(authority).then(()=>{callbacks?.onEvent({ ...value, ...authority.ctx, type });},()=>{callbacks?.onEvent({...authority.ctx,type:'error',message:'The official runtime did not close completely. Account sign-in remains blocked.'});});
          return;
        }
        callbacks?.onEvent({ ...value, ...authority.ctx, type });
      },
      async observed(uuid) {
        assert(authority);
        const receipt = manifest.value.inputs[uuid];
        if (!receipt || receipt.runId !== authority.ctx.runId || receipt.epoch !== authority.ctx.epoch) return [];
        if (!receipt.observed) {
          receipt.observed = true; await saveManifest(manifest); assert(authority);
          callbacks?.onEvent({ ...authority.ctx, type: 'input.processing', inputIds: [...receipt.inputIds] });
        }
        return [...receipt.inputIds];
      },
      inputIds(uuids) {
        return [...new Set(uuids.flatMap(uuid => { const receipt = manifest.value.inputs[uuid]; return receipt?.observed && receipt.runId === authority.ctx.runId && receipt.epoch === authority.ctx.epoch ? receipt.inputIds : []; }))];
      },
      own(child) { own(authority, child); },
      ready(driver) { authority.driver = driver; if (!current(authority)) void driver.close().catch(() => {}); },
    };
  }
  async function open(authority: Authority, ctx: DriverContext, modelId?: string,maintenance=false): Promise<OfficialDriver> {
    if (authority.provider === 'claude-code') return openClaude(ctx, dependencies.claudeSdk ?? await import('@anthropic-ai/claude-agent-sdk'), modelId);
    if (authority.provider === 'gemini-cli') {
      const { openGemini } = await import('./gemini.ts');
      // Maintenance suppresses every replayed conversation update. Only an advertised
      // command and its terminal response can establish compaction completion.
      return openGemini(ctx, dependencies.spawn ?? spawn, modelId,maintenance);
    }
    if (authority.provider === 'cursor-sdk') return (await import('./cursor.ts')).openCursor(ctx, dependencies.spawn ?? spawn, modelId, maintenance);
    throw new HarnessError('OFFICIAL_PROVIDER_UNAVAILABLE', 'The official runtime provider is unknown.');
  }
  async function deliver(authority: Authority, input: StartRun): Promise<void> {
    assert(authority);
    if (input.modelId !== `${authority.provider}/${providerModel(input.modelId).modelId}`) throw new HarnessError('OFFICIAL_SESSION_MISMATCH', 'A follow-up cannot switch official providers.');
    if (authority.modelId !== input.modelId) throw new HarnessError('OFFICIAL_MODEL_MISMATCH', 'Stop the active run before changing models.');
    const text = encodeInput(input);
    const uuid = randomUUID();
    const ids = [...new Set(input.inputIds ?? [input.inputId])];
    authority.manifest!.value.inputs[uuid] = { inputIds: ids, runId: authority.ctx.runId, epoch: authority.ctx.epoch, observed: false };
    await saveManifest(authority.manifest!); assert(authority);
    await authority.driver!.submit({ uuid, text, inputIds: ids }); assert(authority);
  }
  function queue(input: StartRun, compact: boolean): Promise<void> {
    if (disposed) return Promise.reject(new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.'));
    if (!callbacks) return Promise.reject(new HarnessError('OFFICIAL_NOT_CONFIGURED', 'Configure runtime callbacks before starting work.'));
    if (!input.threadId || !input.runId || !Number.isSafeInteger(input.epoch) || input.epoch < 0) return Promise.reject(new HarnessError('OFFICIAL_CONTEXT_INVALID', 'Invalid official runtime context.'));
    let model: ReturnType<typeof providerModel>;
    try { model = providerModel(input.modelId); }
    catch (error) { return Promise.reject(error); }
    if (compact && model.provider === 'cursor-sdk') return Promise.reject(new HarnessError('OFFICIAL_COMPACTION_UNSUPPORTED', 'Cursor SDK compaction is not supported.'));
    const existing = runs.get(input.threadId);
    if (existing && existing.ctx.epoch >= input.epoch) return Promise.reject(new HarnessError('OFFICIAL_STALE_RUN', 'A newer or equal official run already owns this task.'));
    const authority: Authority = { ctx: Object.freeze({ threadId: input.threadId, runId: input.runId, epoch: input.epoch }), provider: model.provider, modelId: input.modelId, revoked: false, settled: false, children: new Set() };
    // Reserve cancellation authority synchronously, before the queue and all async startup.
    authorities.add(authority); runs.set(input.threadId, authority);
    const snapshot = structuredClone(input);
    return serial(input.threadId, async () => {
      try {
        if (existing) await stop(existing); assert(authority);
        const ctx = await context(authority, snapshot.sessionPath, snapshot.memory,snapshot.thinkingLevel); assert(authority);
        await open(authority, ctx, model.modelId,compact); assert(authority);
        callbacks?.onEvent({ ...authority.ctx, type: 'session', sessionPath: ctx.manifest.path });
        if (compact) await authority.driver!.compact(); else await deliver(authority, snapshot);
      } catch (error) { await stop(authority); throw error; }
    });
  }
  return {
    configure(value) { callbacks = value; },
    async models(options) {
      if (disposed) throw new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.');
      if(!modelDiscovery){
       if(modelCache&&!options?.refresh)return structuredClone(modelCache);
       modelCache=undefined;
       modelDiscovery=(async()=>{
        const providers = OFFICIAL_RUNTIME_PROVIDER_IDS.filter(isConnectionProviderId);
        const values: PromiseSettledResult<ModelInfo[]>[] = [];
        // Bound native startup work without adding another cache or scheduler.
        for (let index = 0; index < providers.length; index += 2) {
          if (disposed) throw new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.');
          values.push(...await Promise.allSettled(providers.slice(index, index + 2).map(provider => auxiliary(provider, async authority => {
            if (provider === 'cursor-sdk') {
              // An empty private profile must not import the SDK or start a worker.
              try { if (!(await stat(join(officialRuntimeHome(storage, provider), 'sdk-browser-login.json'))).isFile()) return []; }
              catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
              assert(authority); await prepareHome(provider); assert(authority);
              const models = await (await import('./cursor.ts')).discoverCursor(storage, ownedSpawn(authority));
              assert(authority); return models;
            }
            const ctx = await context(authority, null); return (await open(authority, ctx)).models;
          }))));
        }
        if(disposed)throw new HarnessError('OFFICIAL_DISPOSED','Official runtime is disposed.');
        const teardown=values.find(result=>result.status==='rejected'&&result.reason instanceof HarnessError&&result.reason.code==='RUNTIME_TEARDOWN_FAILED');
        if(teardown?.status==='rejected')throw teardown.reason;
        modelCache=values.flatMap(result=>result.status==='fulfilled'?result.value:[]);return modelCache;
       })().finally(()=>{modelDiscovery=undefined;});
      }
      return structuredClone(await modelDiscovery);
    },
    start(input) { return queue(input, false); },
    followUp(input) {
      return serial(input.threadId, async () => {
        const authority = runs.get(input.threadId);
        if (!authority || !sameContext(authority.ctx, input)) throw new HarnessError('OFFICIAL_STALE_RUN', 'No matching active official run for this follow-up.');
        await deliver(authority, structuredClone(input));
      });
    },
    async cancel(ctx) {
      const matches = [...authorities].filter(authority => sameContext(authority.ctx, ctx));
      for (const authority of matches) authority.revoked = true;
      await Promise.all(matches.map(stop));
      if (!disposed && matches.length && !matches[0].settled) { matches[0].settled = true; callbacks?.onEvent({ ...matches[0].ctx, type: 'settled', aborted: true }); }
    },
    compact(ctx, sessionPath, modelId) { return queue({ ...ctx, sessionPath, modelId, inputId: '', prompt: '', resources: [] }, true); },
    async history(sessionPath) {
      if (disposed) throw new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.');
      return serial(`official-history-${randomUUID()}`, async () => {
        if (disposed) throw new HarnessError('OFFICIAL_DISPOSED', 'Official runtime is disposed.');
        const manifest = await readManifest(storage, sessionPath);
        return auxiliary(manifest.value.provider, async authority => {
          authority.manifest = manifest;
          let receipts: HistoryReceipt[] = [];
          if (manifest.value.sessionId) {
            if (manifest.value.provider === 'claude-code') receipts = await (dependencies.claudeHistory ?? (await import('./history.ts')).claudeHistory)(storage, manifest, ownedSpawn(authority));
            else if (manifest.value.provider === 'gemini-cli') receipts = await (await import('./gemini.ts')).geminiHistory(storage, manifest, ownedSpawn(authority), { current: () => current(authority), ready(driver) { authority.driver = driver; if (!current(authority)) void driver.close().catch(() => {}); } });
            else if (manifest.value.provider === 'cursor-sdk') receipts = await (await import('./cursor.ts')).cursorHistory(storage, manifest, ownedSpawn(authority));
            else throw new HarnessError('OFFICIAL_PROVIDER_UNAVAILABLE', 'The official session provider is unknown.');
            assert(authority);
            for (const receipt of receipts) {
              const existing = manifest.value.inputs[receipt.uuid];
              if (existing && JSON.stringify(existing.inputIds) === JSON.stringify(receipt.inputIds)) existing.observed = true;
            }
            await saveManifest(manifest); assert(authority);
          }
          assert(authority);
          return [...new Set(Object.values(manifest.value.inputs).filter(receipt => receipt.observed).flatMap(receipt => receipt.inputIds))];
        });
      });
    },
    async dispose() {
      disposed = true;
      modelCache=undefined;
      for (const authority of authorities) authority.revoked = true;
      await Promise.all([...authorities].map(stop));
      await Promise.all([...locks.values()].map(promise => bounded(promise.catch(() => {}), 32_000, 'Official startup did not stop.')));
      await modelDiscovery?.catch(()=>{});
      runs.clear(); authorities.clear();
    },
  };
}
