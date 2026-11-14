import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { createOfficialRuntime } from '../packages/runtime-official/index.ts';
import { openManifest, readManifest, saveManifest } from '../packages/runtime-official/manifest.ts';
import type { HistoryReceipt } from '../packages/runtime-official/internal.ts';

vi.mock('node:child_process', async original => ({ ...await original<typeof import('node:child_process')>(), spawn: vi.fn() }));
const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'official-history-owner-')); directories.push(dataDir);
  const manifest = await openManifest(dataDir, 'claude-code', 'thread', null);
  manifest.value.sessionId = 'native-session';
  manifest.value.inputs['wire'] = { inputIds: ['input'], runId: 'run', epoch: 1, observed: false };
  await saveManifest(manifest);
  return { dataDir, manifest };
}
function child() {
  const value = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null as number | null, signalCode: null, pid: undefined });
  return Object.assign(value, { finish() { if (value.exitCode !== null) return; value.exitCode = 0; value.stdout.end('[]'); value.emit('exit', 0, null); setImmediate(() => value.emit('close', 0, null)); } });
}

it('waits for a deferred Claude history read on disposal and refuses its late manifest mutation', async () => {
  const f = await fixture(), barrier = deferred<HistoryReceipt[]>(), read = vi.fn(() => barrier.promise);
  const runtime = createOfficialRuntime({ dataDir: f.dataDir }, { claudeHistory: read });
  const history = runtime.history(f.manifest.path).catch(error => error);
  let disposed = false;
  try {
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    const closing = runtime.dispose().then(() => { disposed = true; });
    await new Promise(done => setImmediate(done));
    expect(disposed).toBe(false);
    barrier.resolve([{ uuid: 'wire', inputIds: ['input'] }]);
    await closing;
    expect(await history).toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
    expect((await readManifest(f.dataDir, f.manifest.path)).value.inputs.wire.observed).toBe(false);
  } finally { barrier.resolve([]); await history; await runtime.dispose(); }
});

it('does not start a native history helper after disposal races the manifest read', async () => {
  const f = await fixture(), read = vi.fn(async () => [{ uuid: 'wire', inputIds: ['input'] }]);
  const runtime = createOfficialRuntime({ dataDir: f.dataDir }, { claudeHistory: read });
  const history = runtime.history(f.manifest.path).catch(error => error);
  await runtime.dispose();
  expect(await history).toMatchObject({ code: expect.stringMatching(/^OFFICIAL_(?:DISPOSED|RUN_ABORTED)$/) });
  expect(read).not.toHaveBeenCalled();
  expect((await readManifest(f.dataDir, f.manifest.path)).value.inputs.wire.observed).toBe(false);
});

it('routes the real Claude history helper through the owned spawn and waits for its completion', async () => {
  const f = await fixture(), unowned = child(), owned = child();
  vi.mocked(spawn).mockReturnValue(unowned as unknown as ReturnType<typeof spawn>);
  const spawnOwned = vi.fn(() => owned as unknown as ReturnType<typeof spawn>);
  const runtime = createOfficialRuntime({ dataDir: f.dataDir }, { spawn: spawnOwned as typeof spawn });
  const history = runtime.history(f.manifest.path).catch(error => error);
  try {
    await vi.waitFor(() => expect(spawnOwned).toHaveBeenCalledOnce());
    expect(spawn).not.toHaveBeenCalled();
    let disposed = false;
    const closing = runtime.dispose().then(() => { disposed = true; });
    await new Promise(done => setImmediate(done)); expect(disposed).toBe(false);
    owned.finish(); await closing;
    expect(await history).toMatchObject({ code: 'OFFICIAL_RUN_ABORTED' });
  } finally { unowned.finish(); owned.finish(); await history; await runtime.dispose(); }
});
