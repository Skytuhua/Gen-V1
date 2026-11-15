import { afterAll, describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  DEFAULT_PROGRAM_LIMITS,
  type ProgramExecutionRequest,
  type ProgramExecutor,
  type ProgramToolDelivery,
} from '../packages/contracts/tool-program.ts';

const executors: ProgramExecutor[] = [];
const moduleUrl = pathToFileURL(resolve('packages/runtime/tool-program-worker.ts')).href;
async function create(): Promise<ProgramExecutor> {
  const api = await import(/* @vite-ignore */ moduleUrl).catch(() => ({}));
  expect(api.createJavaScriptExecutor, 'A checked JavaScript executor must be installed').toBeTypeOf('function');
  const executor = await api.createJavaScriptExecutor();
  executors.push(executor);
  return executor;
}
function request(source: string, overrides: Partial<ProgramExecutionRequest> = {}): ProgramExecutionRequest {
  return {
    source, inputValues: [], limits: { ...DEFAULT_PROGRAM_LIMITS },
    startSeed: 'a'.repeat(64), startClock: 1_700_000_000_000,
    signal: new AbortController().signal,
    call: async () => ({ value: {}, resultRef: 'fixture-result', clock: 1_700_000_000_100 }),
    ...overrides,
  };
}
afterAll(async () => { await Promise.all(executors.map(executor => executor.stop())); });

describe('M12 checked QuickJS worker boundary', () => {
  it('verifies its actual WASM memory maximum before claiming a bounded backend', async () => {
    const executor = await create();
    expect(executor.proof).toMatchObject({
      language: 'JAVASCRIPT', isolation: 'WASM_NO_HOST_IMPORTS', memoryLimitBytes: 134_217_728,
      memoryScope: 'GUEST_WASM_LINEAR', wholeExecutorMemoryLimitBytes: null,
      hardMemoryLimit: true, tested: true,
    });
    expect(executor.proof.runtimeFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(executor.proof.evidenceRef).toMatch(/^runtime-self-test:/);
    const value = await executor.execute(request(
      'try { new ArrayBuffer(134217728); return { escaped: true }; } catch (error) { return { escaped: false, name: error.name }; }',
    ));
    expect(value).toEqual({ escaped: false, name: 'InternalError' });
  });

  it('has no ambient filesystem, network, process, console, or module loader', async () => {
    const executor = await create();
    const value = await executor.execute(request([
      'const denied = [];',
      'for (const name of ["node:" + "fs", "file:///etc/passwd", "https://example.invalid/"]) {',
      '  try { await import(name); denied.push(false); } catch { denied.push(true); }',
      '}',
      'return { denied, ambient: ["process","require","fetch","console","WebAssembly","std","os","Deno","Bun"].map(name => typeof globalThis[name]) };',
    ].join('\n')));
    expect(value).toEqual({ denied: [true, true, true], ambient: Array(9).fill('undefined') });
  });

  it('snapshots and deeply freezes inputs before asynchronous execution', async () => {
    const executor = await create();
    const input = { rows: [{ count: 2 }] };
    const result = executor.execute(request(
      'let blocked = false; try { inputs[0].rows[0].count = 99; } catch { blocked = true; } return { count: inputs[0].rows[0].count, blocked };',
      { inputValues: [input] },
    ));
    input.rows[0].count = 8;
    expect(await result).toEqual({ count: 2, blocked: true });
    expect(input.rows[0].count).toBe(8);
  });

  it('returns private tool values through a frozen bridge and emits only the aggregate', async () => {
    const executor = await create();
    const calls: unknown[] = [];
    const value = await executor.execute(request([
      'try { Object.freeze = value => value; } catch {}',
      'const value = await tools.call("fixture_read", { offset: 3 });',
      'let blocked = false; try { value.rows.push({ n: 9 }); } catch { blocked = true; }',
      'return { total: value.rows.reduce((sum,row) => sum + row.n, 0), blocked };',
    ].join('\n'), {
      call: async (key, name, args) => {
        calls.push({ key, name, args });
        return { value: { rows: [{ n: 2 }, { n: 3 }], privateBulk: 'private'.repeat(10_000) },
          resultRef: 'private-result', clock: 1_700_000_000_100 };
      },
    }));
    expect(value).toEqual({ total: 5, blocked: true });
    expect(calls).toEqual([{ key: 'call:0', name: 'fixture_read', args: { offset: 3 } }]);
  });

  it('reproduces random values and virtual clocks from identical immutable start data', async () => {
    const executor = await create();
    const source = 'return { random: [Math.random(),Math.random(),Math.random()], now: Date.now(), timezone: new Date().getTimezoneOffset(), monotonic: performance.now() };';
    const first = await executor.execute(request(source));
    const second = await executor.execute(request(source));
    expect(second).toEqual(first);
    expect(first).toMatchObject({ now: 1_700_000_000_000, timezone: 0, monotonic: 0 });
  });

  it('commits each delivery before the VM resumes and includes all four issued identities', async () => {
    const executor = await create();
    const commits: { key: string; count: number }[] = [];
    let active = 0;
    let peak = 0;
    const value = await executor.execute(request([
      'const rows = await Promise.all([0,1,2,3].map(i => tools.call("fixture_read",{i})));',
      'return { rows: rows.map(row => row.i), clock: Date.now() };',
    ].join('\n'), {
      call: async (_key, _name, args) => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, (4 - Number(args.i)) * 10));
        active--;
        return { value: { i: args.i }, resultRef: 'result-' + args.i, clock: 1_700_000_000_100 };
      },
      beforeDelivery: async (key, count) => {
        commits.push({ key, count });
        await new Promise(resolve => setTimeout(resolve, 2));
        return 1_700_000_000_000 + commits.length;
      },
    }));
    expect(peak).toBe(4);
    expect(commits.map(entry => entry.count)).toEqual([4, 4, 4, 4]);
    expect(commits.map(entry => entry.key)).toEqual(['call:3', 'call:2', 'call:1', 'call:0']);
    expect(value).toEqual({ rows: [0, 1, 2, 3], clock: 1_700_000_000_004 });
  });

  it('does not deliver a tool result when its durable delivery commit is rejected', async () => {
    const executor = await create();
    let committed = 0;
    await expect(executor.execute(request(
      'await tools.call("fixture_read",{}); return "must-not-complete";',
      { beforeDelivery: async () => { committed++; throw new Error('commit denied'); } },
    ))).rejects.toMatchObject({ code: 'PROGRAM_DELIVERY_COMMIT_FAILED' });
    expect(committed).toBe(1);
  });

  it('journals a failed tool promise before rejecting it into the guest', async () => {
    const executor = await create();
    const commits: unknown[] = [];
    const value = await executor.execute(request(
      'try { await tools.call("fixture_read",{}); } catch(error) { return { message:error.message, clock:Date.now() }; }',
      {
        call: async () => { throw Object.assign(new Error('bounded original failure'), { code: 'NESTED_TOOL_FAILED' }); },
        beforeDelivery: async (key, count) => { commits.push({ key, count }); return 1_700_000_000_321; },
      },
    ));
    expect(commits).toEqual([{ key: 'call:0', count: 1 }]);
    expect(value).toEqual({ message: 'bounded original failure', clock: 1_700_000_000_321 });
  });

  it('registers all issued identities promptly while the host owns read concurrency', async () => {
    const executor = await create();
    const keys: string[] = [];
    const deliveryCounts: number[] = [];
    const value = await executor.execute(request(
      'return await Promise.all(Array.from({length: 12}, (_,i) => tools.call("fixture_read",{i})));',
      {
        call: async (key, _name, args) => {
          keys.push(key);
          await new Promise(resolve => setTimeout(resolve, 5));
          return { value: args.i, resultRef: 'result-' + args.i, clock: 1_700_000_000_100 };
        },
        beforeDelivery: async (_key, count) => { deliveryCounts.push(count); expect(keys.length).toBe(count); return 1_700_000_000_100; },
      },
    ));
    expect(value).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(deliveryCounts).toEqual(Array(12).fill(12));
    expect(keys).toEqual(Array.from({ length: 12 }, (_, i) => 'call:' + i));
  });

  it('rejects excess calls before dispatching work outside the budget', async () => {
    const executor = await create();
    const keys: string[] = [];
    await expect(executor.execute(request(
      'return await Promise.all([0,1,2].map(i => tools.call("fixture_read",{i})));',
      {
        limits: { ...DEFAULT_PROGRAM_LIMITS, maxCalls: 2, maxConcurrentCalls: 2 },
        call: async key => { keys.push(key); return { value: {}, resultRef: 'result', clock: 1_700_000_000_100 }; },
      },
    ))).rejects.toMatchObject({ code: 'PROGRAM_CALL_LIMIT' });
    expect(keys.length).toBeLessThanOrEqual(2);
  });

  it.each(['for (;;) {}', 'for (;;) await Promise.resolve();'])(
    'kills a non-settling guest independently of its event loop: %s',
    async source => {
      const executor = await create();
      const started = Date.now();
      await expect(executor.execute(request(source, {
        limits: { ...DEFAULT_PROGRAM_LIMITS, deadlineMs: 200 },
      }))).rejects.toMatchObject({ code: 'PROGRAM_DEADLINE_EXCEEDED' });
      expect(Date.now() - started).toBeLessThan(3_000);
    },
  );

  it('cancels pending delivery and never admits queued work after cancellation', async () => {
    const executor = await create();
    const controller = new AbortController();
    let complete!: (value: ProgramToolDelivery) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const keys: string[] = [];
    const result = executor.execute(request(
      'return await Promise.all([0,1,2].map(i => tools.call("fixture_read",{i})));',
      {
        signal: controller.signal, limits: { ...DEFAULT_PROGRAM_LIMITS, maxConcurrentCalls: 1 },
        call: async key => { keys.push(key); entered(); return await new Promise(resolve => { complete = resolve; }); },
      },
    ));
    const rejected = expect(result).rejects.toMatchObject({ code: 'PROGRAM_CANCELLED' });
    await started; controller.abort(); await rejected;
    complete({ value: {}, resultRef: 'late-result', clock: 1_700_000_000_100 });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(keys).toEqual(['call:0']);
  });

  it('rejects a guest aggregate above its byte limit', async () => {
    const executor = await create();
    await expect(executor.execute(request('return "x".repeat(300);', {
      limits: { ...DEFAULT_PROGRAM_LIMITS, maxOutputBytes: 256 },
    }))).rejects.toMatchObject({ code: 'PROGRAM_OUTPUT_LIMIT' });
  });
});
