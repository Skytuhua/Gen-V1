import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Service } from '../packages/core/service';
import { Store } from '../packages/storage/store';
import { __setCapabilityFlagForTests } from '../packages/core/capability-flags';
import type { ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun } from '../packages/contracts';
import type { NativeCompactionEnvelopeV1, NativeCompactionReceiptV1 } from '../packages/contracts/native-compaction.ts';
import type { SourceRefV1 } from '../packages/contracts/source-selection.ts';
const custody = vi.hoisted(() => ({ active: 0, readOnly: 0 }));

// Portable composition regression. Real native custody has its own Windows
// cases; this replacement supplies no extra paths and retains resolveGrant.
vi.mock('../packages/core/file-access.ts', async original => {
  const module = await original<typeof import('../packages/core/file-access.ts')>();
  return { ...module, withResourceGrant: async <T>(grant: ResourceGrant, dataDir: string, relative: string | undefined, write: boolean, signal: AbortSignal, action: (path: string) => Promise<T>, options?: {readOnly?: boolean}) => {
    if (signal.aborted) throw new Error('Cancelled');
    const { resolveGrant } = await import('../packages/core/security.ts');
    const path = await resolveGrant(grant, relative, write, dataDir);
    custody.active++; if (options?.readOnly) custody.readOnly++;
    try { return await action(path); } finally { custody.active--; if (options?.readOnly) custody.readOnly--; }
  } };
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  __setCapabilityFlagForTests('context.compilerV1', undefined);
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', undefined);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);
  for (const close of cleanup.splice(0)) await close();
});
const protectionReceipt = (envelope: NativeCompactionEnvelopeV1): NativeCompactionReceiptV1 => ({version: 1,
  candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest, sourceSha256: envelope.plan.sourceSha256, status: 'APPLIED',
  archiveRef: 'native-archive:' + envelope.plan.sourceSha256, archiveSha256: envelope.plan.sourceSha256, summarySha256: 'f'.repeat(64), reason: null,
  retainedBytes: 4096, protectedRecords: envelope.plan.retainedIndices.length, referenceCount: envelope.plan.references.length, toolPairs: 0,
  beforeBytes: 20000, afterBytes: 8192});
function fixture(files: Record<string, string>, finalize?: (store: Store, grant: ResourceGrant) => void, requestContextEnabled = true) {
  const directory = mkdtempSync(join(tmpdir(), 'm04-instructions-')), root = join(directory, 'project'), store = new Store(join(directory, 'profile'));
  mkdirSync(root);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  const info = statSync(root, { bigint: true });
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: root, label: 'Approved project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  const starts: StartRun[] = [];
  let callbacks!: RuntimeCallbacks;
  const compactionCustody: number[] = [], compactionReadOnlyCustody: number[] = [];
  const runtime: RuntimeAdapter = { configure: value => { callbacks = value; }, models: async () => [{ id: 'test/model', name: 'Fixture', provider: 'test' }],
    start: async input => { if (input.approvedProjectContext?.instructions.entries.length) expect(custody.active).toBeGreaterThan(0); starts.push(input); }, followUp: async input => { starts.push(input); }, cancel: async () => {},
    compact: async () => { throw new Error('Loss-aware compaction reached the legacy path.'); },
    compactProtected: async (ctx, _path, _model, _account, envelope) => {
      compactionCustody.push(custody.active); compactionReadOnlyCustody.push(custody.readOnly);
      callbacks.onEvent({...ctx, type: 'compaction.start', reason: 'manual'});
      callbacks.onCompactionCommit!({version: 1, candidateId: envelope.plan.candidateId, planDigest: envelope.planDigest,
        sourceSha256: envelope.plan.sourceSha256, owner: structuredClone(envelope.plan.owner)});
      callbacks.onEvent({...ctx, type: 'compaction.end', reason: 'manual', aborted: false});
      callbacks.onEvent({...ctx, type: 'settled', aborted: false});
      return protectionReceipt(envelope);
    },
    nativeHistoryDigest: async () => ({sha256: 'd'.repeat(64), messages: [{role: 'user', content: 'Owned native fixture history'},
      {role: 'assistant', content: 'Completed investigation. '.repeat(600)}, {role: 'user', content: 'Current request'}, {role: 'assistant', content: 'Recent response'}]}),
    history: async () => [], dispose: async () => {} };
  const service = new Service(store, runtime, { requestContextEnabled, requestContextHooks: { finalize: () => { finalize?.(store, grant); return { sources: [] }; } } });
  // This file explicitly substitutes bounded portable leaf custody above.
  // Admit FILE_RANGE only for that fixture; retain every original source,
  // capture, owner and grant check. Real platform admission stays in the
  // separate Windows custody suite, which uses no such substitution.
  const captureKind = Reflect.get(service.sourceWorkbench, 'captureKind') as (kind: string) => void;
  vi.spyOn(service.sourceWorkbench as unknown as {captureKind: (kind: string) => void}, 'captureKind')
    .mockImplementation(kind => { if (kind !== 'FILE_RANGE') captureKind.call(service.sourceWorkbench, kind); });
  cleanup.push(async () => { await service.dispose(); store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  store.internal('fixture', 'thread', () => {
    store.put('thread', 'thread', 'thread', { id: 'thread', title: 'Fixture', status: 'ready', modelId: 'test/model', runId: null, epoch: 0, sessionPath: '/synthetic-native-session', projectName: null });
    store.put('resource', grant.id, grant.threadId, grant);
    store.put('outbox', 'input', 'thread', { id: 'input', threadId: 'thread', content: 'Inspect the approved project', status: 'persisted', runId: null });
  });
  const deliver = () => (Reflect.get(service, 'deliverOutbox') as (id: string) => Promise<void>).call(service, 'thread');
  const settle = () => { const input = starts.at(-1)!; callbacks.onEvent({ ...input, type: 'input.processing', inputIds: [input.inputId] }); callbacks.onEvent({ ...input, type: 'assistant.message', content: 'Fixture turn completed', inputIds: [input.inputId] }); callbacks.onEvent({ ...input, type: 'settled', aborted: false }); };
  return { service, store, grant, starts, deliver, root, directory, settle, compactionCustody, compactionReadOnlyCustody, runtime };
}

it('admits recognized project instructions into native input and an exact metadata receipt', async () => {
  const f = fixture({ 'AGENTS.md': 'Keep the API stable.\n', 'CLAUDE.md': 'Use the project test command.\n', '.env': 'UNAPPROVED_SECRET_SENTINEL' });
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.deliver();
  expect(f.starts).toHaveLength(1);
  const input = f.starts[0]!, context = input.approvedProjectContext;
  expect(context?.instructionText).toContain('Keep the API stable.');
  expect(context?.instructionText).toContain('Use the project test command.');
  expect(context?.instructionText).not.toContain('UNAPPROVED_SECRET_SENTINEL');
  expect(input.prompt).not.toContain('Keep the API stable.');
  expect(context?.instructions.entries.map(entry => entry.filename)).toEqual(['AGENTS.md', 'CLAUDE.md']);
  expect(context?.instructions.overlaps).toHaveLength(1);
  expect(context?.instructions.precedence).toContain('AGENTS.md, CLAUDE.md, GEMINI.md');
  expect(input.requestContext?.segments).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'INSTRUCTION', sourceId: 'approved-project-instructions', utf8Bytes: Buffer.byteLength(context!.instructionText) })]));
  const receipts = f.store.all('requestContextReceipt', 'thread');
  expect(JSON.stringify(receipts)).not.toContain('Keep the API stable.');
  expect(custody.active).toBe(0);
});

it('does not discover instructions when the host compiler capability is disabled', async () => {
  const f = fixture({ 'AGENTS.md': 'Do not load while disabled.' });
  await f.deliver();
  expect(f.starts).toHaveLength(1);
  expect(f.starts[0]?.approvedProjectContext).toBeUndefined();
});

it('refuses instructions through a grant revoked while the request is being finalized', async () => {
  const f = fixture({ 'AGENTS.md': 'A revoked source cannot enter the native request.' }, (store, grant) => {
    store.internal('fixture', grant.threadId, () => store.remove('resource', grant.id));
  });
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.deliver();
  expect(f.starts).toHaveLength(0);
});

it('loads each physical instruction once when explicit roots alias it', async () => {
  const f = fixture({ 'AGENTS.md': 'ONE_PHYSICAL_SOURCE' });
  f.store.internal('fixture', 'thread', () => f.store.put('resource', 'same-root', 'thread', { ...f.grant, id: 'same-root' }));
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.deliver();
  const context = f.starts[0]?.approvedProjectContext;
  expect(context?.instructions.entries).toHaveLength(1);
  expect(context?.instructions.duplicates).toHaveLength(1);
  expect(context?.instructionText.match(/ONE_PHYSICAL_SOURCE/g)).toHaveLength(1);
});

it('refuses outside symlinks and executable includes without opening their target content', async () => {
  const f = fixture({ 'CLAUDE.md': '!include ../outside.md\n', 'GEMINI.md': 'post_edit_hook: execute-outside\n' });
  const outside = join(f.directory, 'outside.md'); writeFileSync(outside, 'OUTSIDE_CONTENT_SENTINEL');
  symlinkSync(outside, join(f.root, 'AGENTS.md'), 'file');
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.deliver();
  const context = f.starts[0]?.approvedProjectContext;
  expect(context?.instructionText).toBe('');
  expect(context?.instructions.entries).toHaveLength(0);
  expect(context?.instructions.exclusions).toEqual(expect.arrayContaining([
    expect.objectContaining({ filename: 'AGENTS.md', reason: 'DENIED_SOURCE' }),
    expect.objectContaining({ filename: 'CLAUDE.md', reason: 'UNSUPPORTED_DIRECTIVE' }),
    expect.objectContaining({ filename: 'GEMINI.md', reason: 'UNSUPPORTED_DIRECTIVE' }),
  ]));
  expect(JSON.stringify(context)).not.toContain('OUTSIDE_CONTENT_SENTINEL');
});

it('bounds included instruction bytes and reports excluded oversized sources', async () => {
  const f = fixture({ 'AGENTS.md': 'a'.repeat(32 * 1024), 'CLAUDE.md': 'b'.repeat(32 * 1024), 'GEMINI.md': 'c'.repeat(65537) });
  __setCapabilityFlagForTests('context.compilerV1', true);
  await f.deliver();
  const context = f.starts[0]?.approvedProjectContext;
  expect(context?.instructionText).toBeDefined();
  expect(Buffer.byteLength(context!.instructionText)).toBeLessThanOrEqual(65536);
  expect(context?.instructions.exclusions).toEqual(expect.arrayContaining([
    expect.objectContaining({ filename: 'CLAUDE.md', reason: 'BYTE_BUDGET' }),
    expect.objectContaining({ filename: 'GEMINI.md', reason: 'SOURCE_TOO_LARGE' }),
  ]));
});

it('refuses native compaction when admitted instruction bytes changed since the last request', async () => {
  const f = fixture({ 'AGENTS.md': 'The original project requirement.' });
  __setCapabilityFlagForTests('context.compilerV1', true);
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await f.deliver(); f.settle();
  writeFileSync(join(f.root, 'AGENTS.md'), 'A newer project requirement.');
  await expect(f.service.command({ id: 'compact-changed', type: 'run.compact', threadId: 'thread', payload: {} })).rejects.toMatchObject({ code: 'COMPACTION_FAILED' });
  expect(f.compactionCustody).toEqual([]);
});

it('holds unchanged instruction custody through native compaction admission', async () => {
  const f = fixture({ 'AGENTS.md': 'Keep the original project requirement.' });
  __setCapabilityFlagForTests('context.compilerV1', true);
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await f.deliver(); f.settle();
  await f.service.command({ id: 'compact-current', type: 'run.compact', threadId: 'thread', payload: {} });
  expect(f.compactionCustody).toHaveLength(1);
  expect(f.compactionCustody[0]).toBeGreaterThan(0);
});

it('does not discover new instructions during compaction when instruction admission is disabled', async () => {
  const f = fixture({ 'AGENTS.md': 'Not admitted to the native turn.' });
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await f.deliver(); f.settle();
  await f.service.command({ id: 'compact-without-instructions', type: 'run.compact', threadId: 'thread', payload: {} });
  expect(f.starts[0]?.approvedProjectContext).toBeUndefined();
  expect(f.compactionCustody).toEqual([0]);
});

it.each([
  ['model', { modelId: 'test/changed' }], ['workspace', { workspaceId: 'changed-workspace' }],
  ['reasoning', { thinkingLevel: 'high' }], ['mode', { mode: 'plan' }], ['epoch', { epoch: 9 }],
])('refuses a changed %s owner at final instruction admission even without draft custody', async (_label, patch) => {
  const f = fixture({ 'AGENTS.md': 'A source admitted to one complete owner.' }, undefined, false);
  __setCapabilityFlagForTests('context.compilerV1', true);
  const unsubscribe = f.store.subscribe(event => {
    if (event.type !== 'runtime.context.host') return;
    f.store.internal('fixture.owner.changed', 'thread', () => f.store.put('thread', 'thread', 'thread', { ...f.store.get<Record<string, unknown>>('thread', 'thread'), ...patch }));
  });
  try { await f.deliver(); expect(f.starts).toHaveLength(0); } finally { unsubscribe(); }
});

it('reads only the exact recognized instruction when a single file was explicitly granted', async () => {
  const f = fixture({ 'AGENTS.md': 'Explicit file instructions.', 'CLAUDE.md': 'UNGRANTED_NEIGHBOR' });
  const path = join(f.root, 'AGENTS.md'), info = statSync(path, { bigint: true });
  f.store.internal('fixture', 'thread', () => f.store.put('resource', f.grant.id, 'thread', { ...f.grant, kind: 'file', path, identity: { dev: String(info.dev), ino: String(info.ino) } }));
  __setCapabilityFlagForTests('context.compilerV1', true); await f.deliver();
  expect(f.starts[0]?.approvedProjectContext?.instructions.entries).toHaveLength(1);
  expect(f.starts[0]?.approvedProjectContext?.instructions.exclusions).toEqual([]);
  expect(f.starts[0]?.approvedProjectContext?.instructionText).not.toContain('UNGRANTED_NEIGHBOR');
});

async function deliverFileCapture(f: ReturnType<typeof fixture>, keepCaptured = false): Promise<SourceRefV1> {
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  const logicalOwner = f.service.sourceWorkbench.owner('thread');
  const descriptor = await f.service.sourceWorkbench.describe({logicalOwner, locator: {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'source.txt'}});
  const captured = await f.service.sourceWorkbench.capture({commandId: 'capture-file', source: {kind: 'FILE_RANGE', sourceId: f.grant.id, path: 'source.txt',
    logicalOwner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: '2026-01-01T00:00:00.000Z',
    range: {encoding: 'LINES_1_BASED', startLine: 1, endLine: 1}}});
  const ref = {...captured.ref, keepCaptured};
  f.store.internal('queue.source', 'thread', () => f.store.put('outbox', 'selected-file', 'thread', {id: 'selected-file', threadId: 'thread',
    content: 'Use this selected source.', status: 'persisted', runId: null, sourceRefs: [ref]}));
  await f.deliver(); f.settle();
  expect(f.starts.at(-1)?.sourceRefs).toEqual([ref]);
  return ref;
}

it('holds explicit read-only file source custody across the protected native operation', async () => {
  const f = fixture({'source.txt': 'Captured source evidence.'});
  await f.deliver(); f.settle(); await deliverFileCapture(f);
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await f.service.command({id: 'compact-source-custody', type: 'run.compact', threadId: 'thread', payload: {}});
  expect(f.compactionReadOnlyCustody).toEqual([1]);
  expect(custody.active).toBe(0); expect(custody.readOnly).toBe(0);
});

it('rechecks physical file content at the private commit even when a portable custody mock permits an edit', async () => {
  const f = fixture({'source.txt': 'Captured source evidence.'});
  await f.deliver(); f.settle(); await deliverFileCapture(f);
  const compact = f.runtime.compactProtected!;
  f.runtime.compactProtected = async (...args) => {writeFileSync(join(f.root, 'source.txt'), 'An externally changed source revision.'); return compact(...args);};
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await expect(f.service.command({id: 'compact-source-changed', type: 'run.compact', threadId: 'thread', payload: {}})).rejects.toMatchObject({code: 'COMPACTION_FAILED'});
  expect(f.store.all('compactionUsage', 'thread')).toEqual([]);
});

it('preserves an explicitly retained captured file revision without reading a newer revision at commit', async () => {
  const f = fixture({'source.txt': 'Captured source evidence.'});
  await f.deliver(); f.settle(); const ref = await deliverFileCapture(f, true);
  writeFileSync(join(f.root, 'source.txt'), 'A later version does not replace the retained evidence.');
  __setCapabilityFlagForTests('context.lossAwareCompactionV1', true);
  await f.service.command({id: 'compact-kept-source', type: 'run.compact', threadId: 'thread', payload: {}});
  expect(f.compactionReadOnlyCustody).toEqual([0]);
  const proof = f.store.all<{nativeReceipt: NativeCompactionReceiptV1}>('compactionUsage', 'thread')[0].nativeReceipt;
  expect(proof.status).toBe('APPLIED');
  const record = f.store.get<{source: SourceRefV1['source']}>('sourceCapture', ref.captureId)!;
  expect(record.source.sourceRevision).toBe(ref.source.sourceRevision);
});
