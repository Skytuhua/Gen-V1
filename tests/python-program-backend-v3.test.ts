import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPythonProgramWorker, inspectPythonRuntime, pythonExecutionBackend, pythonProgramArguments, pythonRuntimeFingerprint,
  type PythonRuntimeConfiguration, type PythonProgramWorkerOptions,
} from '../packages/runtime/python-program-worker.ts';
import { DEFAULT_PROGRAM_LIMITS, type ProgramExecutionRequest, type ProgramExecutor } from '../packages/contracts/tool-program.ts';
import type { ApprovedLaunch, PlatformProof } from '../packages/core/execution-policy.ts';
import { pythonQualificationProfile } from './fixtures/python-qualification-profile.ts';

// Observe actual filesystem reads without replacing their results. Holding one
// completed read makes deadline/cancellation traversal behavior deterministic.
const scanObservation = vi.hoisted(() => ({
  directory: '', started: 0, hold: undefined as undefined | (() => Promise<void>),
}));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, lstat: async (...args: Parameters<typeof actual.lstat>) => {
    const tracked = scanObservation.directory && String(args[0]).startsWith(`${scanObservation.directory}/`);
    if (tracked) scanObservation.started++;
    const info = await actual.lstat(...args);
    if (tracked) await scanObservation.hold?.();
    return info;
  } };
});

const native = process.platform === 'linux' && process.arch === 'x64';
// Historical host paths unless the test-only qualification manifest is explicitly selected.
const qualification = pythonQualificationProfile();
const workers: ProgramExecutor[] = [], directories: string[] = [];
let runtime: PythonRuntimeConfiguration;
const proof: PlatformProof = {
  platformProofRef: 'm12-python-native-test-matrix', platform: 'linux-x64', status: 'PASS',
  recordedAt: '2026-11-15T00:00:00.000Z',
  evidenceRef: 'tests/python-program-backend-v3.test.ts (synthetic operator approval, actual native confinement cases)',
};

afterEach(async () => {
  await Promise.allSettled(workers.splice(0).map(worker => worker.stop()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function request(source: string, over: Partial<ProgramExecutionRequest> = {}): ProgramExecutionRequest {
  return {
    source, inputValues: [], limits: { ...DEFAULT_PROGRAM_LIMITS },
    startSeed: 'a'.repeat(64), startClock: Date.now(), signal: new AbortController().signal,
    call: async () => ({ value: null, resultRef: 'fixture-result', clock: Date.now() }), ...over,
  };
}

async function fixture(over: Partial<PythonProgramWorkerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'm12-python-native-'));
  directories.push(directory);
  const selectedRuntime = over.runtime ?? runtime;
  const launch: ApprovedLaunch = {
    profileId: 'M12_PRIVATE_PYTHON', profileVersion: 1, executable: selectedRuntime.interpreter.path,
    executableSha256: selectedRuntime.interpreter.sha256, argv: pythonProgramArguments(), cwd: directory,
    readRoots: [directory], writeRoots: [directory], networkPolicy: { mode: 'none' }, secretRefs: [],
  };
  const options: PythonProgramWorkerOptions = { runtime, generation: 1, launch, platformProof: proof, approved: true, ...over };
  const worker = createPythonProgramWorker(options);
  workers.push(worker);
  return { worker, directory, launch, options };
}

describe.runIf(native)('actual Linux Python program confinement with explicit test approval', () => {
  beforeAll(async () => {
    runtime = await inspectPythonRuntime(qualification.inspection);
    // This matrix is for these installed executables, never for arbitrary PATH resolution.
    expect(runtime.interpreter.sha256).toBe('889c603f0d17cb54060951bcf4c4f9b8c9ebd9e52b392c70209bbb9755d797d9');
    expect(runtime.bwrap.sha256).toBe('573236e5328ac2ebb08f59ae3a9805b4f8d12bdef14be8af4450d5463294985f');
    if (qualification.expected) {
      // Opt-in staged profile: every pinned byte and the fingerprint must equal the hash-verified manifest.
      expect(runtime).toEqual(qualification.expected.runtime);
      expect(pythonRuntimeFingerprint(runtime)).toBe(qualification.expected.runtimeFingerprint);
    }
  });

  it('requires explicit operator approval and a matching real-platform proof before execution', async () => {
    const { options } = await fixture();
    expect(() => createPythonProgramWorker({ ...options, approved: false })).toThrow(/approv/i);
    expect(() => createPythonProgramWorker({ ...options, platformProof: { ...proof, status: 'UNTESTED' } })).toThrow(/proof/i);
    expect(() => createPythonProgramWorker({ ...options, platformProof: { ...proof, platform: 'win32' } })).toThrow(/platform/i);
    expect(() => createPythonProgramWorker({ ...options, launch: { ...options.launch, secretRefs: ['credential'] } })).toThrow(/secret/i);
  });

  it('rejects changed interpreter bytes before a cell starts', async () => {
    const { worker } = await fixture({ runtime: { ...runtime, interpreter: { ...runtime.interpreter, sha256: '0'.repeat(64) } } });
    await expect(worker.execute(request('result = 7'))).rejects.toMatchObject({ code: 'PYTHON_RUNTIME_CHANGED' });
  });

  it('supports a small aggregate budget without charging protocol envelope bytes as output', async () => {
    const { worker } = await fixture();
    expect(await worker.execute(request("result = {'x': 2}", { limits: { ...DEFAULT_PROGRAM_LIMITS, maxOutputBytes: 8 } }))).toEqual({ x: 2 });
  });

  it('does not reuse a kernel after the private working directory identity is replaced', async () => {
    const { worker, directory } = await fixture();
    expect(await worker.execute(request('n = 1\nresult = n'))).toBe(1);
    const previous = directory + '-previous'; directories.push(previous);
    await rename(directory, previous); await mkdir(directory, { mode: 0o700 });
    await expect(worker.execute(request('n += 1\nresult = n'))).rejects.toMatchObject({ code: 'PYTHON_PROFILE_DENIED' });
  });

  it.each(['entry count', 'depth'] as const)('bounds a cell filesystem %s before accepting its result or dispatching the next cell', async limit => {
    const { worker, directory } = await fixture();
    const source = limit === 'entry count'
      ? "for i in range(4096):\n open('/work/entry-' + str(i), 'w').close()\nresult = 4096"
      : "import os\np = '/work'\nfor i in range(33):\n p += '/level'\n os.mkdir(p)\nresult = 33";
    // M12-D06: the same structural walk runs after the stopped-state proof, so
    // the over-bound cell itself fails instead of only the next cell.
    await expect(worker.execute(request(source))).rejects.toMatchObject({ code: 'PYTHON_DIRECTORY_LIMIT' });
    if (limit === 'entry count') expect(await readdir(directory)).toHaveLength(4096);
    else expect((await stat(join(directory, ...Array.from({ length: 33 }, () => 'level')))).isDirectory()).toBe(true);
    await expect(worker.execute(request("open('/work/dispatched', 'w').close()\nresult = 1"))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await expect(readFile(join(directory, 'dispatched'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['deadline', 'cancellation'] as const)('stops preflight traversal after %s even when a filesystem read settles late', async mode => {
    const { worker, directory } = await fixture();
    expect(await worker.execute(request("for i in range(64):\n open('/work/entry-' + str(i), 'w').close()\nresult = 64"))).toBe(64);
    let entered!: () => void, release!: () => void;
    const enteredRead = new Promise<void>(resolve => { entered = resolve; });
    const heldRead = new Promise<void>(resolve => { release = resolve; });
    scanObservation.directory = directory; scanObservation.started = 0;
    scanObservation.hold = async () => { scanObservation.hold = undefined; entered(); await heldRead; };
    const controller = new AbortController();
    try {
      const execution = worker.execute(request("open('/work/dispatched', 'w').close()\nresult = 1", {
        signal: controller.signal, limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 1500 },
      }));
      const rejected = expect(execution).rejects.toMatchObject({ code: mode === 'deadline' ? 'PROGRAM_DEADLINE' : 'PROGRAM_CANCELLED' });
      await enteredRead;
      if (mode === 'cancellation') controller.abort();
      await rejected;
      const startedBeforeRelease = scanObservation.started;
      release(); await new Promise<void>(resolve => setImmediate(resolve));
      expect(startedBeforeRelease).toBe(1);
      expect(scanObservation.started).toBe(startedBeforeRelease);
      await expect(readFile(join(directory, 'dispatched'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      release(); scanObservation.directory = ''; scanObservation.hold = undefined;
    }
  });

  it('retains globals and private files while clearing the explicit result and refreshing immutable inputs', async () => {
    const { worker, directory } = await fixture();
    const first = await worker.execute(request("count = 9\nopen('/work/saved.txt', 'w').write('retained')\nresult = {'count': count, 'input': inputs[0]['value']}", { inputValues: [{ value: 4 }] }));
    expect(first).toEqual({ count: 9, input: 4 });
    expect(await readFile(join(directory, 'saved.txt'), 'utf8')).toBe('retained');
    expect(await worker.execute(request("count += 2\nprint('discarded console text')"))).toBeNull();
    expect(await worker.execute(request("result = {'count': count, 'file': open('/work/saved.txt').read(), 'inputs': len(inputs)}"))).toEqual({ count: 11, file: 'retained', inputs: 0 });
    expect(await worker.execute(request("try:\n inputs[0]['value'] = 99\nexcept TypeError:\n result = inputs[0]['value']", { inputValues: [{ value: 5 }] }))).toBe(5);
  });

  it('routes fresh stable call identities through the host and commits delivery before exposing values', async () => {
    const { worker } = await fixture();
    const issued: string[] = [], delivered: string[] = [];
    const cell = () => request("private = tools.call('fixture_read', {'number': 2})\nresult = {'sum': sum(private['numbers'])}", {
      call: async (key, name, args) => {
        issued.push(`${key}:${name}:${args.number}`);
        return { value: { numbers: [2, 7], secret: 'private tool payload' }, resultRef: `result-${issued.length}`, clock: Date.now() };
      },
      beforeDelivery: async (key, count) => { delivered.push(`${key}:${count}`); return Date.now(); },
    });
    expect(await worker.execute(cell())).toEqual({ sum: 9 });
    expect(await worker.execute(cell())).toEqual({ sum: 9 });
    expect(issued).toEqual(['call:0:fixture_read:2', 'call:0:fixture_read:2']);
    expect(delivered).toEqual(['call:0:1', 'call:0:1']);
  });

  it('denies filesystem escape, runtime writes, network sockets, child processes and limit changes', async () => {
    const { worker } = await fixture();
    const value = await worker.execute(request(`import os, socket, ctypes
c = ctypes.CDLL(None, use_errno=True)
c.syscall.restype = ctypes.c_long
checks = {}
for name, action in [
 ('host_file', lambda: open('/etc/passwd')),
 ('host_proc', lambda: open('/proc/1/root/etc/passwd')),
 ('root_write', lambda: open('/outside-profile', 'w')),
 ('runtime_write', lambda: open('/usr/lib/python3.13/os.py', 'w')),
 ('tcp', lambda: socket.socket(socket.AF_INET, socket.SOCK_STREAM)),
 ('udp', lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM)),
 ('unix', lambda: socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)),
 ('supervisor_fd', lambda: os.fstat(3)),
 ('fork', os.fork),
]:
 try:
  obj = action()
  checks[name] = 'ALLOWED'
 except OSError as error:
  checks[name] = error.errno
for name, nr in [('clone3', 435), ('execveat', 322), ('unshare', 272), ('setns', 308), ('ptrace', 101), ('io_uring', 425), ('bpf', 321), ('prlimit', 302), ('kill', 62), ('pidfd_open', 434), ('pidfd_send_signal', 424), ('x32', 0x40000029)]:
 ctypes.set_errno(0)
 c.syscall(ctypes.c_long(nr), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0), ctypes.c_long(0))
 checks[name] = ctypes.get_errno()
result = checks`));
    expect(value).toEqual({ host_file: 2, host_proc: 2, root_write: 30, runtime_write: 30,
      tcp: 1, udp: 1, unix: 1, supervisor_fd: 9, fork: 1, clone3: 1, execveat: 1, unshare: 1, setns: 1, ptrace: 1, io_uring: 1, bpf: 1, prlimit: 1,
      kill: 1, pidfd_open: 1, pidfd_send_signal: 1, x32: 1 });
  });

  it('enforces the hard 128 MiB process limit and invalidates the exhausted kernel', async () => {
    const { worker } = await fixture();
    await expect(worker.execute(request('result = len(bytearray(256 * 1024 * 1024))'))).rejects.toMatchObject({ code: 'MEMORY_LIMIT' });
    await expect(worker.execute(request('result = 1'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('requires an explicit reset after a cell asks to change the hard memory ceiling', async () => {
    const { worker } = await fixture();
    expect(await worker.execute(request('result = 1'))).toBe(1);
    await expect(worker.execute(request('result = 2', { limits: { ...DEFAULT_PROGRAM_LIMITS, memoryBytes: 64 * 1024 * 1024 } }))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await expect(worker.execute(request('result = 3'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('caps printed output without buffering it into the model result', async () => {
    const { worker } = await fixture();
    await expect(worker.execute(request("print('x' * (256 * 1024 + 1))\nresult = 'must not settle'"))).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
    await expect(worker.execute(request('result = 1'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('caps raw protocol output before an unbounded line can accumulate', async () => {
    const { worker } = await fixture();
    await expect(worker.execute(request("import os\nos.write(1, b'x' * (256 * 1024 + 1))"))).rejects.toMatchObject({ code: 'OUTPUT_LIMIT' });
  });

  it('rejects late or forged request and generation frames', async () => {
    const { worker } = await fixture();
    await expect(worker.execute(request("import os\nos.write(1, b'{\"type\":\"result\",\"generation\":999,\"requestId\":\"stale\",\"value\":42}\\n')"))).rejects.toMatchObject({ code: 'PROGRAM_PROTOCOL' });
  });

  it('keeps the owned interpreter quiescent after an untrusted completion frame', async () => {
    const { worker, directory } = await fixture();
    const value = await worker.execute(request("import __main__, time\n__main__._send({'type': 'result', **__main__._identity(), 'value': 'claimed-complete'})\nwhile True:\n open('/work/after-result', 'w').write(str(time.monotonic_ns()))\n time.sleep(0.01)"));
    expect(value).toBe('claimed-complete');
    const sample = () => readFile(join(directory, 'after-result'), 'utf8').catch(() => 'absent');
    const first = await sample();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await sample()).toBe(first);
    // A forged result is never proof that trusted source control returned.
    // The retained process may resume only inside another explicit cell's
    // deadline, which still kills hostile code that ignores the next request.
    await expect(worker.execute(request('result = 2', { limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 1500 } }))).rejects.toMatchObject({ code: 'PROGRAM_DEADLINE' });
    const stopped = await sample();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await sample()).toBe(stopped);
    await expect(worker.execute(request('result = 3'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('enforces fresh host call quotas even when the guest sends raw frames', async () => {
    const { worker } = await fixture();
    const calls: string[] = [];
    await expect(worker.execute(request("for i in range(3):\n tools.call('fixture_read', {'i': i})\nresult = 1", {
      limits: { ...DEFAULT_PROGRAM_LIMITS, maxCalls: 2, maxConcurrentCalls: 1 },
      call: async key => { calls.push(key); return { value: 0, resultRef: key, clock: Date.now() }; },
    }))).rejects.toMatchObject({ code: 'PROGRAM_CALL_LIMIT' });
    expect(calls).toEqual(['call:0', 'call:1']);
  });

  it('kills and waits for a busy process at the absolute deadline without replay', async () => {
    const { worker } = await fixture();
    expect(await worker.execute(request('result = 1'))).toBe(1);
    const started = Date.now();
    await expect(worker.execute(request('while True:\n pass', { limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 250 } }))).rejects.toMatchObject({ code: 'PROGRAM_DEADLINE' });
    expect(Date.now() - started).toBeLessThan(2500);
    await expect(worker.execute(request('result = 2'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
    await worker.stop();
  });

  it('counts setup time in an already-expired deadline', async () => {
    const { worker } = await fixture();
    await expect(worker.execute(request('result = 1', { startClock: Date.now() - 1000, limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 10 } }))).rejects.toMatchObject({ code: 'PROGRAM_DEADLINE' });
  });

  it('aborts while waiting for a tool and ignores its later completion', async () => {
    const { worker } = await fixture();
    const control = new AbortController();
    let release!: () => void, issued!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen = new Promise<void>(resolve => { issued = resolve; });
    const executing = worker.execute(request("result = tools.call('fixture_read', {})", { signal: control.signal,
      call: async () => { issued(); await gate; return { value: 'late', resultRef: 'late', clock: Date.now() }; },
    }));
    const rejected = expect(executing).rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });
    await seen; control.abort(); await rejected; release();
    await expect(worker.execute(request('result = 1'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });

  it('admits only one cell at a time and creates no hidden queue', async () => {
    const { worker } = await fixture();
    let release!: () => void, issued!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const seen = new Promise<void>(resolve => { issued = resolve; });
    const executing = worker.execute(request("result = tools.call('fixture_read', {})", {
      call: async () => { issued(); await gate; return { value: 7, resultRef: 'result', clock: Date.now() }; },
    }));
    await seen;
    await expect(worker.execute(request('result = 2'))).rejects.toMatchObject({ code: 'KERNEL_BUSY' });
    release(); expect(await executing).toBe(7);
  });

  it('exposes one M03 handle for the same persistent executor without a second spawn', async () => {
    const { launch } = await fixture();
    const adapter = pythonExecutionBackend({ runtime, generation: 8, platformProof: proof, approved: true });
    const handle = await adapter.launch(launch), executor = adapter.executor(handle.id);
    workers.push(executor);
    expect(await executor.execute(request('n = 3\nresult = n'))).toBe(3);
    expect(await executor.execute(request('n += 1\nresult = n'))).toBe(4);
    await handle.terminate();
    await expect(executor.execute(request('result = n'))).rejects.toMatchObject({ code: 'KERNEL_RESET_REQUIRED' });
  });
});
