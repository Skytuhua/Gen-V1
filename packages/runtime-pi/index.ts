import { spawn, type ChildProcess } from "node:child_process";
import { networkProxyChildEnv } from '../core/network-proxy-transport.ts';
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HarnessError, type ModelInfo, type RunContext, type RuntimeAdapter, type RuntimeCallbacks, type StartRun } from "../contracts/index.ts";
import { extractInputIds } from "./input-envelope.ts";
import { routeToolCall, sameContext, type ToolRequest } from "./ipc.ts";
import { safeError } from "./sdk.ts";
import { taskPaths, validateSessionPath } from "./session.ts";
import { terminateProcessTree } from "./process-tree.ts";
import {assertModelOnlyInput,type ModelPurpose} from '../runtime/model-only.ts';
import {requiresMemoryCheckpoint,routeMemoryCheckpoint,sameMemoryCheckpointRequirement} from '../runtime/memory-checkpoint.ts';

interface Worker {
  process: ChildProcess; ctx?: RunContext; allowed: Set<string>; active: boolean; stopping: boolean;
  authority?: RunAuthority;
  pending: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  exited: Promise<void>;
  termination?: Promise<void>;
  input?:StartRun;sessionPath?:string;checkpointWork?:Promise<unknown>;
}
interface RunAuthority { ctx: RunContext; revoked: boolean; settled?: boolean; worker?: Worker }

export function createPiRuntime({ dataDir,modelOnly:requestedModelOnly,purpose }: { dataDir: string;modelOnly?:boolean;purpose?:ModelPurpose }): RuntimeAdapter {
  const modelOnly=requestedModelOnly||purpose==='prediction'||purpose==='memory-extraction';
  const storage = resolve(dataDir);
  let callbacks: RuntimeCallbacks | undefined;
  let disposed = false;
  const runs = new Map<string, Worker>();
  const authorities = new Set<RunAuthority>();
  const workers = new Set<Worker>();
  const locks = new Map<string, Promise<unknown>>();
  let modelCache: ModelInfo[] | undefined;
  let modelDiscovery: Promise<ModelInfo[]> | undefined;
  let modelCacheEpoch=0,modelDiscoveryEpoch=0,modelDiscoveryProvider:string|undefined;
  // An empty provider can be a fresh result or an invalidated cache slot.
  const invalidatedProviders=new Set<string>();
  function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    locks.set(key, next);
    void next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
    return next;
  }
  const current = (worker: Worker) => !disposed && !worker.stopping && !worker.authority?.revoked && (!worker.ctx || runs.get(worker.ctx.threadId) === worker);
  function emit(worker: Worker, type: string, message: string) {
    if (worker.ctx && current(worker)) callbacks?.onEvent({ ...worker.ctx, type, message });
  }
  function assertContext(ctx: RunContext) {
    if (disposed) throw new HarnessError("PI_DISPOSED", "Pi runtime is disposed.");
    if (!callbacks) throw new HarnessError("PI_NOT_CONFIGURED", "Configure Pi runtime callbacks before starting work.");
    if (!ctx.threadId || !ctx.runId || !Number.isSafeInteger(ctx.epoch) || ctx.epoch < 0) throw new HarnessError("PI_CONTEXT_INVALID", "Invalid Pi run context.");
  }
  function assertAuthority(authority?: RunAuthority) {
    if (disposed) throw new HarnessError("PI_DISPOSED", "Pi runtime is disposed.");
    if (authority) {
      assertContext(authority.ctx);
      if (authority.revoked) throw new HarnessError("PI_RUN_ABORTED", "Pi run authority was revoked by cancellation.");
    }
  }
  const WORKER_ENV = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "SystemDrive", "WINDIR", "COMSPEC", "PATHEXT", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "USERNAME", "USER", "LOGNAME", "SHELL", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy"];
  function workerEnvironment(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" };
    for (const name of WORKER_ENV) if (process.env[name] !== undefined) env[name] = process.env[name];
    Object.assign(env, networkProxyChildEnv()); // #1531 T03: profile policy wins over inherited env
    return env;
  }
  async function spawnWorker(authority?: RunAuthority): Promise<Worker> {
    const ctx = authority?.ctx;
    assertAuthority(authority);
    await mkdir(taskPaths(storage, ctx?.threadId ?? "models").agentDir, { recursive: true, mode: 0o700 });
    assertAuthority(authority);
    const child = spawn(process.execPath, ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href, fileURLToPath(new URL("./worker.ts", import.meta.url))], {
      cwd: taskPaths(storage, "worker").agentDir,
      stdio: ["ignore", "ignore", "ignore", "ipc"], detached: process.platform !== "win32", windowsHide: true,
      env: workerEnvironment(), serialization: "advanced",
    });
    let didExit!: () => void;
    const worker: Worker = { process: child, ctx, authority, allowed: new Set(), active: !!ctx, stopping: false, pending: new Map(), exited: new Promise(resolve => { didExit = resolve; }) };
    if (authority) authority.worker = worker;
    workers.add(worker);
    child.on("message", (message: any) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "response") {
        const pending = worker.pending.get(message.requestId);
        if (!pending) return;
        worker.pending.delete(message.requestId); clearTimeout(pending.timer);
        if (typeof message.error === "string") pending.reject(new HarnessError(typeof message.code === "string" ? message.code : "PI_WORKER_ERROR", message.error)); else pending.resolve(message.value);
      } else if (message.type === "ready" && worker.ctx && sameContext(message.ctx, worker.ctx) && current(worker)) {
        worker.allowed = new Set(modelOnly?[]:message.tools);
      } else if (message.type === "event" && worker.ctx && sameContext(message.ctx, worker.ctx) && sameContext(message.event, worker.ctx) && current(worker)) {
        if(message.event.type==='session'&&typeof message.event.sessionPath==='string')worker.sessionPath=message.event.sessionPath;
        if (message.event.type === "settled") {
          worker.active = false;
          if (worker.authority) { worker.authority.settled = true; worker.authority.revoked = true; }
        }
        callbacks?.onEvent(message.event);
      } else if(message.type==='memory.checkpoint'&&worker.ctx&&current(worker)){
        const request=message.request;
        const check=()=>{if(!current(worker)||!worker.active||modelOnly||!worker.input||!requiresMemoryCheckpoint(worker.input.memoryCheckpoint))throw new HarnessError('MEMORY_CHECKPOINT_OWNER','Native checkpoint authority is no longer current.');};
        const respond=(value?:unknown)=>{try{if(current(worker)&&child.connected)child.send({type:'memory.checkpoint.result',requestId:request?.requestId,ctx:worker.ctx,...(value?{value}:{error:'Required memory checkpoint was not confirmed.'})},()=>{});}catch{/* A disconnected owner cannot resume native compaction. */}};
        if(worker.checkpointWork){respond();return;}
        const work=Promise.resolve().then(()=>{check();return routeMemoryCheckpoint(request,{adapterId:'pi',ctx:worker.ctx!,sessionPath:worker.sessionPath??worker.input!.sessionPath??'',modelId:worker.input!.modelId,accountId:worker.input!.accountId??null},callbacks?.onMemoryCheckpoint,check);});
        worker.checkpointWork=work;
        void work.then(value=>respond(value),()=>respond()).finally(()=>{if(worker.checkpointWork===work)worker.checkpointWork=undefined;});
      } else if (message.type === "tool.call" && worker.ctx && current(worker)) {
        const request = message as ToolRequest;
        void routeToolCall(request, worker.ctx, worker.allowed, callbacks!.onTool).then(
          reply => { if (current(worker) && child.connected) child.send(reply, () => {}); },
          error => { if (current(worker) && child.connected) child.send({ type: "tool.result", requestId: request.requestId, toolCallId: request.toolCallId, ctx: worker.ctx, error: safeError(error) }, () => {}); },
        );
      }
    });
    // A lifecycle observer cannot veto worker cleanup or the next notification.
    const notifyExit = (notify: () => void) => { try { notify(); } catch { /* The native worker still needs to be released. */ } };
    let didEnd = false;
    const ended = () => {
      if (didEnd) return;
      didEnd = true;
      for (const pending of worker.pending.values()) { clearTimeout(pending.timer); pending.reject(new HarnessError("PI_WORKER_EXITED", "Pi worker exited before completing the request. Run pnpm install if the SDK cannot load; retry or sign in with pnpm agent:login.")); }
      worker.pending.clear();
      if (worker.active && !worker.stopping) {
        notifyExit(() => emit(worker, "error", "Pi worker exited unexpectedly. Persisted history will determine which inputs were delivered."));
        const ctx = worker.ctx;
        if (ctx && current(worker)) notifyExit(() => callbacks?.onEvent({ ...ctx, type: "settled", aborted: true }));
      }
      worker.active = false;
      if (worker.authority) { worker.authority.settled = true; worker.authority.revoked = true; }
      if (worker.ctx && runs.get(worker.ctx.threadId) === worker) runs.delete(worker.ctx.threadId);
      const release=()=>{workers.delete(worker);if(authority)authorities.delete(authority);};
      // Exiting the native process revokes execution, but pending trusted host
      // persistence still belongs to this worker's cleanup barrier.
      if(worker.checkpointWork)void worker.checkpointWork.then(release,release);else release();
      didExit();
    };
    child.once("exit", ended);
    child.once("error", error => { if (!didEnd) notifyExit(() => emit(worker, "error", safeError(error))); ended(); });
    return worker;
  }
  function request(worker: Worker, command: string, args: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
    if (!worker.process.connected) return Promise.reject(new Error("Pi worker is disconnected."));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.pending.delete(requestId); reject(new Error(`Pi ${command} did not acknowledge within ${timeoutMs / 1000} seconds.`)); }, timeoutMs);
      worker.pending.set(requestId, { resolve, reject, timer });
      const fail = (error: unknown) => {
        if (!worker.pending.delete(requestId)) return;
        clearTimeout(timer);
        reject(error);
      };
      try {
        worker.process.send({ type: "command", requestId, command, dataDir: storage, ...(modelOnly?{modelOnly:true}:{}), ...(purpose?{purpose}:{}), ...args }, error => {
          if (error) fail(error);
        });
      } catch (error) { fail(error); }
    });
  }
  async function terminate(worker: Worker) {
    if (worker.termination) return worker.termination;
    worker.stopping = true;
    worker.termination = (async () => {
      if (worker.process.connected) await request(worker, "abort", { ctx: worker.ctx }, 1500).catch(() => {});
      await terminateProcessTree(worker.process);
      await worker.exited;
      await worker.checkpointWork?.catch(()=>{});
    })();
    return worker.termination;
  }
  async function prepare(authority: RunAuthority) {
    assertAuthority(authority);
    const ctx = authority.ctx;
    const old = runs.get(ctx.threadId);
    if (old) {
      if (old.ctx!.epoch > ctx.epoch || (old.ctx!.epoch === ctx.epoch && old.active)) throw new HarnessError("PI_STALE_RUN", "A Pi run with this epoch is already active; use followUp for the current run.");
      await terminate(old);
      assertAuthority(authority);
    }
    const worker = await spawnWorker(authority);
    assertAuthority(authority);
    runs.set(ctx.threadId, worker);
    return worker;
  }
  async function queueRun(input: StartRun, command: "start" | "compact", timeoutMs?: number): Promise<void> {
    if(modelOnly)assertModelOnlyInput(input,purpose);
    assertContext(input);
    if(requiresMemoryCheckpoint(input.memoryCheckpoint)&&(modelOnly||!callbacks?.onMemoryCheckpoint))throw new HarnessError('MEMORY_CHECKPOINT_UNSUPPORTED','Required memory checkpoint persistence is unavailable to this native runtime.');
    const ctx = { threadId: input.threadId, runId: input.runId, epoch: input.epoch };
    const original = structuredClone({ ...input, ...ctx, inputIds: input.inputIds && [...input.inputIds] });
    // Cancellation owns the original run before any queue or asynchronous setup can yield.
    const authority: RunAuthority = { ctx, revoked: false };
    authorities.add(authority);
    return serial(ctx.threadId, async () => {
      try {
        const worker = await prepare(authority);
        worker.input=original;worker.sessionPath=original.sessionPath??undefined;
        assertAuthority(authority);
        await request(worker, command, { input: original }, timeoutMs);
        if (authority.settled) return;
        assertAuthority(authority);
      } catch (error) {
        if (authority.worker) await terminate(authority.worker);
        authorities.delete(authority);
        throw error;
      }
    });
  }
  return {
    configure(value) { callbacks = value; },
    models:async function models(options):Promise<ModelInfo[]> {
      assertAuthority();
      if(modelDiscovery&&(options?.providerId!==modelDiscoveryProvider||modelCacheEpoch!==modelDiscoveryEpoch)){await modelDiscovery.catch(()=>{});return models(options);}
      if (!modelDiscovery) {
        if(modelCache&&!options?.refresh&&(!options?.providerId||!invalidatedProviders.has(options.providerId))) return structuredClone(options?.providerId?modelCache.filter(model=>model.provider===options.providerId):modelCache);
        if(modelCache&&options?.providerId)invalidatedProviders.add(options.providerId);
        modelCache = options?.providerId?modelCache?.filter(model=>model.provider!==options.providerId):undefined;
        const epoch=modelCacheEpoch;modelDiscoveryEpoch=epoch;modelDiscoveryProvider=options?.providerId;
        modelDiscovery = (async () => {
          const worker = await spawnWorker();
          let models: ModelInfo[];
          try { assertAuthority(); models = await request(worker, "models",options?.providerId?{providerId:options.providerId}:{}) as ModelInfo[]; }
          finally { await terminate(worker); }
          assertAuthority();
          if(options?.providerId)models=models.filter(model=>model.provider===options.providerId);
          if(epoch===modelCacheEpoch){
           modelCache = options?.providerId?(modelCache?[...modelCache,...models]:undefined):models;
           if(options?.providerId)invalidatedProviders.delete(options.providerId);else invalidatedProviders.clear();
          }
          return models;
        })().finally(() => { modelDiscovery = undefined; });
      }
      return structuredClone(await modelDiscovery);
    },
    async invalidateModels(options) {
      modelCacheEpoch++;
      if(options?.providerId&&modelCache)invalidatedProviders.add(options.providerId);else invalidatedProviders.clear();
      modelCache = options?.providerId?modelCache?.filter(model=>model.provider!==options.providerId):undefined;
    },
    start(input) { return queueRun(input, "start"); },
    followUp(input) { if(purpose==='memory-extraction')return Promise.reject(new HarnessError('MEMORY_EXTRACTION_SESSION_UNSUPPORTED','Memory extraction cannot continue a conversation.'));if(purpose==='prediction')return Promise.reject(new HarnessError('PREDICTION_SESSION_UNSUPPORTED','Predictions cannot continue a conversation.'));return serial(input.threadId, async () => {
      assertContext(input);
      const worker = runs.get(input.threadId);
      if (!worker || !sameContext(worker.ctx, input) || worker.stopping || !worker.active) throw new HarnessError("PI_STALE_RUN", "No matching active Pi run for this follow-up. Start or resume the task first.");
      assertAuthority(worker.authority);
      if(!sameMemoryCheckpointRequirement(input.memoryCheckpoint,worker.input?.memoryCheckpoint)||(input.accountId??null)!==(worker.input?.accountId??null))throw new HarnessError('MEMORY_CHECKPOINT_OWNER','Follow-up changed the captured checkpoint or account binding.');
      worker.active = true;
      await request(worker, "followUp", { input });
    }); },
    async cancel(ctx) {
      const matching = [...authorities].filter(authority => sameContext(authority.ctx, ctx));
      if (!matching.length) return;
      for (const authority of matching) authority.revoked = true;
      await Promise.all(matching.flatMap(authority => authority.worker ? [terminate(authority.worker)] : []));
      if (!disposed) {
        callbacks?.onEvent({ ...matching[0].ctx, type: "usage", usage: { activity: "idle" } });
        callbacks?.onEvent({ ...matching[0].ctx, type: "settled", aborted: true });
      }
    },
    compact(ctx, sessionPath, modelId,accountId,memoryCheckpoint) {
      if(purpose==='memory-extraction')return Promise.reject(new HarnessError('MEMORY_EXTRACTION_SESSION_UNSUPPORTED','Memory extraction cannot compact conversations.'));
      if(purpose==='prediction')return Promise.reject(new HarnessError('PREDICTION_SESSION_UNSUPPORTED','Predictions cannot compact conversations.'));
      const input: StartRun = { ...ctx, sessionPath, modelId,accountId,memoryCheckpoint, prompt: "", inputId: "", resources: [] };
      return queueRun(input, "compact", 180_000);
    },
    async history(sessionPath) {
      if(purpose==='memory-extraction')throw new HarnessError('MEMORY_EXTRACTION_SESSION_UNSUPPORTED','Memory extraction cannot read conversations.');
      if(purpose==='prediction')throw new HarnessError('PREDICTION_SESSION_UNSUPPORTED','Predictions cannot read conversations.');
      const file = await validateSessionPath(storage, sessionPath);
      return extractInputIds(await readFile(file, "utf8"));
    },
    async dispose() {
      disposed = true;
      modelCache = undefined;
      for (const authority of authorities) authority.revoked = true;
      await Promise.all([...workers].map(terminate));
      await modelDiscovery?.catch(() => {});
      runs.clear();
      authorities.clear();
    },
  };
}
