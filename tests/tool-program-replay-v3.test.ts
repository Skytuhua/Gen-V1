import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ToolPrograms } from '../packages/core/tool-programs.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { ToolDisclosure } from '../packages/core/tool-disclosure.ts';
import { privateArgumentCommitment } from '../packages/core/tool-effects.ts';
import { createJavaScriptExecutor } from '../packages/runtime/tool-program-worker.ts';
import type { ProgramExecutor, ProgramExecutionRequest, ProgramJournalV1, NestedCallV1, ToolProgramV1 } from '../packages/contracts/tool-program.ts';
import type { ToolOwner, ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import { CRASH_POINTS, REPLAY_OWNER, REPLAY_SOURCE, openReplayHarness, m12Ledger, type CrashPoint } from './fixtures/tool-program-replay-harness-v3.ts';
import { assertCrashDeath } from './fixtures/tool-program-crash-death-v3.ts';
import { toolSchemas } from '../packages/capabilities/schemas.ts';

let executor: ProgramExecutor;
const cleanups: (() => Promise<void> | void)[] = [];
beforeAll(async () => { executor = await createJavaScriptExecutor(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(async () => { await executor?.stop(); });

type Harness = ReturnType<typeof openReplayHarness>;
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'm12-replay-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fixture(options: Partial<Parameters<typeof openReplayHarness>[1]> = {}, dir = directory()) {
  const f = openReplayHarness(dir, { owner: REPLAY_OWNER, executor, ...options });
  cleanups.push(() => f.close());
  return f;
}
function nestedEffects(f: Harness) {
  return f.store.all<ToolEffectRecord>('toolEffect').filter(effect => effect.parentInvocationId !== null);
}
function replace<T>(f: Harness, kind: string, id: string, change: (value: T) => T) {
  f.store.internal('m12.fixture.corrupt', REPLAY_OWNER.threadId, () => {
    f.store.put(kind, id, REPLAY_OWNER.threadId, change(f.store.get<T>(kind, id)!));
  });
}
async function completed(f = fixture(), source = REPLAY_SOURCE, limits = {}) {
  const program = await f.prepare(source, limits);
  const result = await f.programs.run(program.programId, REPLAY_OWNER, executor);
  expect(result).toMatchObject({ state: 'SUCCEEDED', error: null });
  return { f, program, result };
}
function expectReadReceiptsUnchanged(f: Harness, reads: number, receiptIds: string[]) {
  expect(f.state().reads).toBe(reads);
  expect(nestedEffects(f).map(effect => effect.invocationId)).toEqual(receiptIds);
  expect(nestedEffects(f).every(effect => effect.toolId === 'repository_read')).toBe(true);
}
/** Inject a trusted adapter fault while still executing the changed body in the
 * actual QuickJS worker. This exercises protocol checks after identity checks. */
function workerFault(change: (request: ProgramExecutionRequest) => ProgramExecutionRequest): ProgramExecutor {
  return { proof: executor.proof, execute: request => executor.execute(change(request)), stop: async () => {} };
}

describe('M12 actual JavaScript durable replay', () => {
  it('reuses private receipts and reproduces out-of-order delivery, RNG and virtual clocks without another read', async () => {
    const releases = new Map<number, (value: unknown) => void>();
    const deliveryResolvers: (() => void)[] = [];
    const deliveries = Array.from({ length: 4 }, () => new Promise<void>(resolve => deliveryResolvers.push(resolve)));
    let started!: () => void, delivered = 0;
    const allStarted = new Promise<void>(resolve => { started = resolve; });
    const f = fixture({
      executeRead: (call, _owner, signal) => new Promise((resolve, reject) => {
        releases.set(Number(call.args.sequence), resolve);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        if (releases.size === 4) started();
      }),
      boundary: point => { if (point === 'journal.delivery_committed') deliveryResolvers[delivered++]?.(); },
    });
    const source = `
      const order = [], clocks = [], initial = {random: Math.random(), clock: Date.now()};
      const values = await Promise.all([0,1,2,3].map(sequence =>
        tools.call('repository_read', {sequence}).then(value => {
          order.push(sequence); clocks.push(Date.now()); return value.total;
        })));
      return {order, clocks, values, initial, lastRandom: Math.random(), lastClock: Date.now()};
    `;
    const program = await f.prepare(source);
    const running = f.programs.run(program.programId, REPLAY_OWNER, executor);
    await allStarted;
    const order = [2, 0, 3, 1];
    for (const [index, sequence] of order.entries()) {
      releases.get(sequence)!({ total: sequence * 7, privateMarker: 'M12_REPLAY_PRIVATE_SOURCE' });
      await deliveries[index];
    }
    const first = await running;
    expect(first).toMatchObject({ state: 'SUCCEEDED', aggregate: { order, values: [0, 7, 14, 21] } });
    const journal = f.store.get<ProgramJournalV1>('programJournal', program.programId)!;
    expect(journal.deliveries.map(delivery => delivery.stableCallKey)).toEqual(order.map(i => `call:${i}`));
    expect(journal.deliveries.map(delivery => delivery.issuedCount)).toEqual([4, 4, 4, 4]);
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, executor, { replay: true });
    expect(replay).toMatchObject({ state: 'SUCCEEDED', aggregate: first.aggregate, sourceRefs: first.sourceRefs });
    expect(f.store.get('programJournal', program.programId)).toEqual(journal);
    expectReadReceiptsUnchanged(f, 4, receipts);
    expect(JSON.stringify(f.store.snapshot())).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.all('toolEffect'))).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
  });

  it.each(['source', 'runtime', 'arguments', 'call sequence', 'nested owner', 'issued count'] as const)(
    'rejects a changed %s with REPLAY_DIVERGED before any additional read', async change => {
      const { f, program, result } = await completed(fixture(), REPLAY_SOURCE, {});
      const receipts = nestedEffects(f).map(effect => effect.invocationId);
      let replayExecutor = executor;
      if (change === 'source') replace<{ source: string }>(f, 'toolProgramPrivate', program.programId, value => ({ ...value, source: value.source + '\nreturn 99;' }));
      if (change === 'runtime') replayExecutor = { ...workerFault(value => value), proof: { ...executor.proof, runtimeFingerprint: 'b'.repeat(64) } };
      if (change === 'arguments') replace<NestedCallV1>(f, 'nestedCall', `${program.programId}:call:0`, value => ({ ...value, argumentsCommitment: privateArgumentCommitment({ name: 'repository_read', args: { sequence: 999 } }) }));
      if (change === 'call sequence') replace<ProgramJournalV1>(f, 'programJournal', program.programId, value => ({ ...value, issuedCallKeys: ['call:1'] }));
      if (change === 'nested owner') replace<NestedCallV1>(f, 'nestedCall', `${program.programId}:call:0`, value => ({ ...value, owner: { ...value.owner, epoch: value.owner.epoch + 1 } }));
      if (change === 'issued count') replace<ProgramJournalV1>(f, 'programJournal', program.programId, value => ({
        ...value, deliveries: value.deliveries.map(delivery => ({ ...delivery, issuedCount: 2 })),
      }));
      const replay = await f.programs.run(program.programId, REPLAY_OWNER, replayExecutor, { replay: true });
      expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED', originalResultRef: result.resultRef } });
      expectReadReceiptsUnchanged(f, 1, receipts);
    },
  );

  it('rejects an actual registry definition change even after the host discloses the replacement', async () => {
    const { f, program } = await completed();
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const originalSchema = toolSchemas.repository_read;
    (toolSchemas as Record<string, unknown>).repository_read = originalSchema.extend({ driftedMarker: z.string().optional() });
    try {
      const registry = buildToolRegistry();
      const authority = new ToolAuthority(registry);
      const disclosure = new ToolDisclosure(f.store, authority, { currentOwner: () => REPLAY_OWNER, eligibleTools: ['repository_read'] });
      disclosure.disclose(REPLAY_OWNER, ['repository_read']);
      const programs = new ToolPrograms(f.store, { ...f.host, authority, disclosure, effects: m12Ledger(f.store, authority) });
      cleanups.push(() => programs.close());
      const replay = await programs.run(program.programId, REPLAY_OWNER, executor, { replay: true });
      expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
      expectReadReceiptsUnchanged(f, 1, receipts);
    } finally {
      (toolSchemas as Record<string, unknown>).repository_read = originalSchema;
    }
  });

  it.each(['threadId', 'runId', 'epoch', 'projectId', 'workspaceId', 'accountBinding'] as const)(
    'rejects current owner drift in %s before replay admission', async field => {
      const { f, program } = await completed();
      const receipts = nestedEffects(f).map(effect => effect.invocationId);
      const changed: ToolOwner = { ...REPLAY_OWNER, [field]: field === 'epoch' ? 2 : 'different-owner' };
      f.setCurrentOwner(changed);
      await expect(f.programs.run(program.programId, REPLAY_OWNER, executor, { replay: true })).rejects.toMatchObject({ code: 'PROGRAM_OWNER_REVOKED' });
      expectReadReceiptsUnchanged(f, 1, receipts);
    },
  );

  it('rejects changed VM arguments and cannot turn the rejected call into a successful caught aggregate', async () => {
    const { f, program } = await completed();
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const faulty = workerFault(request => ({ ...request, source: "try { await tools.call('repository_read', {sequence: 999}); } catch {} return {caught: true};" }));
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, faulty, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
    expect(replay.aggregate).toBeUndefined();
    expectReadReceiptsUnchanged(f, 1, receipts);
  });

  it('rejects a worker that returns before reproducing committed call identities and deliveries', async () => {
    const { f, program } = await completed();
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const replay = await f.programs.run(program.programId, REPLAY_OWNER,
      workerFault(request => ({ ...request, source: 'return {early: true};' })), { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
    expectReadReceiptsUnchanged(f, 1, receipts);
  });

  it('compares the actual VM issued count before releasing a replayed first delivery', async () => {
    const f = fixture();
    const originalSource = "return await Promise.all([tools.call('repository_read', {sequence: 0}), tools.call('repository_read', {sequence: 1})]);";
    const program = await f.prepare(originalSource);
    const first = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(first.state).toBe('SUCCEEDED');
    const journal = f.store.get<ProgramJournalV1>('programJournal', program.programId)!;
    expect(journal.deliveries[0]).toMatchObject({ stableCallKey: 'call:0', issuedCount: 2 });
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const source = "const first = await tools.call('repository_read', {sequence: 0}); const second = await tools.call('repository_read', {sequence: 1}); return [first, second];";
    const replay = await f.programs.run(program.programId, REPLAY_OWNER,
      workerFault(request => ({ ...request, source })), { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
    expectReadReceiptsUnchanged(f, 2, receipts);
  });

  it('does not admit an extra call after a completed original sequence has been reproduced', async () => {
    const { f, program } = await completed();
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const source = "await tools.call('repository_read', {sequence: 0}); await tools.call('repository_read', {sequence: 1}); return 14;";
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, workerFault(request => ({ ...request, source })), { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
    expectReadReceiptsUnchanged(f, 1, receipts);
  });

  it('reuses the original absolute deadline instead of granting a new replay budget', async () => {
    const f = fixture();
    const program = await f.prepare(REPLAY_SOURCE, { deadlineMs: 8_000 });
    const first = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(first.state).toBe('SUCCEEDED');
    const journal = f.store.get<ProgramJournalV1>('programJournal', program.programId)!;
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    await new Promise(resolve => setTimeout(resolve, Math.max(1, journal.deadlineAt - Date.now() + 5)));
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, executor, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'PROGRAM_DEADLINE' } });
    expect(f.store.get<ProgramJournalV1>('programJournal', program.programId)!.deadlineAt).toBe(journal.deadlineAt);
    expectReadReceiptsUnchanged(f, 1, receipts);
  });

  it('retains FAILED private sources on replay even when the real script catches the tool rejection', async () => {
    const f = fixture({ executeRead: async () => { throw new Error('M12_PRIVATE_ORIGINAL_FAILURE'); } });
    const program = await f.prepare("try { await tools.call('repository_read', {sequence: 0}); } catch (error) {} return {success: true};");
    const first = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(first).toMatchObject({ state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' } });
    expect(first.aggregate).toBeUndefined();
    expect(first.sourceRefs).toHaveLength(1);
    const original = await f.results.read(REPLAY_OWNER, first.sourceRefs[0]!, { programId: program.programId });
    expect(original).toMatchObject({ status: 'FAILED', error: { message: 'M12_PRIVATE_ORIGINAL_FAILURE' } });
    const journal = f.store.get<ProgramJournalV1>('programJournal', program.programId)!;
    expect(journal.deliveries).toMatchObject([{ state: 'FAILED', issuedCount: 1 }]);
    const receipts = nestedEffects(f).map(effect => effect.invocationId);
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, executor, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', sourceRefs: first.sourceRefs, error: { code: 'NESTED_TOOL_FAILED' } });
    expect(replay.aggregate).toBeUndefined();
    expect(JSON.stringify(replay)).not.toContain('M12_PRIVATE_ORIGINAL_FAILURE');
    expectReadReceiptsUnchanged(f, 1, receipts);
  });

  it('preserves an uncaught failed source classification without exposing its private error message', async () => {
    const f = fixture({ executeRead: async () => { throw new Error('M12_PRIVATE_UNCAUGHT_FAILURE'); } });
    const program = await f.prepare(REPLAY_SOURCE);
    const first = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(first).toMatchObject({ state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' } });
    expect(first.sourceRefs).toHaveLength(1);
    expect(JSON.stringify(first)).not.toContain('M12_PRIVATE_UNCAUGHT_FAILURE');
    const replay = await f.programs.run(program.programId, REPLAY_OWNER, executor, { replay: true });
    expect(replay).toMatchObject({ state: 'FAILED', sourceRefs: first.sourceRefs, error: { code: 'NESTED_TOOL_FAILED' } });
    expect(JSON.stringify(replay)).not.toContain('M12_PRIVATE_UNCAUGHT_FAILURE');
    expect(f.state().reads).toBe(1);
  });

  it('retains a known backend script-failure code while replacing a private guest error message', async () => {
    const f = fixture();
    const program = await f.prepare("const value = await tools.call('repository_read', {sequence: 0}); throw new Error(value.privateMarker);");
    const result = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(result).toMatchObject({ state: 'FAILED', error: { code: 'PROGRAM_SCRIPT_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.eventsAfter(0))).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
    expect(JSON.stringify(f.store.all('toolEffect'))).not.toContain('M12_REPLAY_PRIVATE_SOURCE');
  });
});

async function killAt(directory: string, point: CrashPoint) {
  const filename = fileURLToPath(new URL('./fixtures/tool-program-crash-v3.mts', import.meta.url));
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', filename, directory, point], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const capture = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-16 * 1024); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Crash fixture timed out at ${point}: ${output}`)); }, 60_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, output }); });
  });
}

describe('M12 real process death and explicit exact-owner restart', () => {
  it.each(CRASH_POINTS)('recovers %s without repeating a committed or unknown read', async point => {
    const dir = directory();
    const exit = await killAt(dir, point);
    assertCrashDeath(exit);
    const f = fixture({}, dir);
    expect(f.state()).toMatchObject({ owner: REPLAY_OWNER, killedAt: point });
    const programId = f.state().programId!;
    const before = f.store.get<ToolProgramV1>('toolProgram', programId)!;
    const calls = f.programs.calls(programId, REPLAY_OWNER);
    const originalRefs = calls.flatMap(call => call.resultRef ? [call.resultRef] : []);
    const readCount = f.state().reads;
    expect(readCount).toBe(['call.read_returned', 'call.result_committed', 'journal.delivery_committed', 'program.result_committed'].includes(point) ? 1 : 0);
    f.programs.recover();
    expect(f.state().reads).toBe(readCount);
    const replay = await f.programs.run(programId, REPLAY_OWNER, executor, { replay: true });
    if (point === 'program.prepared') {
      expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
      expect(f.state().reads).toBe(0);
      expect(nestedEffects(f)).toEqual([]);
    } else if (['call.effect_committed', 'call.dispatched', 'call.read_returned'].includes(point)) {
      expect(replay).toMatchObject({ state: 'FAILED', error: { code: 'REPLAY_DIVERGED' } });
      expect(f.state().reads).toBe(point === 'call.read_returned' ? 1 : 0);
      expect(f.programs.calls(programId, REPLAY_OWNER)).toMatchObject([{ state: 'UNKNOWN', resultRef: null }]);
      expect(nestedEffects(f)).toMatchObject([{ state: 'UNKNOWN_EXTERNAL_OUTCOME' }]);
    } else {
      expect(replay).toMatchObject({ state: 'SUCCEEDED', aggregate: { total: 7 } });
      expect(f.state().reads).toBe(1);
      if (originalRefs.length) expect(replay.sourceRefs).toEqual(originalRefs);
      expect(nestedEffects(f)).toHaveLength(1);
      expect(nestedEffects(f)[0]!.attemptId).toBe(1);
      if (before.resultRef) {
        const retained = await f.results.read(REPLAY_OWNER, before.resultRef, { programId });
        expect(retained).toMatchObject({ status: 'SUCCEEDED', value: replay.aggregate });
      }
    }
    expect(nestedEffects(f).every(effect => effect.toolId === 'repository_read')).toBe(true);
  }, 15_000);

  it('permits an explicitly requested first run after a PREPARED-only crash without inventing a replay journal', async () => {
    const dir = directory();
    const exit = await killAt(dir, 'program.prepared');
    assertCrashDeath(exit);
    const f = fixture({}, dir);
    expect(f.state()).toMatchObject({ owner: REPLAY_OWNER, killedAt: 'program.prepared' });
    const programId = f.state().programId!;
    expect(f.store.get('programJournal', programId)).toBeNull();
    const result = await f.programs.run(programId, REPLAY_OWNER, executor);
    expect(result).toMatchObject({ state: 'SUCCEEDED', aggregate: { total: 7 } });
    expect(f.state().reads).toBe(1);
    expect(nestedEffects(f)).toHaveLength(1);
  }, 15_000);
});
