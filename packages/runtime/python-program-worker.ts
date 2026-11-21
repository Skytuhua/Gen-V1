import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, lstatSync } from 'node:fs';
import { lstat, opendir, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { DEFAULT_PROGRAM_LIMITS, programLimitsSchema, type ProgramBackendProof, type ProgramExecutionRequest, type ProgramExecutor } from '../contracts/tool-program.ts';
import type { ApprovedLaunch, ExecutionBackend, ExecutionHandle, PlatformProof } from '../core/execution-policy.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';

const PLATFORM = 'linux-x64';
const PRIVATE_FRAME_BYTES = 8 * 1024 * 1024;
/** Includes the working-directory root at depth zero. Each directory is read
 * incrementally in batches of at most 32 entries; no guest-sized array is
 * allocated. Exceeding either bound invalidates the kernel before dispatch. */
export const PYTHON_PREFLIGHT_DIRECTORY_LIMITS = Object.freeze({ maxEntries: 4096, maxDepth: 32 });
const WORKER_PATH = fileURLToPath(new URL('./python-program-worker.py', import.meta.url));
const CONFINEMENT_PATH = fileURLToPath(new URL('./python-confinement.py', import.meta.url));
const SUPERVISOR_PATH = fileURLToPath(new URL('./python-program-supervisor.py', import.meta.url));
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const pathSchema = z.string().min(1).max(4096).refine(value => isAbsolute(value) && !value.includes('\0'));
const pinnedFileSchema = z.strictObject({ path: pathSchema, sha256: hashSchema });
const configurationSchema = z.strictObject({
  version: z.literal(1), backendId: z.string().min(1).max(100),
  bwrap: pinnedFileSchema, interpreter: pinnedFileSchema, stdlib: pinnedFileSchema,
  libraries: z.array(z.strictObject({ path: pathSchema, mountPath: pathSchema, sha256: hashSchema })).min(1).max(32),
  workerSha256: hashSchema, confinementSha256: hashSchema, supervisorSha256: hashSchema,
});
export type PythonRuntimeConfiguration = z.infer<typeof configurationSchema>;
export interface PythonRuntimeInspection {
  backendId: string; bwrapPath: string; interpreterPath: string; stdlibPath: string;
  libraries: readonly { path: string; mountPath: string }[];
}
export interface PythonProgramWorkerOptions {
  runtime: PythonRuntimeConfiguration;
  generation: number;
  launch: ApprovedLaunch;
  /** Evidence must cover these pinned bytes on Linux x86_64. The hard memory
   * boundary is Python's RLIMIT_AS: at most 128 MiB of interpreter virtual
   * address space, including native allocations. It is not an RSS target or a
   * cgroup aggregate for the host, bwrap launcher and interpreter together. */
  platformProof: PlatformProof;
  /** Supplied only by the host's operator/source-lock composition. */
  approved: boolean;
}
const failure = (code: string, message: string) => new HarnessError(code, message);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Checkpoint = () => void;
const noCheckpoint: Checkpoint = () => {};
async function checked<T>(operation: () => Promise<T>, checkpoint: Checkpoint): Promise<T> {
  checkpoint(); const value = await operation(); checkpoint(); return value;
}

/** Approved retained-data policy for the private Python working directory.
 * Each total has its own inclusive 64 MiB ceiling; the two metrics are never
 * added together. This bounds the ACCEPTED RETAINED STATE observed at cell
 * boundaries (before launch/dispatch and after the supervisor's stopped-state
 * proof). It is not a hard filesystem quota: while a cell runs, transient disk
 * use is bounded only by the per-file limit and the backing filesystem. */
export const PYTHON_RETAINED_DATA_LIMITS = Object.freeze({ maxLogicalBytes: 67_108_864n, maxAllocatedBytes: 67_108_864n });

/** Accounting from one structural walk of the private directory. */
export interface PythonPrivateDirectoryAccounting {
  /** Inspected entries including the root at depth zero. */
  readonly entries: number;
  readonly maxDepth: number;
  readonly regularFiles: number;
  /** Sum of st_size (logical file length) over regular files. */
  readonly logicalBytes: bigint;
  /** Sum of st_blocks * 512 over every inspected entry, directories included. */
  readonly allocatedBytes: bigint;
}

/** The fail-closed structural walk used before each cell and after each
 * stopped cell: at most PYTHON_PREFLIGHT_DIRECTORY_LIMITS entries/depth,
 * streaming opendir batches of 32, no symbolic links, multiply linked files or
 * special files, and each retained-data total at most its own ceiling. Missing
 * or invalid size/block metadata refuses rather than counting as zero. The
 * checkpoint runs around every filesystem await, so cancellation or the cell
 * deadline stops traversal before the next filesystem operation. */
export async function inspectPythonPrivateDirectory(root: string, checkpoint: Checkpoint = noCheckpoint,
  limits: { readonly maxLogicalBytes: bigint; readonly maxAllocatedBytes: bigint } = PYTHON_RETAINED_DATA_LIMITS): Promise<PythonPrivateDirectoryAccounting> {
  // Callers may only tighten the approved ceilings (fixture boundary tests).
  if (typeof limits.maxLogicalBytes !== 'bigint' || typeof limits.maxAllocatedBytes !== 'bigint' || limits.maxLogicalBytes < 0n || limits.maxAllocatedBytes < 0n ||
      limits.maxLogicalBytes > PYTHON_RETAINED_DATA_LIMITS.maxLogicalBytes || limits.maxAllocatedBytes > PYTHON_RETAINED_DATA_LIMITS.maxAllocatedBytes)
    throw failure('PYTHON_RETAINED_DATA_UNAVAILABLE', 'Retained-data limits cannot exceed the approved 64 MiB ceilings');
  let entries = 0, maxDepth = 0, regularFiles = 0, logicalBytes = 0n, allocatedBytes = 0n;
  const inspect = async (path: string, depth: number): Promise<void> => {
    checkpoint();
    if (++entries > PYTHON_PREFLIGHT_DIRECTORY_LIMITS.maxEntries || depth > PYTHON_PREFLIGHT_DIRECTORY_LIMITS.maxDepth)
      throw failure('PYTHON_DIRECTORY_LIMIT', 'The private Python directory exceeds 4096 entries or depth 32');
    const info = await checked(() => lstat(path, { bigint: true }), checkpoint);
    if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1n) throw failure('PYTHON_PROFILE_DENIED', 'The private Python directory contains linked files');
    if (typeof info.blocks !== 'bigint' || info.blocks < 0n || typeof info.size !== 'bigint' || info.size < 0n)
      throw failure('PYTHON_RETAINED_DATA_UNAVAILABLE', 'The private Python directory size accounting is unavailable');
    maxDepth = Math.max(maxDepth, depth); allocatedBytes += info.blocks * 512n;
    if (allocatedBytes > limits.maxAllocatedBytes)
      throw failure('PYTHON_RETAINED_DATA_LIMIT', 'The private Python directory exceeds its 64 MiB allocated-bytes ceiling');
    if (info.isDirectory()) {
      checkpoint(); const directory = await opendir(path, { bufferSize: 32 });
      try {
        checkpoint();
        for (;;) {
          const entry = await checked(() => directory.read(), checkpoint);
          if (!entry) break;
          await inspect(join(path, entry.name), depth + 1);
        }
      } finally { await directory.close(); }
    }
    else if (info.isFile()) {
      regularFiles += 1; logicalBytes += info.size;
      if (logicalBytes > limits.maxLogicalBytes)
        throw failure('PYTHON_RETAINED_DATA_LIMIT', 'The private Python directory exceeds its 64 MiB logical-bytes ceiling');
    }
    else throw failure('PYTHON_PROFILE_DENIED', 'The private Python directory contains a special file');
  };
  try { await inspect(root, 0); }
  catch (error) {
    if (error instanceof HarnessError) throw error;
    throw failure('PYTHON_RETAINED_DATA_UNAVAILABLE', 'The private Python directory could not be accounted');
  }
  return Object.freeze({ entries, maxDepth, regularFiles, logicalBytes, allocatedBytes });
}

async function hashFile(path: string, checkpoint: Checkpoint = noCheckpoint, signal?: AbortSignal): Promise<string> {
  const info = await checked(() => lstat(path), checkpoint);
  if (!info.isFile() || info.size > 256 * 1024 * 1024)
    throw failure('PYTHON_RUNTIME_CHANGED', 'A configured runtime file is not a bounded regular file');
  const hash = createHash('sha256');
  let size = 0;
  checkpoint();
  for await (const value of createReadStream(path, { signal })) {
    checkpoint();
    size += (value as Buffer).length;
    if (size > 256 * 1024 * 1024) throw failure('PYTHON_RUNTIME_CHANGED', 'A configured runtime file exceeds its size bound');
    hash.update(value as Buffer);
  }
  checkpoint();
  return hash.digest('hex');
}

async function hashTree(root: string, checkpoint: Checkpoint = noCheckpoint, signal?: AbortSignal): Promise<string> {
  const rows: unknown[] = [];
  let entries = 0;
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    checkpoint();
    if (depth > 64) throw failure('PYTHON_RUNTIME_CHANGED', 'The configured runtime tree exceeds its depth bound');
    const names: string[] = [], handle = await opendir(directory, { bufferSize: 32 });
    try {
      checkpoint();
      for (;;) {
        const entry = await checked(() => handle.read(), checkpoint);
        if (!entry) break;
        if (++entries > 10_000) throw failure('PYTHON_RUNTIME_CHANGED', 'The configured runtime tree exceeds its entry bound');
        names.push(entry.name);
      }
    } finally { await handle.close(); }
    for (const name of names.sort()) {
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const info = await checked(() => lstat(path), checkpoint);
      if (info.isSymbolicLink()) rows.push([relative, 'link', await checked(() => readlink(path), checkpoint)]);
      else if (info.isDirectory()) { rows.push([relative, 'directory']); await walk(path, relative, depth + 1); }
      else if (info.isFile()) rows.push([relative, 'file', await hashFile(path, checkpoint, signal)]);
      else throw failure('PYTHON_RUNTIME_CHANGED', 'The configured runtime contains an unsupported node');
    }
  };
  await walk(root, '', 0); checkpoint();
  return sha256(JSON.stringify(rows));
}

/** Read-only fingerprinting of explicit host paths. This never grants approval
 * or manufactures a platform PASS proof, and never executes the inspected file. */
export async function inspectPythonRuntime(input: PythonRuntimeInspection): Promise<PythonRuntimeConfiguration> {
  return snapshotPythonRuntime(input, noCheckpoint);
}
async function snapshotPythonRuntime(input: PythonRuntimeInspection, checkpoint: Checkpoint, signal?: AbortSignal): Promise<PythonRuntimeConfiguration> {
  const pin = async (path: string) => { const canonical = await checked(() => realpath(path), checkpoint); return { path: canonical, sha256: await hashFile(canonical, checkpoint, signal) }; };
  const stdlibPath = await checked(() => realpath(input.stdlibPath), checkpoint);
  const [bwrap, interpreter, stdlibDigest, libraries, workerSha256, confinementSha256, supervisorSha256] = await Promise.all([
    pin(input.bwrapPath), pin(input.interpreterPath), hashTree(stdlibPath, checkpoint, signal),
    Promise.all(input.libraries.map(async library => ({ ...await pin(library.path), mountPath: library.mountPath }))),
    hashFile(WORKER_PATH, checkpoint, signal), hashFile(CONFINEMENT_PATH, checkpoint, signal), hashFile(SUPERVISOR_PATH, checkpoint, signal),
  ]);
  checkpoint();
  return configurationSchema.parse({ version: 1, backendId: input.backendId, bwrap, interpreter,
    stdlib: { path: stdlibPath, sha256: stdlibDigest }, libraries, workerSha256, confinementSha256, supervisorSha256 });
}

export function pythonRuntimeFingerprint(runtime: PythonRuntimeConfiguration): string {
  return sha256(JSON.stringify(configurationSchema.parse(runtime)));
}
export function pythonProgramArguments(): string[] { return ['-I', '-S', '-B', '/m12/worker.py']; }

function boundedJson(value: unknown, maximum: number): string {
  let allowance = maximum, entries = 0;
  const result = JSON.stringify(value, function (this: unknown, key, item: unknown) {
    // Charge a lower bound before stringify allocates the complete frame.
    // Array indices and the root's empty key are not serialized object keys.
    if (key && !Array.isArray(this)) allowance -= Buffer.byteLength(key) + 3;
    if (++entries > 200_000 || allowance < 0) throw failure('OUTPUT_LIMIT', 'The private protocol value exceeds its bound');
    if (typeof item === 'string') allowance -= Buffer.byteLength(item) + 2;
    else if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw failure('PROGRAM_PROTOCOL', 'Non-finite protocol numbers are not supported');
      allowance -= String(item).length;
    } else if (typeof item === 'boolean') allowance -= item ? 4 : 5;
    else if (item === null) allowance -= 4;
    else if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint')
      throw failure('PROGRAM_PROTOCOL', 'Only JSON protocol values are supported');
    if (allowance < 0) throw failure('OUTPUT_LIMIT', 'The private protocol value exceeds its bound');
    return item;
  });
  if (typeof result !== 'string' || Buffer.byteLength(result) > maximum) throw failure('OUTPUT_LIMIT', 'The private protocol value exceeds its bound');
  return result;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

interface ActiveCell {
  id: string;
  request: ProgramExecutionRequest;
  calls: number;
  pending: Set<string>;
  outputBytes: number;
  finishing: boolean;
  deadline: number;
  preflight: AbortController;
  timer: ReturnType<typeof setTimeout>;
  abort: () => void;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

class PythonProgramWorker implements ProgramExecutor {
  readonly proof: ProgramBackendProof;
  private readonly options: PythonProgramWorkerOptions;
  private readonly cwdIdentity: { dev: string; ino: string };
  private child?: ChildProcessWithoutNullStreams;
  private closed = false;
  private stopping?: Promise<void>;
  private active?: ActiveCell;
  private startup?: Promise<void>;
  private startupResolve?: () => void;
  private startupReject?: (reason: unknown) => void;
  private closePromise?: Promise<void>;
  private buffer = Buffer.alloc(0);
  private controlBuffer = Buffer.alloc(0);
  private readonly controls = new Map<string, { resolve(): void; reject(error: unknown): void }>();
  private ready = false;
  private supervisorReady = false;
  private paused = false;
  private memoryBytes?: number;

  constructor(options: PythonProgramWorkerOptions) {
    if (process.platform !== 'linux' || process.arch !== 'x64') throw failure('PYTHON_BACKEND_UNSUPPORTED', 'This Python backend requires its tested Linux x86_64 platform');
    if (options.approved !== true) throw failure('PYTHON_BACKEND_UNAPPROVED', 'The Python runtime requires explicit host operator approval');
    const runtime = configurationSchema.parse(options.runtime);
    if (options.platformProof.status !== 'PASS' || !options.platformProof.platformProofRef || !options.platformProof.evidenceRef)
      throw failure('PYTHON_PLATFORM_PROOF_REQUIRED', 'The Python runtime requires a recorded platform proof');
    if (options.platformProof.platform !== PLATFORM) throw failure('PYTHON_PLATFORM_PROOF_REQUIRED', 'The Python platform proof does not match this platform');
    if (!Number.isSafeInteger(options.generation) || options.generation < 1) throw failure('PROGRAM_PROTOCOL', 'A positive kernel generation is required');
    const launch = structuredClone(options.launch);
    if (launch.secretRefs.length) throw failure('PYTHON_PROFILE_DENIED', 'Python programs cannot receive secret references');
    if (launch.networkPolicy.mode !== 'none') throw failure('PYTHON_PROFILE_DENIED', 'Python programs require a no-network profile');
    if (launch.executable !== runtime.interpreter.path || launch.executableSha256 !== runtime.interpreter.sha256 ||
        JSON.stringify(launch.argv) !== JSON.stringify(pythonProgramArguments()))
      throw failure('PYTHON_PROFILE_DENIED', 'The approved launch does not match the pinned interpreter and argument vector');
    if (!isAbsolute(launch.cwd) || launch.readRoots.length !== 1 || launch.writeRoots.length !== 1 ||
        resolve(launch.readRoots[0]!) !== resolve(launch.cwd) || resolve(launch.writeRoots[0]!) !== resolve(launch.cwd))
      throw failure('PYTHON_PROFILE_DENIED', 'Python requires one explicitly approved private read/write working directory');
    const cwd = lstatSync(launch.cwd, { bigint: true });
    if (!cwd.isDirectory() || cwd.isSymbolicLink()) throw failure('PYTHON_PROFILE_DENIED', 'The private Python working directory is unavailable');
    this.cwdIdentity = { dev: String(cwd.dev), ino: String(cwd.ino) };
    const targets = new Set<string>();
    for (const library of runtime.libraries) {
      if (!/^\/lib(?:64|\/x86_64-linux-gnu)\/[A-Za-z0-9_.+-]+$/.test(library.mountPath) || targets.has(library.mountPath))
        throw failure('PYTHON_PROFILE_DENIED', 'Runtime library mounts must be exact unique system-library files');
      targets.add(library.mountPath);
    }
    this.options = { runtime, launch, generation: options.generation, platformProof: { ...options.platformProof }, approved: true };
    // memoryLimitBytes describes the interpreter RLIMIT_AS ceiling. The tiny
    // namespace launcher and the host's protocol buffers are outside that cap.
    this.proof = Object.freeze({ backendId: runtime.backendId, language: 'PYTHON', runtimeFingerprint: pythonRuntimeFingerprint(runtime), platform: PLATFORM,
      isolation: 'M03_CONFINED_PROCESS', memoryScope: 'INTERPRETER_ADDRESS_SPACE', memoryLimitBytes: DEFAULT_PROGRAM_LIMITS.memoryBytes, hardMemoryLimit: true,
      wholeExecutorMemoryLimitBytes: null,
      tested: true, evidenceRef: options.platformProof.evidenceRef });
  }

  private checkpoint(active: ActiveCell): void {
    if (active.request.signal.aborted) throw failure('PROGRAM_CANCELLED', 'The Python cell was cancelled during admission');
    if (Date.now() >= active.deadline) throw failure('PROGRAM_DEADLINE', 'The Python cell deadline expired during admission');
    if (this.active !== active || this.closed) throw failure('KERNEL_RESET_REQUIRED', 'The Python admission no longer owns this kernel');
  }

  private async verifyRuntime(active: ActiveCell): Promise<void> {
    const checkpoint = () => this.checkpoint(active);
    const expected = this.options.runtime;
    const actual = await snapshotPythonRuntime({ backendId: expected.backendId, bwrapPath: expected.bwrap.path,
      interpreterPath: expected.interpreter.path, stdlibPath: expected.stdlib.path,
      libraries: expected.libraries.map(({ path, mountPath }) => ({ path, mountPath })) }, checkpoint, active.preflight.signal);
    if (pythonRuntimeFingerprint(actual) !== this.proof.runtimeFingerprint)
      throw failure('PYTHON_RUNTIME_CHANGED', 'The approved Python runtime bytes changed; a new kernel approval is required');
    await this.verifyPrivateDirectory(active);
  }

  /** Canonical identity plus the retained-data walk of the private directory. */
  private async verifyPrivateDirectory(active: ActiveCell): Promise<void> {
    const checkpoint = () => this.checkpoint(active);
    const cwd = await checked(() => lstat(this.options.launch.cwd, { bigint: true }), checkpoint);
    if (await checked(() => realpath(this.options.launch.cwd), checkpoint) !== this.options.launch.cwd ||
        String(cwd.dev) !== this.cwdIdentity.dev || String(cwd.ino) !== this.cwdIdentity.ino)
      throw failure('PYTHON_PROFILE_DENIED', 'The private Python directory changed its canonical identity');
    await inspectPythonPrivateDirectory(this.options.launch.cwd, checkpoint); checkpoint();
  }

  private arguments(): string[] {
    const { runtime, launch } = this.options;
    const argv = ['--unshare-user', '--unshare-pid', '--as-pid-1', '--unshare-ipc', '--unshare-uts', '--die-with-parent', '--new-session',
      '--cap-drop', 'ALL', '--clearenv', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'PYTHONDONTWRITEBYTECODE', '1'];
    const directories = new Set(['/usr', '/usr/bin', '/usr/lib', '/lib', '/lib/x86_64-linux-gnu', '/lib64', '/m12']);
    for (const directory of directories) argv.push('--dir', directory);
    for (const [source, target] of [
      [runtime.interpreter.path, '/usr/bin/python3.13'], [runtime.stdlib.path, '/usr/lib/python3.13'],
      ...runtime.libraries.map(library => [library.path, library.mountPath]),
      [WORKER_PATH, '/m12/worker.py'], [CONFINEMENT_PATH, '/m12/confinement.py'],
    ]) argv.push('--ro-bind', source!, target!);
    argv.push('--bind', launch.cwd, '/work', '--size', '1048576', '--tmpfs', '/tmp', '--remount-ro', '/',
      '--chdir', '/work', '/usr/bin/python3.13', ...pythonProgramArguments());
    return argv;
  }

  private send(frame: unknown): void {
    if (!this.child || this.closed || !this.child.stdin.writable) throw failure('KERNEL_RESET_REQUIRED', 'The Python kernel is no longer available');
    const value = boundedJson(frame, PRIVATE_FRAME_BYTES) + '\n';
    this.child.stdin.write(value, error => { if (error) void this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel input pipe closed')); });
  }

  private control(type: 'launch' | 'pause' | 'resume', fields: Record<string, unknown> = {}): Promise<void> {
    if (!this.child || this.closed) return Promise.reject(failure('KERNEL_RESET_REQUIRED', 'The Python supervisor is no longer available'));
    const pipe = this.child.stdio[3] as Duplex, id = randomUUID();
    const value = boundedJson({ type, id, ...fields }, 64 * 1024) + '\n';
    return new Promise<void>((resolveControl, rejectControl) => {
      this.controls.set(id, { resolve: resolveControl, reject: rejectControl });
      pipe.write(value, error => { if (error) void this.fail(failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor control channel closed')); });
    });
  }

  private receiveControl(chunk: Buffer): void {
    if (this.closed) return;
    if (this.controlBuffer.length + chunk.length > 8192) { void this.fail(failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor exceeded its control bound')); return; }
    this.controlBuffer = Buffer.concat([this.controlBuffer, chunk]);
    for (let newline = this.controlBuffer.indexOf(10); newline >= 0; newline = this.controlBuffer.indexOf(10)) {
      const line = this.controlBuffer.subarray(0, newline); this.controlBuffer = this.controlBuffer.subarray(newline + 1);
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
        if (!object(value) || !exact(value, ['type', 'id']) || typeof value.id !== 'string' || !['ack', 'error'].includes(String(value.type)))
          throw failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor emitted an invalid control acknowledgement');
        const pending = this.controls.get(value.id);
        if (!pending) throw failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor acknowledged an unowned request');
        this.controls.delete(value.id);
        if (value.type === 'error') pending.reject(failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor could not confirm the owned process state'));
        else pending.resolve();
      } catch (error) { void this.fail(error); return; }
    }
  }

  private readyToExecute(): void { if (this.ready && this.supervisorReady) this.startupResolve?.(); }

  private start(memoryBytes: number): Promise<void> {
    if (this.startup) return this.startup;
    this.memoryBytes = memoryBytes;
    this.startup = new Promise<void>((resolveReady, rejectReady) => { this.startupResolve = resolveReady; this.startupReject = rejectReady; });
    void this.startup.catch(() => {});
    const child = spawn(this.options.runtime.interpreter.path, ['-I', '-S', '-B', SUPERVISOR_PATH], {
      cwd: this.options.launch.cwd, env: { LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], detached: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.closePromise = new Promise<void>(resolveClosed => child.once('close', () => resolveClosed()));
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const active = this.active;
      if (active) { active.outputBytes += chunk.length; if (active.outputBytes > active.request.limits.maxOutputBytes) void this.fail(failure('OUTPUT_LIMIT', 'Python output exceeded its byte limit')); }
    });
    child.stdin.on('error', () => { void this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel input pipe closed')); });
    child.stdout.on('error', () => { void this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel output pipe closed')); });
    child.stderr.on('error', () => { void this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel error pipe closed')); });
    const control = child.stdio[3] as Duplex;
    control.on('data', (chunk: Buffer) => this.receiveControl(chunk));
    control.on('error', () => { void this.fail(failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor control channel failed')); });
    control.on('close', () => { if (!this.closed) void this.fail(failure('PYTHON_QUIESCENCE_UNCONFIRMED', 'The Python supervisor control channel closed')); });
    child.once('error', () => { void this.fail(failure('PYTHON_BACKEND_UNSUPPORTED', 'The approved Python confinement launcher could not start')); });
    child.once('exit', () => { if (!this.closed) void this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel exited before an owned stop')); });
    child.once('spawn', () => {
      if (!this.closed) {
        void this.control('launch', { executable: this.options.runtime.bwrap.path, argv: this.arguments(), cwd: this.options.launch.cwd })
          .then(() => { this.supervisorReady = true; this.readyToExecute(); }, error => this.fail(error));
        this.send({ type: 'init', generation: this.options.generation, memoryBytes });
      }
    });
    return this.startup;
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    let cursor = 0;
    while (cursor < chunk.length && !this.closed) {
      const newline = chunk.indexOf(10, cursor), end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(cursor, end);
      const framed = (this.buffer[0] ?? part[0]) === 123;
      // Ready and framing bytes have a fixed independent allowance. Actual
      // output payload bytes are charged after the strict frame is parsed.
      const maximum = !this.ready ? 8192 : this.active ? this.active.request.limits.maxOutputBytes + (framed ? 1024 : 0) : 8192;
      if (this.buffer.length + part.length > maximum) { void this.fail(failure('OUTPUT_LIMIT', 'Python output exceeded its frame byte limit')); return; }
      this.buffer = Buffer.concat([this.buffer, part]);
      if (newline < 0) break;
      const completed = this.buffer; this.buffer = Buffer.alloc(0); cursor = newline + 1;
      try { this.frame(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(completed))); }
      catch (error) { void this.fail(error instanceof HarnessError ? error : failure('PROGRAM_PROTOCOL', 'The Python kernel emitted an invalid frame')); }
    }
  }

  private frame(value: unknown): void {
    if (!object(value)) throw failure('PROGRAM_PROTOCOL', 'The Python kernel emitted a non-object frame');
    if (!this.ready) {
      if (!exact(value, ['type', 'generation', 'protocolVersion']) || value.type !== 'ready' || value.generation !== this.options.generation || value.protocolVersion !== 1)
        throw failure('PROGRAM_PROTOCOL', 'The Python kernel did not establish the expected confined generation');
      this.ready = true; this.readyToExecute(); return;
    }
    const active = this.active;
    if (!active || value.generation !== this.options.generation || value.requestId !== active.id)
      throw failure('PROGRAM_PROTOCOL', 'A Python frame belongs to a stale cell or generation');
    if (active.finishing) throw failure('PROGRAM_PROTOCOL', 'A Python frame followed its claimed completion');
    if (value.type === 'output') {
      if (!exact(value, ['type', 'generation', 'requestId', 'text']) || typeof value.text !== 'string') throw failure('PROGRAM_PROTOCOL', 'Invalid Python output frame');
      this.consumeOutput(active, Buffer.byteLength(value.text)); return;
    }
    if (value.type === 'call') {
      if (!exact(value, ['type', 'generation', 'requestId', 'stableCallKey', 'name', 'args']) || typeof value.name !== 'string' || !value.name || value.name.length > 200 || !object(value.args))
        throw failure('PROGRAM_PROTOCOL', 'Invalid Python tool-call frame');
      if (active.calls >= active.request.limits.maxCalls) throw failure('PROGRAM_CALL_LIMIT', 'The Python cell exceeded its tool-call budget');
      if (active.pending.size >= active.request.limits.maxConcurrentCalls) throw failure('PROGRAM_CALL_LIMIT', 'The Python cell exceeded its concurrent tool-call budget');
      const key = `call:${active.calls}`;
      if (value.stableCallKey !== key) throw failure('PROGRAM_PROTOCOL', 'The Python cell reused or skipped a stable call identity');
      this.consumeOutput(active, Buffer.byteLength(boundedJson(value.args, active.request.limits.maxOutputBytes)));
      active.calls++; active.pending.add(key);
      void this.deliver(active, key, value.name, value.args);
      return;
    }
    if (value.type === 'result') {
      if (!exact(value, ['type', 'generation', 'requestId', 'value']) || active.pending.size) throw failure('PROGRAM_PROTOCOL', 'Python settled before its outstanding calls');
      this.consumeOutput(active, Buffer.byteLength(boundedJson(value.value, active.request.limits.maxOutputBytes)));
      active.finishing = true;
      void this.finish(active, value.value); return;
    }
    if (value.type === 'error') {
      if (!exact(value, ['type', 'generation', 'requestId', 'code']) || !['PYTHON_ERROR', 'MEMORY_LIMIT', 'OUTPUT_LIMIT', 'PROGRAM_PROTOCOL'].includes(String(value.code)))
        throw failure('PROGRAM_PROTOCOL', 'Invalid Python error frame');
      const code = String(value.code);
      void this.fail(failure(code, code === 'PYTHON_ERROR' ? 'The Python cell failed; private output was not published' : 'The Python kernel reached an execution boundary'));
      return;
    }
    throw failure('PROGRAM_PROTOCOL', 'The Python kernel emitted an unknown frame');
  }

  private consumeOutput(active: ActiveCell, bytes: number): void {
    active.outputBytes += bytes;
    if (active.outputBytes > active.request.limits.maxOutputBytes) throw failure('OUTPUT_LIMIT', 'The Python cell exceeded its output byte limit');
  }

  private async deliver(active: ActiveCell, key: string, name: string, args: Record<string, unknown>): Promise<void> {
    try {
      const delivery = await active.request.call(key, name, args);
      if (this.active !== active || this.closed || active.request.signal.aborted) return;
      const clock = active.request.beforeDelivery ? await active.request.beforeDelivery(key, active.calls) : delivery.clock;
      if (this.active !== active || this.closed || active.request.signal.aborted) return;
      active.pending.delete(key);
      this.send({ type: 'delivery', generation: this.options.generation, requestId: active.id, stableCallKey: key, value: delivery.value, clock });
    } catch (error) {
      if (this.active === active && !this.closed) await this.fail(error instanceof HarnessError ? error : failure('PYTHON_TOOL_FAILED', 'The Python host tool call failed'));
    }
  }

  private cleanup(active: ActiveCell): void {
    clearTimeout(active.timer); active.request.signal.removeEventListener('abort', active.abort);
    active.preflight.abort();
  }
  private async finish(active: ActiveCell, value: unknown): Promise<void> {
    try {
      // A guest result is untrusted. Keep its deadline running until the
      // separate pinned supervisor confirms this exact pidfd is stopped.
      await this.control('pause');
      if (this.active !== active || this.closed) return;
      this.paused = true;
      // Only after the stopped-state proof: the guest cannot write while the
      // retained state is measured. Overage fails the cell (the kernel layer
      // then requires reset); retained files are preserved, never deleted.
      await this.verifyPrivateDirectory(active);
      if (this.active !== active || this.closed) return;
      this.cleanup(active); this.active = undefined; active.resolve(value);
    } catch (error) { if (this.active === active && !this.closed) await this.fail(error); }
  }
  private async terminate(): Promise<void> {
    if (!this.child) return;
    await terminateProcessTree(this.child);
    if (this.closePromise) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([this.closePromise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(failure('KERNEL_RESET_REQUIRED', 'Python namespace pipe closure could not be confirmed')), 2000); })]); }
      finally { clearTimeout(timer); }
    }
  }
  private async fail(error: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const active = this.active; this.active = undefined;
    if (active) this.cleanup(active);
    this.startupReject?.(error);
    for (const pending of this.controls.values()) pending.reject(error);
    this.controls.clear();
    this.stopping ??= this.terminate();
    try { await this.stopping; active?.reject(error); }
    catch { active?.reject(failure('KERNEL_RESET_REQUIRED', 'Python namespace cleanup could not be confirmed')); }
  }

  async execute(request: ProgramExecutionRequest): Promise<unknown> {
    if (this.closed) throw failure('KERNEL_RESET_REQUIRED', 'The Python kernel requires an explicit reset');
    if (this.active) throw failure('KERNEL_BUSY', 'The Python kernel already owns an active cell');
    programLimitsSchema.parse(request.limits);
    if (typeof request.source !== 'string' || Buffer.byteLength(request.source) > 256 * 1024 || !Number.isSafeInteger(request.startClock))
      throw failure('PROGRAM_PROTOCOL', 'The Python source or start clock is invalid');
    if (this.memoryBytes !== undefined && this.memoryBytes !== request.limits.memoryBytes) {
      await this.stop();
      throw failure('KERNEL_RESET_REQUIRED', 'Changing the hard Python memory ceiling requires an explicit kernel reset');
    }
    const deadline = Math.min(request.startClock + request.limits.deadlineMs, Date.now() + request.limits.deadlineMs);
    if (request.signal.aborted) { await this.stop(); throw failure('PROGRAM_CANCELLED', 'The Python cell was cancelled before admission'); }
    if (deadline <= Date.now()) { await this.stop(); throw failure('PROGRAM_DEADLINE', 'The Python cell deadline expired before admission'); }
    const promise = new Promise<unknown>((resolveResult, rejectResult) => {
      const active: ActiveCell = {
        id: randomUUID(), request, calls: 0, pending: new Set(), outputBytes: 0, finishing: false, deadline, preflight: new AbortController(),
        timer: setTimeout(() => { void this.fail(failure('PROGRAM_DEADLINE', 'The Python cell exceeded its absolute deadline')); }, deadline - Date.now()),
        abort: () => { void this.fail(failure('PROGRAM_CANCELLED', 'The Python cell was cancelled')); },
        resolve: resolveResult, reject: rejectResult,
      };
      this.active = active; request.signal.addEventListener('abort', active.abort, { once: true });
      void (async () => {
        try {
          await this.verifyRuntime(active);
          this.checkpoint(active);
          await this.start(request.limits.memoryBytes);
          this.checkpoint(active);
          this.send({ type: 'execute', generation: this.options.generation, requestId: active.id,
            source: request.source, inputValues: request.inputValues, maxOutputBytes: request.limits.maxOutputBytes });
          if (this.paused) {
            this.paused = false;
            await this.control('resume');
          }
        } catch (error) { await this.fail(error instanceof HarnessError ? error : failure('PYTHON_RUNTIME_CHANGED', 'The approved Python runtime could not be verified')); }
      })();
    });
    return promise;
  }

  async stop(): Promise<void> {
    if (!this.closed) await this.fail(failure('KERNEL_RESET_REQUIRED', 'The Python kernel was stopped'));
    if (this.stopping) await this.stopping;
  }
}

export function createPythonProgramWorker(options: PythonProgramWorkerOptions): ProgramExecutor {
  return new PythonProgramWorker(options);
}

export interface PythonExecutionBackend extends ExecutionBackend {
  executor(handleId: string): ProgramExecutor;
  /** The Python backend's own platform and the original supplied proof, kept
   * unchanged for the worker, provider and recorded metadata. */
  readonly pythonPlatform: typeof PLATFORM;
  readonly pythonPlatformProof: PlatformProof;
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** M03's shared check compares a backend platform with Node's process.platform.
 * The Python proof is architecture-specific (linux-x64), so this adapter
 * exposes a 'linux' host projection to M03 only when the actual host is Linux
 * x64 AND the supplied proof is the exact linux-x64 PASS with a nonempty
 * reference and evidence. Any other host or proof exposes no current proof,
 * which keeps M03 denial. The supplied proof is never mutated. */
export function pythonM03PlatformProjection(proof: PlatformProof | null | undefined,
  host: { readonly platform: string; readonly arch: string } = { platform: process.platform, arch: process.arch }): { platform: string; proof: PlatformProof | null } {
  const exact = host.platform === 'linux' && host.arch === 'x64' && !!proof && proof.status === 'PASS' && proof.platform === PLATFORM &&
    nonempty(proof.platformProofRef) && nonempty(proof.evidenceRef) && typeof proof.recordedAt === 'string';
  if (!exact) return { platform: PLATFORM, proof: null };
  return { platform: 'linux', proof: Object.freeze({ platformProofRef: proof.platformProofRef, platform: 'linux', status: 'PASS',
    recordedAt: proof.recordedAt, evidenceRef: proof.evidenceRef }) };
}

/** M03 launch admission owns one lazy executor. Calling executor() does not
 * spawn a second process; the first cell starts it inside that cell's budget. */
export function pythonExecutionBackend(options: Omit<PythonProgramWorkerOptions, 'launch'>): PythonExecutionBackend {
  const executors = new Map<string, ProgramExecutor>();
  const m03 = pythonM03PlatformProjection(options.platformProof);
  return {
    backendId: options.runtime.backendId, platform: m03.platform,
    installed: process.platform === 'linux' && process.arch === 'x64' && [options.runtime.bwrap.path, options.runtime.interpreter.path, options.runtime.stdlib.path, WORKER_PATH, CONFINEMENT_PATH, SUPERVISOR_PATH].every(existsSync),
    approved: options.approved, proof: m03.proof,
    pythonPlatform: PLATFORM, pythonPlatformProof: options.platformProof,
    async launch(launch) {
      if (executors.size) throw failure('KERNEL_BUSY', 'This Python backend admission already owns a kernel');
      const executor = createPythonProgramWorker({ ...options, launch }), id = randomUUID(); executors.set(id, executor);
      return { id, terminate: () => executor.stop() } satisfies ExecutionHandle;
    },
    executor(id) {
      const executor = executors.get(id);
      if (!executor) throw failure('KERNEL_RESET_REQUIRED', 'The Python execution handle is not owned by this admission');
      return executor;
    },
  };
}
