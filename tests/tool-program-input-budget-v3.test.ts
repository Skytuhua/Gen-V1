import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import type { ProgramExecutionRequest, ProgramExecutor } from '../packages/contracts/tool-program.ts';
import { toolProgramV1Schema } from '../packages/contracts/tool-program.ts';
import { programArguments, pythonCellArguments } from '../packages/core/tool-program-tools.ts';
import { createJavaScriptExecutor } from '../packages/runtime/tool-program-worker.ts';
import { digest } from '../packages/storage/store.ts';
import { REPLAY_OWNER, openReplayHarness } from './fixtures/tool-program-replay-harness-v3.ts';

const INPUT_BYTES = 4 * 1024 * 1024, INPUT_NODES = 100_000;
let realExecutor: ProgramExecutor;
const cleanups: (() => Promise<void> | void)[] = [];
beforeAll(async () => { realExecutor = await createJavaScriptExecutor(); });
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.restoreAllMocks(); }
});
afterAll(async () => { await realExecutor?.stop(); });

function syntheticExecutor(language: 'JAVASCRIPT' | 'PYTHON' = 'JAVASCRIPT') {
  const execute = vi.fn(async (request: ProgramExecutionRequest) => ({ inputs: request.inputValues.length }));
  const executor: ProgramExecutor = { proof: { ...realExecutor.proof, language, platform: 'synthetic',
    memoryScope: 'SYNTHETIC_CONTRACT', isolation: language === 'PYTHON' ? 'M03_CONFINED_PROCESS' : 'WASM_NO_HOST_IMPORTS',
    evidenceRef: 'input-admission-contract-fixture; not a platform confinement proof' }, execute, stop: async () => {} };
  return { executor, execute };
}
function fixture(executor: ProgramExecutor = syntheticExecutor().executor) {
  const path = mkdtempSync(join(tmpdir(), 'm12-input-budget-'));
  cleanups.push(() => rmSync(path, { recursive: true, force: true }));
  const f = openReplayHarness(path, { owner: REPLAY_OWNER, executor });
  cleanups.push(() => f.close());
  let serial = 0;
  return { ...f, path,
    save: (value: unknown, contentType: 'application/json' | 'text/plain' = 'application/json') => f.results.save({
      owner: REPLAY_OWNER, programId: `source-${++serial}`, status: 'SUCCEEDED', value, contentType, grants: [],
    }),
    prepareInputs: (inputRefs: string[], source = 'return inputs.length;') => f.programs.prepare({
      owner: REPLAY_OWNER, language: executor.proof.language, source, allowedTools: [], inputRefs, requestedAggregate: 'Count the explicit inputs',
    }, executor),
  };
}
async function expectInputLimit(f: ReturnType<typeof fixture>, inputRefs: string[], executor: ProgramExecutor, execute: ReturnType<typeof vi.fn>) {
  const program = await f.prepareInputs(inputRefs);
  const result = await f.programs.run(program.programId, REPLAY_OWNER, executor);
  expect(result).toMatchObject({ state: 'FAILED', error: { code: 'INPUT_LIMIT' } });
  expect(result.aggregate).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
  expect(f.state().reads).toBe(0);
  return program;
}

describe('M12 unique input reference admission', () => {
  it('rejects 64 duplicate refs in JavaScript, Python and persisted schemas and advertises uniqueness', async () => {
    const f = fixture(), ref = await f.save(7), inputRefs = Array(64).fill(ref);
    const request = { commandId: 'request', source: 'return 7;', allowedTools: [], inputRefs, requestedAggregate: 'seven' };
    expect(programArguments.safeParse(request).success).toBe(false);
    expect(pythonCellArguments.safeParse(request).success).toBe(false);
    const valid = await f.prepareInputs([]);
    expect(toolProgramV1Schema.safeParse({ ...valid, inputRefs }).success).toBe(false);
    for (const schema of [programArguments, pythonCellArguments]) {
      const parameters = z.toJSONSchema(schema);
      expect(parameters.properties?.inputRefs).toMatchObject({ type: 'array', maxItems: 64, uniqueItems: true });
    }
  });

  it('rejects duplicate refs before authorizing or reading any input', async () => {
    const f = fixture(), ref = await f.save('one retained value');
    const authorize = vi.spyOn(f.results, 'authorizeInput'), read = vi.spyOn(f.results, 'read');
    await expect(f.prepareInputs(Array(64).fill(ref))).rejects.toMatchObject({ code: 'INPUT_LIMIT' });
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(f.store.all('toolProgram')).toEqual([]);
    expect(f.store.all('privateToolResultAccess')).toEqual([]);
  });

  it('rejects a persisted duplicate list before execution, state writes or payload reads', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor), ref = await f.save(7);
    const program = await f.prepareInputs([ref]);
    f.store.internal('m12.input.fixture.duplicate', REPLAY_OWNER.threadId, () => {
      f.store.put('toolProgram', program.programId, REPLAY_OWNER.threadId, { ...program, inputRefs: Array(64).fill(ref) });
    });
    const before = f.store.sequence, read = vi.spyOn(f.results, 'read');
    await expect(f.programs.run(program.programId, REPLAY_OWNER, executor)).rejects.toMatchObject({ code: 'INPUT_LIMIT' });
    expect(f.store.sequence).toBe(before);
    expect(read).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('M12 aggregate input budgets before backend dispatch', () => {
  it.each(['JAVASCRIPT', 'PYTHON'] as const)('bounds many unique large %s inputs incrementally before retaining the over-budget value', async language => {
    const { executor, execute } = syntheticExecutor(language), f = fixture(executor), refs: string[] = [];
    for (let index = 0; index < 6; index++) refs.push(await f.save('x'.repeat(1024 * 1024 - 2)));
    const read = vi.spyOn(f.results, 'read');
    await expectInputLimit(f, refs, executor, execute);
    // Three 1 MiB JSON values fit; the fourth exceeds the budget once the
    // enclosing array and its commas are included. Later refs are never read.
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('rejects one maximum-size private result without dispatching or reading later refs', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    const oversized = await f.save('x'.repeat(8 * 1024 * 1024 - 2)), later = await f.save(1);
    const read = vi.spyOn(f.results, 'read');
    await expectInputLimit(f, [oversized, later], executor, execute);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('accounts for JSON escaping of text/plain before dispatch', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    const text = '\u0000'.repeat(750_000);
    expect(Buffer.byteLength(text)).toBeLessThan(INPUT_BYTES);
    expect(Buffer.byteLength(JSON.stringify([text]))).toBeGreaterThan(INPUT_BYTES);
    const ref = await f.save(text, 'text/plain');
    await expectInputLimit(f, [ref], executor, execute);
  });

  it('accepts ordinary text without applying a conservative six-times multiplier', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    const ref = await f.save('ordinary text '.repeat(100_000), 'text/plain');
    const program = await f.prepareInputs([ref]);
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'SUCCEEDED', aggregate: { inputs: 1 } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('runs an exact 4 MiB serialized input array in the real JavaScript executor', async () => {
    const f = fixture(realExecutor), value = 'x'.repeat(INPUT_BYTES - 4);
    expect(Buffer.byteLength(JSON.stringify([value]))).toBe(INPUT_BYTES);
    const ref = await f.save(value), program = await f.prepareInputs([ref], 'return {length: inputs[0].length};');
    const result = await f.programs.run(program.programId, REPLAY_OWNER, realExecutor);
    expect(result).toMatchObject({ state: 'SUCCEEDED', aggregate: { length: value.length } });
  });

  it('rejects one byte above the aggregate array budget, including framing', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    const ref = await f.save('x'.repeat(INPUT_BYTES - 3));
    await expectInputLimit(f, [ref], executor, execute);
  });

  it.each(['JAVASCRIPT', 'PYTHON'] as const)('bounds total JSON nodes across unique small %s inputs', async language => {
    const { executor, execute } = syntheticExecutor(language), f = fixture(executor);
    const value = Array.from({ length: 60_000 }, () => ({}));
    const refs = [await f.save(value), await f.save(value), await f.save(1)];
    expect(Buffer.byteLength(JSON.stringify([value, value]))).toBeLessThan(INPUT_BYTES);
    const read = vi.spyOn(f.results, 'read');
    await expectInputLimit(f, refs, executor, execute);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('includes the enclosing inputs array in the 100000-node budget', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    const ref = await f.save(Array(INPUT_NODES - 2).fill(null));
    const program = await f.prepareInputs([ref]);
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'SUCCEEDED' });
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    const extra = await f.save(0);
    await expectInputLimit(f, [ref, extra], executor, execute);
  });

  it('rejects accessors before counting or serializing a faulted host value', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor), ref = await f.save(7);
    const program = await f.prepareInputs([ref]), original = await f.results.read(REPLAY_OWNER, ref, { programId: program.programId });
    if (original.status !== 'SUCCEEDED') throw new Error('The fixture must retain a successful input');
    let accesses = 0;
    const faulted = Object.defineProperty({}, 'hidden', { enumerable: true, get: () => { accesses++; return 7; } });
    vi.spyOn(f.results, 'read').mockResolvedValueOnce({ ...original, status: 'SUCCEEDED', value: faulted });
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'FAILED', error: { code: 'INPUT_LIMIT' } });
    expect(accesses).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('includes the enclosing inputs array in the maximum depth of 64', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor);
    let value: unknown = 0;
    for (let depth = 0; depth < 63; depth++) value = [value];
    const allowed = await f.save(value), program = await f.prepareInputs([allowed]);
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'SUCCEEDED' });
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    const tooDeep = await f.save([value]);
    await expectInputLimit(f, [tooDeep], executor, execute);
  });
});

describe('M12 input budget keeps current authority checks', () => {
  it('authorizes sequential input receipts without parsing their JSON values during preparation', async () => {
    const f = fixture(), value = { source: 'M12_INPUT_PRIVATE_VALUE' }, payload = JSON.stringify(value), ref = await f.save(value);
    const parse = JSON.parse;
    let materializations = 0;
    vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?) => { if (text === payload) materializations++; return parse(text, reviver); });
    await f.prepareInputs([ref]);
    expect(materializations).toBe(0);
  });

  it('rejects an owner change during input grant validation before backend dispatch', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor), ref = await f.save(7);
    const program = await f.prepareInputs([ref]), validate = f.results.revalidateGrants.bind(f.results);
    vi.spyOn(f.results, 'revalidateGrants').mockImplementationOnce(async (...args) => {
      await validate(...args); f.setCurrentOwner({ ...REPLAY_OWNER, epoch: REPLAY_OWNER.epoch + 1 });
    });
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'FAILED', error: { code: 'RESULT_ACCESS_DENIED' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects revoked captured grants and retains the source privately', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor), path = join(f.path, 'source.txt');
    await writeFile(path, 'private input source');
    const info = await stat(path, { bigint: true });
    const grant: ResourceGrant = { id: 'input-grant', threadId: REPLAY_OWNER.threadId, kind: 'file', path, label: 'Input source',
      writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
    f.store.internal('m12.input.fixture.grant', REPLAY_OWNER.threadId, () => { f.store.put('resource', grant.id, REPLAY_OWNER.threadId, grant); });
    const grants = await f.results.captureGrants(REPLAY_OWNER, [{ resourceId: grant.id }]);
    const ref = await f.results.save({ owner: REPLAY_OWNER, programId: 'source', status: 'SUCCEEDED', value: 7, grants });
    const program = await f.prepareInputs([ref]);
    f.store.internal('m12.input.fixture.revoke', REPLAY_OWNER.threadId, () => { f.store.remove('resource', grant.id); });
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'FAILED', error: { code: 'RESULT_ACCESS_DENIED' } });
    expect(f.store.get('privateToolResult', ref)).not.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rechecks explicit program access after input admission', async () => {
    const { executor, execute } = syntheticExecutor(), f = fixture(executor), ref = await f.save(7);
    const program = await f.prepareInputs([ref]);
    f.store.internal('m12.input.fixture.revoke-access', REPLAY_OWNER.threadId, () => {
      f.store.remove('privateToolResultAccess', digest({ owner: REPLAY_OWNER, resultRef: ref, programId: program.programId }));
    });
    expect(await f.programs.run(program.programId, REPLAY_OWNER, executor)).toMatchObject({ state: 'FAILED', error: { code: 'RESULT_ACCESS_DENIED' } });
    expect(execute).not.toHaveBeenCalled();
  });
});
