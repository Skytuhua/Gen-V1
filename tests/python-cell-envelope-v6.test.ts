import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { HarnessError, type RuntimeAdapter, type Thread } from '../packages/contracts/index.ts';
import type { ProgramExecutor, PythonKernelIdentity } from '../packages/contracts/tool-program.ts';
import type { ToolOwner } from '../packages/contracts/tool-effects.ts';
import type { ToolProgramResult } from '../packages/core/tool-programs.ts';
import { testEffectAuthenticator } from './fixtures/effect-authenticator.ts';

// The model-visible python_cell reply is measured and bounded as the complete
// final envelope, including the host's kernelId and generation. A synthetic
// contract executor is used; no interpreter is launched.
type CellReply = ToolProgramResult & { kernelId: string; generation: number };
const hash = 'a'.repeat(64);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(execute: ProgramExecutor['execute']) {
  const dir = await mkdtemp(join(tmpdir(), 'm12-python-envelope-')), store = new Store(join(dir, 'state'));
  const executor = (): ProgramExecutor => ({ proof: { backendId: 'core-only', language: 'PYTHON', runtimeFingerprint: hash, platform: 'synthetic',
    isolation: 'M03_CONFINED_PROCESS', memoryScope: 'SYNTHETIC_CONTRACT', hardMemoryLimit: true, memoryLimitBytes: 134_217_728,
    wholeExecutorMemoryLimitBytes: null, tested: true, evidenceRef: 'synthetic python_cell envelope fixture' }, execute, stop: async () => {} });
  const python = { async configure(owner: ToolOwner, toolRegistryDigest: string) {
    const identity: PythonKernelIdentity = { owner, interpreterDigest: hash, configurationDigest: hash, cwdIdentity: 'synthetic-cwd', toolRegistryDigest, executionProfileDigest: hash };
    return { identity, factory: executor };
  } };
  const runtime: RuntimeAdapter = { configure() {}, models: async () => [], start: async () => {}, followUp: async () => {}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { toolEffectFlags: { 'audit.effectsV1': true, 'security.authorityV1': true },
    toolEffectAuthenticator: testEffectAuthenticator(), toolPrograms: { flags: { 'tools.pythonKernelV1': true }, python } });
  const thread: Thread = { id: 'thread', title: 'Python envelope', projectName: null, status: 'working', epoch: 1, runId: 'run', modelId: null,
    accountId: 'account', projectId: 'project', workspaceId: 'workspace', sessionPath: null, createdAt: '', updatedAt: '' };
  store.internal('fixture', thread.id, () => { store.put('thread', thread.id, thread.id, thread); });
  cleanups.push(async () => { await service.dispose(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const cell = async (commandId: string, extra: Record<string, unknown> = {}) => await service.tool({ name: 'python_cell',
    args: { commandId, source: 'result = 1', allowedTools: [], requestedAggregate: 'Return the fixture aggregate', ...extra } },
    { threadId: thread.id, runId: 'run', epoch: 1 }) as CellReply;
  return { cell };
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

it('reports the exact byte length of the complete python_cell reply including kernel metadata', async () => {
  const f = await fixture(async () => ({ total: 6, rows: [1, 2, 3] }));
  const first = await f.cell('exact-1');
  expect(first).toMatchObject({ state: 'SUCCEEDED', aggregate: { total: 6, rows: [1, 2, 3] }, generation: 1 });
  expect(typeof first.kernelId).toBe('string');
  expect(first.usage.visibleBytes).toBe(bytes(first));
  const second = await f.cell('exact-2', { kernelId: first.kernelId });
  expect(second.kernelId).toBe(first.kernelId);
  expect(second.usage.visibleBytes).toBe(bytes(second));
});

it('keeps a failure reply within the lowest output cap after kernel metadata is attached', async () => {
  const maxOutputBytes = 2048;
  const f = await fixture(async () => { throw new HarnessError('PROGRAM_SYNTHETIC_FAILURE', 'x'.repeat(1800)); });
  const reply = await f.cell('low-limit', { limits: { maxOutputBytes } });
  expect(reply.state).toBe('FAILED');
  expect(reply.error?.code).toBe('PROGRAM_SYNTHETIC_FAILURE');
  expect(reply).toMatchObject({ generation: 1 });
  expect(typeof reply.kernelId).toBe('string');
  expect(bytes(reply)).toBeLessThanOrEqual(maxOutputBytes);
  expect(reply.usage.visibleBytes).toBe(bytes(reply));
  // Only the message was shortened to fit; the code and metadata are intact.
  expect(reply.error!.message.length).toBeLessThan(1800);
  expect(reply.error!.message).toMatch(/^x+$/);
});
