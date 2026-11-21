import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProgramExecutor, ProgramJournalV1, ToolProgramV1 } from '../packages/contracts/tool-program.ts';
import type { ToolEffectRecord } from '../packages/contracts/tool-effects.ts';
import { ToolPrograms, type ToolProgramResult } from '../packages/core/tool-programs.ts';
import { ToolAuthority, buildToolRegistry } from '../packages/core/tool-authority.ts';
import { ToolDisclosure } from '../packages/core/tool-disclosure.ts';
import { createJavaScriptExecutor } from '../packages/runtime/tool-program-worker.ts';
import { REPLAY_OWNER, REPLAY_SOURCE, openReplayHarness, m12Ledger } from './fixtures/tool-program-replay-harness-v3.ts';
import { toolSchemas } from '../packages/capabilities/schemas.ts';

const PRIVATE_SOURCE = 'M12_DIAGNOSTIC_PRIVATE_SOURCE';
const PRIVATE_ERROR = 'M12_DIAGNOSTIC_PRIVATE_ERROR';
const source = `/* ${PRIVATE_SOURCE} */\n${REPLAY_SOURCE}`;
let executor: ProgramExecutor;
const cleanups: (() => Promise<void> | void)[] = [];
beforeAll(async () => { executor = await createJavaScriptExecutor(); });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(async () => { await executor?.stop(); });

type Harness = ReturnType<typeof openReplayHarness>;
type Completed = { f: Harness; program: ToolProgramV1; result: ToolProgramResult };
function fixture(options: Partial<Parameters<typeof openReplayHarness>[1]> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'm12-replay-diagnostics-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const f = openReplayHarness(directory, { owner: REPLAY_OWNER, executor, ...options });
  cleanups.push(() => f.close());
  return f;
}
function replace<T>(f: Harness, kind: string, id: string, change: (value: T) => T) {
  f.store.internal('m12.diagnostics.fixture.corrupt', REPLAY_OWNER.threadId, () => {
    f.store.put(kind, id, REPLAY_OWNER.threadId, change(f.store.get<T>(kind, id)!));
  });
}
async function completed(): Promise<Completed> {
  const f = fixture();
  const program = await f.prepare(source);
  const result = await f.programs.run(program.programId, REPLAY_OWNER, executor);
  expect(result).toMatchObject({ state: 'SUCCEEDED', error: null });
  expect(result.resultRef).toEqual(expect.any(String));
  return { f, program, result };
}
async function rejectsBeforeExecution(
  { f, program, result }: Completed,
  message: string,
  programs = f.programs,
  replayExecutor = executor,
) {
  const reads = f.state().reads;
  const effects = f.store.all<ToolEffectRecord>('toolEffect');
  let executions = 0;
  const monitored: ProgramExecutor = {
    proof: replayExecutor.proof,
    execute: request => { executions++; return replayExecutor.execute(request); },
    stop: async () => {},
  };
  const replay = await programs.run(program.programId, REPLAY_OWNER, monitored, { replay: true });
  expect(replay).toMatchObject({
    state: 'FAILED', resultRef: result.resultRef, sourceRefs: result.sourceRefs,
    error: { code: 'REPLAY_DIVERGED', message, originalResultRef: result.resultRef },
  });
  expect(replay.aggregate).toBeUndefined();
  expect(executions).toBe(0);
  expect(f.state().reads).toBe(reads);
  expect(f.store.all<ToolEffectRecord>('toolEffect')).toEqual(effects);
  expect(f.programs.inspect(program.programId, REPLAY_OWNER).program.error).toEqual(replay.error);
  if (result.resultRef) {
    expect(await f.results.read(REPLAY_OWNER, result.resultRef, { programId: program.programId }))
      .toMatchObject({ status: 'SUCCEEDED', value: result.aggregate });
  }
  for (const publicValue of [replay, f.store.snapshot(), f.store.eventsAfter(0), f.store.all('toolEffect')]) {
    const serialized = JSON.stringify(publicValue);
    for (const privateValue of [PRIVATE_SOURCE, PRIVATE_ERROR, 'M12_REPLAY_PRIVATE_SOURCE', source]) {
      expect(serialized).not.toContain(privateValue);
    }
  }
}

describe('M12 exact replay incompatibility diagnostics', () => {
  it('identifies a changed private program source without disclosing its text', async () => {
    const original = await completed();
    replace<{ source: string }>(original.f, 'toolProgramPrivate', original.program.programId,
      value => ({ ...value, source: `${value.source}\n/* changed private source */` }));
    await rejectsBeforeExecution(original, 'Program source digest differs from the original execution');
  });

  it('identifies a changed executor runtime fingerprint', async () => {
    const original = await completed();
    const changedRuntime: ProgramExecutor = {
      proof: { ...executor.proof, runtimeFingerprint: 'b'.repeat(64) },
      execute: request => executor.execute(request), stop: async () => {},
    };
    await rejectsBeforeExecution(original, 'Program runtime fingerprint differs from the original execution', original.f.programs, changedRuntime);
  });

  it('identifies a changed host tool registry after explicit redisclosure', async () => {
    const original = await completed();
    const { f } = original;
    const originalSchema = toolSchemas.repository_read;
    (toolSchemas as Record<string, unknown>).repository_read = originalSchema.extend({ driftedMarker: z.string().optional() });
    try {
      const registry = buildToolRegistry();
      const authority = new ToolAuthority(registry);
      const disclosure = new ToolDisclosure(f.store, authority, { currentOwner: () => REPLAY_OWNER, eligibleTools: ['repository_read'] });
      disclosure.disclose(REPLAY_OWNER, ['repository_read']);
      const programs = new ToolPrograms(f.store, { ...f.host, authority, disclosure, effects: m12Ledger(f.store, authority) });
      cleanups.push(() => programs.close());
      await rejectsBeforeExecution(original, 'Program tool registry digest differs from the original execution', programs);
    } finally {
      (toolSchemas as Record<string, unknown>).repository_read = originalSchema;
    }
  });

  const journalMismatches: { field: string; message: string; change(value: ProgramJournalV1): ProgramJournalV1 }[] = [
    { field: 'program identity', message: 'Retained journal program identity differs from the program',
      change: value => ({ ...value, programId: 'different-retained-program' }) },
    { field: 'source digest', message: 'Retained journal source digest differs from the program',
      change: value => ({ ...value, sourceDigest: 'a'.repeat(64) }) },
    { field: 'runtime fingerprint', message: 'Retained journal runtime fingerprint differs from the program',
      change: value => ({ ...value, runtimeFingerprint: 'b'.repeat(64) }) },
    { field: 'tool registry digest', message: 'Retained journal tool registry digest differs from the program',
      change: value => ({ ...value, toolRegistryDigest: 'c'.repeat(64) }) },
    { field: 'start clock', message: 'Retained journal start clock differs from the original program start',
      change: value => ({ ...value, startClock: value.startClock + 1, deadlineAt: value.deadlineAt + 1 }) },
    { field: 'deadline budget', message: 'Retained journal deadline differs from its start clock and original deadline limit',
      change: value => ({ ...value, deadlineAt: value.deadlineAt + 1 }) },
  ];
  it.each(journalMismatches)('identifies a retained journal $field mismatch', async ({ message, change }) => {
    const original = await completed();
    replace(original.f, 'programJournal', original.program.programId, change);
    await rejectsBeforeExecution(original, message);
  });

  it('identifies a changed absolute program deadline without renewing its budget', async () => {
    const original = await completed();
    const journal = original.f.store.get<ProgramJournalV1>('programJournal', original.program.programId)!;
    replace<ToolProgramV1>(original.f, 'toolProgram', original.program.programId,
      value => ({ ...value, deadlineAt: value.deadlineAt! + 1 }));
    await rejectsBeforeExecution(original, 'Retained journal deadline differs from the original program deadline');
    expect(original.f.store.get('programJournal', original.program.programId)).toEqual(journal);
  });

  it('retains failed private source details while reporting only the incompatible field', async () => {
    const f = fixture({ executeRead: async () => { throw new Error(PRIVATE_ERROR); } });
    const program = await f.prepare(source);
    const result = await f.programs.run(program.programId, REPLAY_OWNER, executor);
    expect(result).toMatchObject({ state: 'FAILED', error: { code: 'NESTED_TOOL_FAILED' } });
    expect(result.sourceRefs).toHaveLength(1);
    replace<ProgramJournalV1>(f, 'programJournal', program.programId,
      value => ({ ...value, runtimeFingerprint: 'b'.repeat(64) }));
    await rejectsBeforeExecution({ f, program, result }, 'Retained journal runtime fingerprint differs from the program');
    expect(await f.results.read(REPLAY_OWNER, result.sourceRefs[0]!, { programId: program.programId }))
      .toMatchObject({ status: 'FAILED', error: { message: PRIVATE_ERROR } });
  });
});
