import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import type { ResourceGrant, StartRun, RuntimeAdapter, RuntimeCallbacks } from '../packages/contracts';
import type { NativeCompactionReceiptV1 } from '../packages/contracts/native-compaction.ts';
import { Service } from '../packages/core/service';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import { withApprovedProjectContext } from '../packages/core/approved-project-context';

const cleanup: Array<() => void> = [];
afterEach(() => {
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
  for (const close of cleanup.splice(0)) close();
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'm04-instruction-custody-')), project = join(directory, 'project'); mkdirSync(project);
  const store = new Store(join(directory, 'profile')), path = join(project, 'AGENTS.md'); writeFileSync(path, 'Keep selected source evidence.\n');
  const info = statSync(project, { bigint: true });
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: project, label: 'Project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  const input: StartRun = { threadId: 'thread', runId: 'run', epoch: 1, modelId: 'test/model', accountId: null, prompt: 'Read the project', inputId: 'input', sessionPath: null, resources: [grant] };
  store.internal('fixture', 'thread', () => {
    store.put('thread', 'thread', 'thread', { id: 'thread', title: 'Fixture', status: 'working', ...input });
    store.put('resource', grant.id, grant.threadId, grant);
  });
  cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  return { store, path, grant, input };
}

it.skipIf(process.platform !== 'win32')('holds the actual native file guard until instruction admission finishes', async () => {
  const f = fixture();
  await withApprovedProjectContext(f.store, f.input, new AbortController().signal, async (context, assertCurrent) => {
    expect(context?.instructionText).toContain('Keep selected source evidence.');
    expect(context?.instructions.entries).toHaveLength(1);
    await expect(writeFile(f.path, 'Changed while native request is being admitted')).rejects.toBeDefined();
    assertCurrent();
  });
  await expect(writeFile(f.path, 'Changed after admission')).resolves.toBeUndefined();
});

it.skipIf(process.platform !== 'win32')('rejects revoked source custody before dispatch under actual native file protection', async () => {
  const f = fixture();
  await expect(withApprovedProjectContext(f.store, f.input, new AbortController().signal, async (_context, assertCurrent) => {
    f.store.internal('fixture', 'thread', () => f.store.remove('resource', f.grant.id));
    assertCurrent();
  })).rejects.toMatchObject({ code: 'STALE_REQUEST_CONTEXT' });
});

it.skipIf(process.platform === 'win32')('reports unavailable native file custody without silently reading project instructions', async () => {
  const f = fixture();
  await withApprovedProjectContext(f.store, f.input, new AbortController().signal, async context => {
    expect(context?.instructionText).toBe('');
    expect(context?.instructions.entries).toEqual([]);
    expect(context?.instructions.exclusions).toContainEqual({ filename: 'AGENTS.md', resourceId: 'project', reason: 'UNAVAILABLE_CUSTODY' });
  });
});

it.skipIf(process.platform !== 'win32')('retains actual read-only selected-file custody before and after the private Service commit', async () => {
  const f = fixture(); let callbacks!: RuntimeCallbacks, commits = 0;
  const runtime: RuntimeAdapter = {
    configure: value => {callbacks = value;}, models: async () => [{id: 'test/model', name: 'Fixture', provider: 'test'}],
    start: async input => {
      callbacks.onEvent({...input, type: 'input.processing', inputIds: [input.inputId]});
      callbacks.onEvent({...input, type: 'assistant.message', content: 'Selected source admitted.', inputIds: [input.inputId]});
      callbacks.onEvent({...input, type: 'settled', aborted: false});
    },
    followUp: async () => {}, cancel: async () => {}, history: async () => [], dispose: async () => {},
    compact: async () => {throw new Error('Legacy compaction is not protected.');},
    nativeHistoryDigest: async () => ({sha256: 'd'.repeat(64), messages: [
      {role: 'user', content: 'Keep source evidence.'}, {role: 'assistant', content: 'Completed investigation. '.repeat(600)},
      {role: 'user', content: 'Current task.'}, {role: 'assistant', content: 'Recent response.'}]}),
    compactProtected: async (ctx, _path, _model, _account, envelope) => {
      await expect(writeFile(f.path, 'Edit while the protected summary is prepared.')).rejects.toBeDefined();
      expect(callbacks.onCompactionCommit!({version: 1, candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest,
        sourceSha256: envelope.plan.sourceSha256, owner: structuredClone(envelope.plan.owner)})).toEqual({version: 1, accepted: true, planDigest: envelope.planDigest});
      commits++;
      await expect(writeFile(f.path, 'Edit after admission before native application returns.')).rejects.toBeDefined();
      callbacks.onEvent({...ctx, type: 'compaction.end', reason: 'manual', aborted: false});
      callbacks.onEvent({...ctx, type: 'settled', aborted: false});
      return {version: 1, candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest, sourceSha256: envelope.plan.sourceSha256,
        status: 'APPLIED', archiveRef: 'native-archive:' + envelope.plan.sourceSha256, archiveSha256: envelope.plan.sourceSha256,
        retainedBytes: 4096, protectedRecords: envelope.plan.retainedIndices.length, referenceCount: envelope.plan.references.length, toolPairs: 0,
        beforeBytes: 20000, afterBytes: 8192, summarySha256: 'f'.repeat(64), reason: null} satisfies NativeCompactionReceiptV1;
    },
  };
  const service = new Service(f.store, runtime, {requestContextEnabled: true});
  try {
    f.store.internal('fixture.ready', 'thread', () => f.store.put('thread', 'thread', 'thread',
      {...service.thread('thread'), status: 'ready', runId: null, sessionPath: '/synthetic-native-session'}));
    __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
    const logicalOwner = service.sourceWorkbench.owner('thread');
    const descriptor = await service.sourceWorkbench.describe({logicalOwner, locator: {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'AGENTS.md'}});
    const captured = await service.sourceWorkbench.capture({commandId: 'capture-native-file', source: {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'AGENTS.md',
      logicalOwner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: '2026-01-01T00:00:00.000Z',
      range: {encoding: 'LINES_1_BASED', startLine: 1, endLine: 1}}});
    f.store.internal('fixture.input', 'thread', () => f.store.put('outbox', 'selected-file', 'thread',
      {id: 'selected-file', threadId: 'thread', content: 'Use this source.', status: 'persisted', runId: null, sourceRefs: [captured.ref]}));
    await service.deliverOutbox('thread');
    expect(f.store.get('outbox', 'selected-file')).toMatchObject({enteredRuntime: true, status: 'handled'});
    __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
    await service.command({id: 'compact-actual-source-guard', type: 'run.compact', threadId: 'thread', payload: {}});
    expect(commits).toBe(1);
    expect(f.store.all('compactionUsage', 'thread')).toEqual([expect.objectContaining({nativeReceipt: expect.objectContaining({status: 'APPLIED'})})]);
    await expect(writeFile(f.path, 'Edit after native operation released custody.')).resolves.toBeUndefined();
  } finally {await service.dispose();}
}, 60_000);
