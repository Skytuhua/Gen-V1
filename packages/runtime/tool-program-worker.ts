import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import {
  DEFAULT_PROGRAM_LIMITS, programLimitsSchema,
  type ProgramBackendProof, type ProgramExecutionRequest, type ProgramExecutor, type ProgramToolDelivery,
} from '../contracts/tool-program.ts';

const ENGINE_VERSION = '3.6.2';
const ENGINE_SHA256 = Object.freeze({
  'index.js': '91fcfc11e7f7372f3aee8d4373c0d4f969baac5cd12648663971550054217ae8',
  'extensions.js': '9662299693f6ddd8d56d6e2f91b4bd2202e2cfebe06e834bf9a2b16fa15c4e08',
  'version.js': '14dd0021bd1ba1f786a9833abd01b89c90a4175959d3b37b4d3bb62027a0b38d',
  'wasi-shim.js': '79af15cf5158d181d11021158abb22541fd6d35beca569652317859819960eac',
});
const WASM_SHA256 = 'd4c9375f2b1ca4dc95f72c8aa2982a7a9951ac8011490d79c6582df732b4bbd9';
const WORKER_URL = new URL('./tool-program-worker-child.mjs', import.meta.url);
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_ARGUMENT_BYTES = 256 * 1024;
const MAX_PRIVATE_VALUE_BYTES = 16 * 1024 * 1024;
const MAX_BUFFERED_DELIVERY_BYTES = 32 * 1024 * 1024;
const EXPECTED_IMPORTS = [
  'env:function:host_call', 'env:function:host_get_timezone_offset', 'env:function:host_interrupt',
  'env:function:host_module_load', 'env:function:host_module_normalize', 'env:function:host_promise_rejection',
  'wasi_snapshot_preview1:function:clock_time_get', 'wasi_snapshot_preview1:function:fd_close',
  'wasi_snapshot_preview1:function:fd_fdstat_get', 'wasi_snapshot_preview1:function:fd_seek',
  'wasi_snapshot_preview1:function:fd_write', 'wasi_snapshot_preview1:function:random_get',
].sort();

export class JavaScriptProgramError extends Error {
  constructor(readonly code: string, message: string) {
    super(message.slice(0, 2048));
    this.name = 'JavaScriptProgramError';
  }
}
function fail(code: string, message: string): never { throw new JavaScriptProgramError(code, message); }
function hash(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function u32(bytes: Uint8Array, position: { offset: number }): number {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    const byte = bytes[position.offset++];
    if (byte === undefined || (i === 4 && byte > 15)) fail('PROGRAM_BACKEND_UNAVAILABLE', 'Invalid pinned WASM integer');
    result |= (byte & 127) << (i * 7);
    if ((byte & 128) === 0) return result >>> 0;
  }
  return fail('PROGRAM_BACKEND_UNAVAILABLE', 'Invalid pinned WASM integer');
}
function leb(value: number): number[] {
  const bytes: number[] = [];
  do { const low = value & 127; value >>>= 7; bytes.push(low | (value === 0 ? 0 : 128)); } while (value !== 0);
  return bytes;
}

/** Narrow only the reviewed binary's sole memory maximum. No code or imports are rewritten. */
function boundMemory(bytes: Uint8Array, limit: number): Uint8Array {
  if (hash(bytes) !== WASM_SHA256) fail('PROGRAM_BACKEND_UNAVAILABLE', 'The QuickJS WASM cut changed');
  const pages = Math.floor(limit / 65_536);
  if (pages < 18 || pages > 2048) fail('PROGRAM_MEMORY_LIMIT', 'The memory budget cannot contain this QuickJS runtime');
  const sections: Uint8Array[] = [bytes.subarray(0, 8)];
  const position = { offset: 8 };
  let memories = 0;
  while (position.offset < bytes.length) {
    const sectionStart = position.offset;
    const kind = bytes[position.offset++];
    const length = u32(bytes, position);
    const start = position.offset;
    const end = start + length;
    if (end > bytes.length) fail('PROGRAM_BACKEND_UNAVAILABLE', 'Invalid pinned WASM section');
    if (kind === 5) {
      memories++;
      const memory = { offset: start };
      if (u32(bytes, memory) !== 1 || u32(bytes, memory) !== 0 || u32(bytes, memory) !== 18 || memory.offset !== end) {
        fail('PROGRAM_BACKEND_UNAVAILABLE', 'The reviewed WASM memory declaration changed');
      }
      const payload = Uint8Array.from([1, 1, 18, ...leb(pages)]);
      sections.push(Uint8Array.from([5, ...leb(payload.length)]), payload);
    } else sections.push(bytes.subarray(sectionStart, end));
    position.offset = end;
  }
  if (memories !== 1) fail('PROGRAM_BACKEND_UNAVAILABLE', 'QuickJS must have exactly one defined memory');
  return Uint8Array.from(Buffer.concat(sections));
}

interface Engine {
  engineUrl: string;
  bytes: Uint8Array;
  fingerprint: string;
  modules: Map<number, Promise<WebAssembly.Module>>;
}
async function compile(engine: Engine, limit: number): Promise<WebAssembly.Module> {
  let pending = engine.modules.get(limit);
  if (!pending) {
    pending = WebAssembly.compile(Uint8Array.from(boundMemory(engine.bytes, limit))).then(module => {
      const imports = WebAssembly.Module.imports(module).map(item => item.module + ':' + item.kind + ':' + item.name).sort();
      if (JSON.stringify(imports) !== JSON.stringify(EXPECTED_IMPORTS)) {
        fail('PROGRAM_BACKEND_UNAVAILABLE', 'QuickJS has an unreviewed host import');
      }
      const memories = WebAssembly.Module.exports(module).filter(item => item.kind === 'memory');
      if (memories.length !== 1 || memories[0].name !== 'memory') {
        fail('PROGRAM_BACKEND_UNAVAILABLE', 'QuickJS has an unexpected memory export');
      }
      return module;
    });
    engine.modules.set(limit, pending);
  }
  return pending;
}
async function loadEngine(): Promise<Engine> {
  // Resolve the existing parent's declared dependency through its public ESM entry.
  // This deliberately does not depend on pnpm's private directory layout or add a dependency.
  const parent = import.meta.resolve('@earendil-works/pi-coding-agent');
  const fromParent = createRequire(parent);
  const entry = fromParent.resolve('quickjs-wasi');
  const manifest = JSON.parse(await readFile(fromParent.resolve('quickjs-wasi/package.json'), 'utf8'));
  if (manifest.name !== 'quickjs-wasi' || manifest.version !== ENGINE_VERSION) {
    fail('PROGRAM_BACKEND_UNAVAILABLE', 'The reviewed QuickJS dependency is unavailable');
  }
  for (const [name, expected] of Object.entries(ENGINE_SHA256)) {
    if (hash(await readFile(join(dirname(entry), name))) !== expected) {
      fail('PROGRAM_BACKEND_UNAVAILABLE', 'The reviewed QuickJS JavaScript cut changed');
    }
  }
  const bytes = await readFile(fromParent.resolve('quickjs-wasi/quickjs.wasm'));
  if (hash(bytes) !== WASM_SHA256) fail('PROGRAM_BACKEND_UNAVAILABLE', 'The reviewed QuickJS WASM cut changed');
  const [child, adapter] = await Promise.all([readFile(WORKER_URL), readFile(new URL(import.meta.url))]);
  const fingerprint = hash(JSON.stringify({
    engine: ENGINE_VERSION, files: ENGINE_SHA256, wasm: WASM_SHA256,
    child: hash(child), adapter: hash(adapter), memoryTransform: 'one-memory-maximum-v1',
    node: process.versions.node, v8: process.versions.v8, platform: process.platform, arch: process.arch,
  }));
  return { engineUrl: pathToFileURL(entry).href, bytes, fingerprint, modules: new Map() };
}

/** Accept JSON data only, without invoking host getters, custom prototypes or toJSON methods. */
function jsonData(value: unknown, maxBytes: number): string {
  const path = new Set<object>();
  let nodes = 0;
  let estimate = 0;
  function copy(item: unknown, depth: number): unknown {
    if (++nodes > 1_000_000 || depth > 64) fail('PROGRAM_INVALID_INPUT', 'JSON input exceeds the structure budget');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item === 'string') {
      estimate += Buffer.byteLength(item);
      if (estimate > maxBytes) fail('PROGRAM_MEMORY_LIMIT', 'Private program data exceeds its byte budget');
      return item;
    }
    if (typeof item !== 'object' || item === null || path.has(item)) {
      fail('PROGRAM_INVALID_INPUT', 'Program data must be acyclic JSON');
    }
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      fail('PROGRAM_INVALID_INPUT', 'Program data must contain plain JSON objects');
    }
    path.add(item);
    const out: unknown[] | Record<string, unknown> = Array.isArray(item) ? [] : Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        fail('PROGRAM_INVALID_INPUT', 'Program data cannot contain accessors or hidden properties');
      }
      estimate += Buffer.byteLength(key) + 8;
      if (estimate > maxBytes) fail('PROGRAM_MEMORY_LIMIT', 'Private program data exceeds its byte budget');
      Object.defineProperty(out, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    path.delete(item);
    return out;
  }
  const text = JSON.stringify(copy(value, 0));
  if (text === undefined) fail('PROGRAM_INVALID_INPUT', 'Program data must be JSON');
  if (Buffer.byteLength(text) > maxBytes) fail('PROGRAM_MEMORY_LIMIT', 'Private program data exceeds its byte budget');
  return text;
}
function worker(module: WebAssembly.Module, engine: Engine, data: Record<string, unknown>): Worker {
  return new Worker(WORKER_URL, {
    workerData: { ...data, module, engineUrl: engine.engineUrl },
    env: {}, execArgv: [], argv: [], stdout: true, stderr: true,
    // These bound the trusted V8 wrapper separately. The 128 MiB proof is the
    // combined QuickJS/WASM linear memory, not total Node RSS or code-cache memory.
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
  });
}
async function verifyEngine(engine: Engine): Promise<void> {
  const module = await compile(engine, DEFAULT_PROGRAM_LIMITS.memoryBytes);
  await new Promise<void>((resolve, reject) => {
    const instance = worker(module, engine, { mode: 'self-test', memoryBytes: DEFAULT_PROGRAM_LIMITS.memoryBytes });
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void instance.terminate().then(() => error ? reject(error) : resolve(), reject);
    };
    const timer = setTimeout(() => finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend self-test timed out')), 5000);
    instance.on('message', message => {
      if (!record(message) || message.type !== 'self-test' || message.maximum !== 134_217_728
          || message.overflowRejected !== true || message.ambientClean !== true || message.environmentEmpty !== true
          || message.packageVersion !== ENGINE_VERSION || message.engineVersion !== '0.17.0') {
        finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend self-test failed'));
      } else finish();
    });
    instance.on('error', () => finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend worker could not start')));
    instance.on('exit', () => finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend worker exited before verification')));
    instance.stdout?.on('data', () => finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend emitted unexpected stdout')));
    instance.stderr?.on('data', () => finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The backend emitted unexpected stderr')));
  });
}
interface ReadyDelivery {
  key: string; ok: boolean; json?: string; message?: string; code?: string; clock: number; bytes: number;
}
function toolFailure(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message.slice(0, 2048) : 'Tool call failed';
  const code = record(error) && typeof error.code === 'string' ? error.code.slice(0, 200) : 'NESTED_TOOL_FAILED';
  return { message, code };
}
class CheckedJavaScriptExecutor implements ProgramExecutor {
  readonly proof: ProgramBackendProof;
  private closed = false;
  private readonly runs = new Set<(error: JavaScriptProgramError) => Promise<void>>();
  constructor(private readonly engine: Engine) {
    this.proof = Object.freeze({
      backendId: 'quickjs-wasi-worker-3.6.2-v1', language: 'JAVASCRIPT', runtimeFingerprint: engine.fingerprint,
      platform: process.platform + '-' + process.arch + '-node-' + process.versions.node,
      // Only explicit bridge/virtual clock imports exist; no ambient host capability imports.
      isolation: 'WASM_NO_HOST_IMPORTS', memoryScope: 'GUEST_WASM_LINEAR', memoryLimitBytes: DEFAULT_PROGRAM_LIMITS.memoryBytes,
      wholeExecutorMemoryLimitBytes: null,
      hardMemoryLimit: true, tested: true, evidenceRef: 'runtime-self-test:' + engine.fingerprint,
    });
  }
  async execute(request: ProgramExecutionRequest): Promise<unknown> {
    const started = performance.now();
    if (this.closed) fail('PROGRAM_BACKEND_UNAVAILABLE', 'The JavaScript executor has stopped');
    if (request.signal.aborted) fail('PROGRAM_CANCELLED', 'Program execution was cancelled');
    const parsed = programLimitsSchema.safeParse(request.limits);
    if (!parsed.success) fail('PROGRAM_INVALID_INPUT', 'Invalid program limits');
    const limits = parsed.data;
    if (typeof request.source !== 'string' || Buffer.byteLength(request.source) > MAX_SOURCE_BYTES) {
      fail('PROGRAM_INVALID_INPUT', 'Program source exceeds its byte budget');
    }
    if (!/^[a-f0-9]{64}$/.test(request.startSeed) || !Number.isSafeInteger(request.startClock) || request.startClock < 0) {
      fail('PROGRAM_INVALID_INPUT', 'Invalid deterministic start state');
    }
    const privateLimit = Math.min(MAX_PRIVATE_VALUE_BYTES, Math.floor(limits.memoryBytes / 4));
    const inputsJson = jsonData(request.inputValues, privateLimit);
    const source = request.source;
    const seed = request.startSeed;
    const startClock = request.startClock;
    return await new Promise<unknown>((resolve, reject) => {
      let instance: Worker | undefined;
      let settled = false;
      let termination: Promise<void> | undefined;
      let nextCall = 0;
      let offered: ReadyDelivery | undefined;
      let phase: 'offered' | 'committing' | 'draining' | undefined;
      let bufferedBytes = 0;
      const ready: ReadyDelivery[] = [];
      const known = new Set<string>();
      const interrupt = new SharedArrayBuffer(4);
      const finish = (error?: JavaScriptProgramError, value?: unknown): Promise<void> => {
        if (settled) return termination ?? Promise.resolve();
        settled = true;
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
        Atomics.store(new Int32Array(interrupt), 0, 1);
        ready.length = 0;
        offered = undefined;
        termination = (instance ? instance.terminate().then(() => undefined) : Promise.resolve()).then(() => {
          this.runs.delete(stop);
          if (error) reject(error); else resolve(value);
        }, () => {
          this.runs.delete(stop);
          reject(error ?? new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'Worker termination failed'));
        });
        return termination;
      };
      const stop = (error: JavaScriptProgramError) => finish(error);
      const abort = () => { void finish(new JavaScriptProgramError('PROGRAM_CANCELLED', 'Program execution was cancelled')); };
      const timer = setTimeout(() => {
        void finish(new JavaScriptProgramError('PROGRAM_DEADLINE_EXCEEDED', 'Program deadline expired'));
      }, Math.max(0, limits.deadlineMs - (performance.now() - started)));
      this.runs.add(stop);
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) { abort(); return; }
      const protocol = () => { void finish(new JavaScriptProgramError('PROGRAM_PROTOCOL_ERROR', 'Invalid worker protocol message')); };
      const offerNext = () => {
        if (settled || offered || !instance) return;
        offered = ready.shift();
        if (offered) {
          phase = 'offered';
          instance.postMessage({ type: 'offer', key: offered.key });
        }
      };
      const enqueue = (delivery: ReadyDelivery) => {
        if (settled) return;
        bufferedBytes += delivery.bytes;
        if (bufferedBytes > Math.min(MAX_BUFFERED_DELIVERY_BYTES, limits.memoryBytes)) {
          void finish(new JavaScriptProgramError('PROGRAM_MEMORY_LIMIT', 'Pending tool deliveries exceed their byte budget'));
          return;
        }
        ready.push(delivery);
        offerNext();
      };
      const acceptCall = (message: Record<string, unknown>) => {
        if (nextCall >= limits.maxCalls) {
          void finish(new JavaScriptProgramError('PROGRAM_CALL_LIMIT', 'Program tool-call budget exceeded'));
          return;
        }
        const key = 'call:' + nextCall;
        if (message.key !== key || message.issuedCount !== nextCall + 1
            || typeof message.name !== 'string' || !message.name || message.name.length > 200
            || typeof message.argsJson !== 'string' || Buffer.byteLength(message.argsJson) > MAX_ARGUMENT_BYTES) {
          protocol(); return;
        }
        let args: unknown;
        try { args = JSON.parse(message.argsJson); } catch { protocol(); return; }
        if (!record(args)) { protocol(); return; }
        nextCall++;
        known.add(key);
        // Every identity reaches the host immediately. The authority owner registers it
        // durably before awaiting its read semaphore; delaying this callback would make
        // the VM's issued count disagree with its durable journal.
        let result: Promise<ProgramToolDelivery>;
        try { result = request.call(key, message.name, args); }
        catch (error) { result = Promise.reject(error); }
        void Promise.resolve(result).then(delivery => {
          if (settled) return;
          try {
            if (!Number.isSafeInteger(delivery.clock) || delivery.clock < 0) protocol();
            else {
              const json = jsonData(delivery.value, privateLimit);
              enqueue({ key, ok: true, json, clock: delivery.clock, bytes: Buffer.byteLength(json) });
            }
          } catch (error) {
            void finish(error instanceof JavaScriptProgramError ? error
              : new JavaScriptProgramError('PROGRAM_INVALID_INPUT', 'Invalid private tool result'));
          }
        }, error => {
          const bounded = toolFailure(error);
          enqueue({ key, ok: false, ...bounded, clock: startClock, bytes: Buffer.byteLength(bounded.message) });
        });
      };
      const onMessage = (message: unknown) => {
        if (settled) return;
        if (!record(message)) { protocol(); return; }
        if (message.type === 'call') { acceptCall(message); return; }
        if (message.type === 'ready-to-deliver') {
          if (!offered || phase !== 'offered' || message.key !== offered.key || message.issuedCount !== nextCall) {
            protocol(); return;
          }
          phase = 'committing';
          const current = offered;
          const count = nextCall;
          void Promise.resolve().then(() => request.beforeDelivery ? request.beforeDelivery(current.key, count) : current.clock).then(clock => {
            if (settled) return;
            if (!Number.isSafeInteger(clock) || clock < 0) { protocol(); return; }
            phase = 'draining';
            instance!.postMessage({ type: 'commit', key: current.key, ok: current.ok,
              json: current.json, message: current.message, code: current.code, clock });
          }, () => { void finish(new JavaScriptProgramError('PROGRAM_DELIVERY_COMMIT_FAILED', 'The host could not commit this tool delivery')); });
          return;
        }
        if (message.type === 'drained') {
          if (!offered || phase !== 'draining' || message.key !== offered.key
              || message.issuedCount !== nextCall || !known.delete(offered.key)) { protocol(); return; }
          bufferedBytes -= offered.bytes;
          offered = undefined; phase = undefined;
          offerNext();
          return;
        }
        if (message.type === 'done') {
          if (typeof message.json !== 'string' || Buffer.byteLength(message.json) > limits.maxOutputBytes) {
            void finish(new JavaScriptProgramError('PROGRAM_OUTPUT_LIMIT', 'Program aggregate exceeds its byte budget'));
            return;
          }
          try { void finish(undefined, JSON.parse(message.json)); } catch { protocol(); }
          return;
        }
        if (message.type === 'error' && typeof message.code === 'string' && message.code.startsWith('PROGRAM_')
            && typeof message.message === 'string') {
          void finish(new JavaScriptProgramError(message.code, message.message));
          return;
        }
        protocol();
      };
      void compile(this.engine, limits.memoryBytes).then(module => {
        if (settled) return;
        if (performance.now() - started >= limits.deadlineMs) {
          void finish(new JavaScriptProgramError('PROGRAM_DEADLINE_EXCEEDED', 'Program deadline expired'));
          return;
        }
        instance = worker(module, this.engine, { mode: 'program', source, inputsJson, seed, startClock, limits, interrupt });
        instance.on('message', onMessage);
        instance.on('error', () => { void finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The JavaScript worker failed')); });
        instance.on('exit', () => { if (!settled) void finish(new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The JavaScript worker exited before its result')); });
        instance.stdout?.on('data', protocol);
        instance.stderr?.on('data', protocol);
      }).catch(error => { void finish(error instanceof JavaScriptProgramError ? error
        : new JavaScriptProgramError('PROGRAM_BACKEND_UNAVAILABLE', 'The JavaScript worker could not start')); });
    });
  }
  async stop(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.runs].map(stop => stop(new JavaScriptProgramError('PROGRAM_CANCELLED', 'The JavaScript executor stopped'))));
  }
}

/** This checks a backend. It does not grant tool authority or enable any product feature flag. */
export async function createJavaScriptExecutor(): Promise<ProgramExecutor> {
  const engine = await loadEngine();
  await verifyEngine(engine);
  return new CheckedJavaScriptExecutor(engine);
}
