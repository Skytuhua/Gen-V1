import { afterEach, expect, it, vi } from 'vitest';
import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HarnessError, type Operation, type RuntimeAdapter, type StartRun, type Thread } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';
import { Service } from '../packages/core/service.ts';
import { Store } from '../packages/storage/store.ts';
import { ProjectTrustLedger } from '../packages/core/project-trust.ts';
import { operationProjectTrustReviewSchema, operationProjectTrustReceiptSchema, operationProjectTrustStatusSchema } from '../packages/contracts/operation-project-trust.ts';
import * as domain from '../packages/capabilities/index.ts';

// Only native path leases are replaced. Store, public Service commands, owning
// runs, grant resolution, exact byte binding and the owned Node child are real.
// This is host trust/admission evidence, not native confinement acceptance.
const seam = vi.hoisted(() => ({ beforeGuard: undefined as undefined | (() => Promise<void>), launches: 0 }));
vi.mock('../packages/core/file-access.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/core/file-access.ts')>();
  const lease: typeof actual.withPathGuard = async (_paths, signal, action) => {
    await seam.beforeGuard?.();
    if (signal.aborted) throw new HarnessError('CANCELLED', 'Owned fixture cancelled');
    return action([]);
  };
  return { ...actual, withPathGuard: lease,
    withResourceGrant: async (grant, dataDir, path, write, signal, action) => {
      const target = await resolveGrant(grant, path, write, dataDir);
      return lease([{ path: target, leaf: !write }], signal, async () => {
        if (await resolveGrant(grant, path, write, dataDir) !== target) throw new HarnessError('CAPABILITY_DENIED', 'Owned grant changed');
        return action(target);
      });
    },
  } satisfies typeof actual;
});
vi.mock('../packages/capabilities/process.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../packages/capabilities/process.ts')>();
  return { ...actual, runProcess: (...args: Parameters<typeof actual.runProcess>) => {
    seam.launches++; return actual.runProcess(...args);
  } };
});
const realNode = process.execPath, cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  seam.beforeGuard = undefined;
  for (const run of cleanup.splice(0).reverse()) await run();
  process.execPath = realNode; seam.launches = 0; vi.unstubAllEnvs(); vi.restoreAllMocks();
});

async function fixture(enabled = true) {
  vi.stubEnv('HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1', enabled ? '1' : '0');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'm03 operation trust '))), project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'owned.test.cjs'), "require('node:test')('owned effect', () => require('node:fs').appendFileSync('effect.log', 'x'));\n");
  const executable = join(root, process.platform === 'win32' ? 'owned-node.exe' : 'owned-node');
  await copyFile(realNode, executable, constants.COPYFILE_FICLONE); process.execPath = executable;
  let store = new Store(join(root, 'state'));
  const starts: StartRun[] = [];
  const runtime: RuntimeAdapter = {
    configure: () => {}, models: async () => [{ id: 'test/model', provider: 'test', name: 'Owned trust fixture' }],
    start: async input => { starts.push(input); }, followUp: async () => {}, cancel: async () => {},
    compact: async () => {}, history: async () => [], dispose: async () => {},
  };
  let service = new Service(store, runtime);
  cleanup.push(async () => { await service.dispose(); store.close(); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const command = (type: string, threadId?: string, payload: Record<string, unknown> = {}) =>
    service.command({ id: randomUUID(), type, threadId, payload });
  const thread = (await command('thread.create')).result as Thread;
  const grant = (await command('resource.grant', thread.id, { path: project, kind: 'project', writable: true })).result as { id: string };
  await command('message.send', thread.id, { content: 'Prepare the owned repository test', modelId: 'test/model' });
  await service.deliverOutbox(thread.id);
  const run = starts[0];
  const operation = await service.tool({ name: 'repository_test_prepare', args: { resourceId: grant.id, testFile: 'owned.test.cjs' } }, run) as Operation;
  const target = { threadId: thread.id, operationId: operation.id, operationRevision: operation.revision };
  const approve = () => command('operation.approve', thread.id, { operationId: operation.id, revision: operation.revision });
  const reopen = async (trustEnabled = enabled) => {
    await service.dispose(); store.close(); store = new Store(join(root, 'state'));
    vi.stubEnv('HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1', trustEnabled ? '1' : '0');
    service = new Service(store, runtime); await service.recover();
  };
  return { root, project, get store() { return store; }, get service() { return service; }, thread, operation, target, approve, reopen };
}

it.each([true, false])('enforces explicit project trust at the real approval boundary (enabled=%s)', async enabled => {
  const f = await fixture(enabled);
  const outcome = await f.approve().then(() => ({ status: 'approved' }), error => ({ status: 'denied', code: error.code }));
  if (outcome.status === 'approved') {
    await f.service.dispatchOperation(f.operation.id);
    expect(f.store.get<Operation>('operation', f.operation.id)?.status).toBe('succeeded');
    expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
  }
  expect(outcome).toEqual(enabled ? { status: 'denied', code: 'PROJECT_TRUST_REQUIRED' } : { status: 'approved' });
  expect(seam.launches).toBe(enabled ? 0 : 1);
  if (!enabled) expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
});

async function reviewed(f: Awaited<ReturnType<typeof fixture>>) {
  const view = operationProjectTrustReviewSchema.parse(await f.service.projectTrust.preview(f.target));
  if (!view.enabled) throw new Error('The owned test requires project trust enabled');
  return { view, decision: { ...f.target, reviewId: view.reviewId, expectedTrustRevision: view.current.revision,
    decision: 'trusted' as const, executionMode: 'TRUSTED_HOST' as const } };
}

async function recordedStatus(f: Awaited<ReturnType<typeof fixture>>) {
  const host = f.service.projectTrust;
  // The original host exposes only preview. Keep that real read as the red
  // baseline: it rejects approved operations and issues review authority.
  return typeof host.status === 'function' ? host.status(f.target) : host.preview(f.target);
}

it('returns host-computed metadata, requires explicit unrestricted selection, then separate exact operation approval', async () => {
  const f = await fixture(), { view, decision } = await reviewed(f);
  expect(view.current.decision).toBe('required');
  expect(view.requestedScope).toEqual({ read: true, write: true, network: 'none' });
  expect(view.execution).toMatchObject({ mode: 'TRUSTED_HOST', label: 'Unrestricted host', filesystem: 'unrestricted', network: 'unrestricted', processes: 'unrestricted', platformProofRef: null });
  expect(view.root.canonicalPath).toBe(f.project);
  expect(view.approvedDigests[0]).toMatchObject({ path: 'owned.test.cjs', kind: 'configuration', sha256: f.operation.preconditions.testSha256 });
  await expect(f.service.projectTrust.decide({ ...decision, executionMode: undefined })).rejects.toThrow(/explicit Unrestricted host/);
  const receipt = operationProjectTrustReceiptSchema.parse(await f.service.projectTrust.decide(decision));
  expect(receipt.current).toMatchObject({ decision: 'trusted', revision: 1 });
  expect(f.store.get<Operation>('operation', f.operation.id)).toMatchObject({ approved: false, status: 'prepared' });
  expect(seam.launches).toBe(0);
  await f.approve(); await f.service.dispatchOperation(f.operation.id);
  expect(seam.launches).toBe(1); expect(await readFile(join(f.project, 'effect.log'), 'utf8')).toBe('x');
});

it('rejects altered transport metadata and keeps client mutations out of host review custody', async () => {
  const f = await fixture(), { view, decision } = await reviewed(f);
  for (const changed of [{ ...view, version: 2 }, { ...view, extra: true }, { ...view, owner: { ...view.owner, threadId: 'other-owner' } },
    { ...view, execution: { ...view.execution, label: 'Isolated' } }]) expect(operationProjectTrustReviewSchema.safeParse(changed).success).toBe(false);
  const spoofed = { ...decision, rootPath: '/model-selected-path' };
  await expect(f.service.projectTrust.decide(spoofed)).rejects.toThrow();
  view.root.canonicalPath = '/caller-mutated'; view.approvedDigests[0].sha256 = '0'.repeat(64); view.owner.epoch++;
  expect((await f.service.projectTrust.decide(decision)).current.decision).toBe('trusted');
});

it('records decline and revocation without authorizing a process', async () => {
  const f = await fixture(), first = await reviewed(f);
  expect((await f.service.projectTrust.decide({ ...first.decision, decision: 'declined', executionMode: undefined })).current.decision).toBe('declined');
  await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_REQUIRED' });
  const next = await reviewed(f), granted = await f.service.projectTrust.decide(next.decision);
  expect(granted.current.revision).toBe(2);
  const revoked = f.service.projectTrust.revoke({ ...f.target, trustId: granted.current.trustId, expectedTrustRevision: 2 });
  expect(revoked.current.decision).toBe('revoked');
  await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_REQUIRED' });
  expect(seam.launches).toBe(0);
});

it('rejects consumed, expired and stale-revision reviews', async () => {
  const f = await fixture(), first = await reviewed(f);
  await expect(f.service.projectTrust.decide({ ...first.decision, expectedTrustRevision: 1 })).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  await f.service.projectTrust.decide(first.decision);
  await expect(f.service.projectTrust.decide(first.decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  const second = await reviewed(f);
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(second.view.expiresAt) + 1);
  await expect(f.service.projectTrust.decide(second.decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  expect(seam.launches).toBe(0);
});

it('denies changed project bytes after review without publishing trust authority', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  await appendFile(join(f.project, 'owned.test.cjs'), '// changed after review\n');
  await expect(f.service.projectTrust.decide(decision)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(f.store.all('operationProjectTrust')).toEqual([]); expect(seam.launches).toBe(0);
});

it.each(['epoch', 'runId', 'accountId', 'projectId', 'workspaceId', 'status'] as const)('rechecks %s after asynchronous native acquisition', async field => {
  const f = await fixture(), { decision } = await reviewed(f);
  seam.beforeGuard = async () => {
    seam.beforeGuard = undefined; await Promise.resolve();
    const current = f.store.get<Thread>('thread', f.thread.id)!;
    const value = field === 'epoch' ? current.epoch + 1 : field === 'status' ? 'stopped' : 'changed-owner';
    f.store.internal('fixture.owner.changed', current.id, () => f.store.put('thread', current.id, current.id, { ...current, [field]: value }));
  };
  await expect(f.service.projectTrust.decide(decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  expect(f.store.all('operationProjectTrust')).toEqual([]); expect(seam.launches).toBe(0);
});

it('does not turn a persisted decision into admission after its awaited owner changes', async () => {
  const f = await fixture(), { decision } = await reviewed(f), decide = ProjectTrustLedger.prototype.decide;
  vi.spyOn(ProjectTrustLedger.prototype, 'decide').mockImplementation(async function(this: ProjectTrustLedger, input) {
    const record = await decide.call(this, input), current = f.store.get<Thread>('thread', f.thread.id)!;
    f.store.internal('fixture.owner.changed', current.id, () => f.store.put('thread', current.id, current.id, { ...current, accountId: 'changed-after-persistence' }));
    return record;
  });
  await expect(f.service.projectTrust.decide(decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  expect(f.store.all('projectTrust')).toHaveLength(1); // retained decision history
  expect(f.store.all('operationProjectTrust')).toEqual([]); // no published authority
  await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_REQUIRED' });
  expect(seam.launches).toBe(0);
});

it('rechecks trust after approval and native acquisition immediately before the launcher', async () => {
  const f = await fixture(), { decision } = await reviewed(f), receipt = await f.service.projectTrust.decide(decision);
  let recorded: unknown;
  seam.beforeGuard = async () => {
    seam.beforeGuard = undefined; await Promise.resolve();
    expect(f.store.get<Operation>('operation', f.operation.id)?.status).toBe('running');
    const sequence = f.store.sequence;
    try { recorded = await recordedStatus(f); } catch (error) { recorded = { error: (error as HarnessError).code }; return; }
    expect(f.store.sequence).toBe(sequence);
    f.service.projectTrust.revoke({ ...f.target, trustId: receipt.current.trustId, expectedTrustRevision: receipt.current.revision });
  };
  await f.approve(); await f.service.dispatchOperation(f.operation.id);
  expect(recorded).toMatchObject({ ...f.target, version: 1, enabled: true, current: { decision: 'trusted', revision: 1 } });
  expect(recorded).not.toHaveProperty('reviewId');
  expect(f.store.get<Operation>('operation', f.operation.id)).toMatchObject({ status: 'failed', error: 'Project trust or the operation owner changed before launch' });
  expect(seam.launches).toBe(0);
});

it('drops pending reviews across actual Store close/reopen and keeps durable decisions as history', async () => {
  const f = await fixture(), first = await reviewed(f), priorHost = f.service.projectTrust;
  await f.service.projectTrust.decide({ ...first.decision, decision: 'declined', executionMode: undefined });
  const pending = await reviewed(f);
  await f.reopen();
  expect(() => priorHost.status(f.target)).toThrow(expect.objectContaining({ code: 'HOST_CLOSING' }));
  await expect(f.service.projectTrust.decide(pending.decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  expect(f.store.all('projectTrust')).toHaveLength(1);
  expect(f.store.get<Thread>('thread', f.thread.id)?.status).toBe('interrupted');
  expect(seam.launches).toBe(0);
});

it('returns a valid disabled response and denies all trust mutations while default-off', async () => {
  const f = await fixture(false);
  expect(operationProjectTrustReviewSchema.parse(await f.service.projectTrust.preview(f.target))).toEqual({
    ...f.target, version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED',
  });
  await expect(f.service.projectTrust.decide({ ...f.target, reviewId: 'unissued', expectedTrustRevision: 0,
    decision: 'trusted', executionMode: 'TRUSTED_HOST' })).rejects.toMatchObject({ code: 'PROJECT_TRUST_DISABLED' });
  expect(() => f.service.projectTrust.revoke({ ...f.target, trustId: 'unissued', expectedTrustRevision: 1 }))
    .toThrow(expect.objectContaining({ code: 'PROJECT_TRUST_DISABLED' }));
  expect(f.store.all('projectTrust')).toEqual([]); expect(seam.launches).toBe(0);
});

it('does not reuse older trust while an explicit decline is awaiting custody', async () => {
  const f = await fixture(), first = await reviewed(f);
  await f.service.projectTrust.decide(first.decision);
  const next = await reviewed(f);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  seam.beforeGuard = async () => { seam.beforeGuard = undefined; entered(); await gate; };
  const pending = f.service.projectTrust.decide({ ...next.decision, decision: 'declined', executionMode: undefined });
  try {
    await waiting;
    await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_REQUIRED' });
    expect(seam.launches).toBe(0);
  } finally { release(); }
  expect((await pending).current.decision).toBe('declined');
});

it('invalidates a review when the prepared operation revision changes', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  f.store.internal('fixture.operation.changed', f.thread.id, () => f.store.put('operation', f.operation.id, f.thread.id,
    { ...f.operation, revision: f.operation.revision + 1 }));
  await expect(f.service.projectTrust.decide(decision)).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
  expect(f.store.all('operationProjectTrust')).toEqual([]); expect(seam.launches).toBe(0);
});

it('does not turn a previously reviewed operation into legacy authority when trust is disabled on restart', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  await f.service.projectTrust.decide(decision);
  await f.reopen(false);
  await f.service.command({ id: randomUUID(), type: 'run.resume', threadId: f.thread.id, payload: { modelId: 'test/model' } });
  await f.service.deliverOutbox(f.thread.id);
  await expect(f.service.projectTrust.preview(f.target)).rejects.toMatchObject({ code: 'PROJECT_TRUST_DISABLED' });
  await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_DISABLED' });
  expect(f.store.all('projectTrust')).toHaveLength(1); expect(seam.launches).toBe(0);
});

it('revokes an approved operation while the real Service queue still holds it', async () => {
  const f = await fixture(), { decision } = await reviewed(f), receipt = await f.service.projectTrust.decide(decision);
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const blocker: Operation = { ...f.operation, id: randomUUID(), kind: 'fixture.queue-blocker', approved: true };
  f.store.internal('fixture.queue-blocker', f.thread.id, () => f.store.put('operation', blocker.id, f.thread.id, blocker));
  const execute = domain.executeDomainOperation;
  // Only this unrelated blocker is controlled. The target still follows the
  // real repository executor, exact byte binding and launch boundary.
  vi.spyOn(domain, 'executeDomainOperation').mockImplementation(async (operation, context) => {
    if (operation.id === blocker.id) { entered(); await gate; return { completed: true }; }
    return execute(operation, context);
  });
  const blocking = f.service.dispatchOperation(blocker.id);
  try {
    await waiting; await f.approve();
    expect(f.store.get<Operation>('operation', f.operation.id)).toMatchObject({ approved: true, status: 'prepared' });
    const sequence = f.store.sequence, pendingStatus = recordedStatus(f);
    await expect(pendingStatus).resolves.toMatchObject({ ...f.target, version: 1, enabled: true, current: { decision: 'trusted', revision: 1 } });
    const recorded = await pendingStatus;
    expect(recorded).not.toHaveProperty('reviewId'); expect(f.store.sequence).toBe(sequence);
    expect(f.service.projectTrust.revoke({ ...f.target, trustId: receipt.current.trustId, expectedTrustRevision: receipt.current.revision }).current.decision).toBe('revoked');
  } finally { release(); await blocking; }
  await f.service.dispatchOperation(f.operation.id);
  expect(f.store.get<Operation>('operation', f.operation.id)?.status).toBe('failed'); expect(seam.launches).toBe(0);
});

it('reads recorded trust repeatedly without writing state or issuing or consuming a decision token', async () => {
  const f = await fixture(), { decision } = await reviewed(f), sequence = f.store.sequence;
  for (let index = 0; index < 140; index++) {
    const recorded = await recordedStatus(f);
    expect(recorded).toMatchObject({ ...f.target, version: 1, enabled: true, current: { decision: 'required', revision: 0 } });
    expect(recorded).not.toHaveProperty('reviewId');
  }
  expect(f.store.sequence).toBe(sequence); expect(f.store.all('operationProjectTrust')).toEqual([]);
  expect((await f.service.projectTrust.decide(decision)).current.decision).toBe('trusted');
  expect(seam.launches).toBe(0);
});

it('returns a strict recorded status with current owner and rejects review authority in that response', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  await f.service.projectTrust.decide(decision);
  const recorded = operationProjectTrustStatusSchema.parse(f.service.projectTrust.status(f.target));
  if (!recorded.enabled) throw new Error('The owned test requires project trust enabled');
  expect(recorded.current).toMatchObject({ decision: 'trusted', revision: 1 });
  expect(recorded.owner).toMatchObject({ threadId: f.thread.id, epoch: 1 });
  for (const changed of [{ ...recorded, version: 2 }, { ...recorded, reviewId: 'unissued' },
    { ...recorded, expiresAt: new Date().toISOString() }, { ...recorded, owner: { ...recorded.owner, threadId: 'foreign-owner' } }])
    expect(operationProjectTrustStatusSchema.safeParse(changed).success).toBe(false);
  recorded.owner.epoch++;
  expect(f.service.projectTrust.status(f.target)).toMatchObject({ owner: { epoch: 1 }, current: { decision: 'trusted' } });
  await expect(f.service.projectTrust.decide({ ...f.target, reviewId: recorded.current.trustId, expectedTrustRevision: 1,
    decision: 'trusted', executionMode: 'TRUSTED_HOST' })).rejects.toMatchObject({ code: 'PROJECT_TRUST_REVIEW_STALE' });
});

it('reports recorded trust without claiming that current file bytes were reverified', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  await f.service.projectTrust.decide(decision);
  await appendFile(join(f.project, 'owned.test.cjs'), '// external edit after recorded trust\n');
  const sequence = f.store.sequence, recorded = f.service.projectTrust.status(f.target);
  expect(recorded).toMatchObject({ current: { decision: 'trusted', revision: 1 } });
  expect(recorded).not.toHaveProperty('approvedDigests'); expect(recorded).not.toHaveProperty('reviewId');
  expect(f.store.sequence).toBe(sequence);
  await f.approve(); await f.service.dispatchOperation(f.operation.id);
  expect(f.store.get<Operation>('operation', f.operation.id)?.status).toBe('failed'); expect(seam.launches).toBe(0);
});

it('invalidates recorded status for changed owners and denies foreign, stale and stopped reads', async () => {
  const f = await fixture(), { decision } = await reviewed(f);
  await f.service.projectTrust.decide(decision);
  const owner = f.store.get<Thread>('thread', f.thread.id)!;
  f.store.internal('fixture.owner.changed', owner.id, () => f.store.put('thread', owner.id, owner.id, { ...owner, accountId: 'changed-account' }));
  const sequence = f.store.sequence;
  expect(f.service.projectTrust.status(f.target)).toMatchObject({ owner: { accountBinding: 'changed-account' }, current: { decision: 'invalidated', revision: 1 } });
  expect(() => f.service.projectTrust.status({ ...f.target, threadId: 'foreign-owner' })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  expect(() => f.service.projectTrust.status({ ...f.target, operationRevision: 2 })).toThrow(expect.objectContaining({ code: 'PROJECT_TRUST_REVIEW_STALE' }));
  expect(f.store.sequence).toBe(sequence);
  f.store.internal('fixture.owner.stopped', owner.id, () => f.store.put('thread', owner.id, owner.id, { ...owner, status: 'stopped' }));
  expect(() => f.service.projectTrust.status(f.target)).toThrow(expect.objectContaining({ code: 'PROJECT_TRUST_REVIEW_STALE' }));
});

it.each([false, true])('keeps disabled recorded status read-only without weakening a prepared requirement (prepared enabled=%s)', async preparedEnabled => {
  const f = await fixture(preparedEnabled);
  if (preparedEnabled) {
    await f.reopen(false);
    await f.service.command({ id: randomUUID(), type: 'run.resume', threadId: f.thread.id, payload: { modelId: 'test/model' } });
    await f.service.deliverOutbox(f.thread.id);
  }
  const sequence = f.store.sequence;
  if (preparedEnabled) expect(() => f.service.projectTrust.status(f.target)).toThrow(expect.objectContaining({ code: 'PROJECT_TRUST_DISABLED' }));
  else expect(operationProjectTrustStatusSchema.parse(f.service.projectTrust.status(f.target))).toEqual({
    ...f.target, version: 1, enabled: false, reason: 'PROJECT_TRUST_DISABLED',
  });
  expect(f.store.sequence).toBe(sequence); expect(f.store.all('operationProjectTrust')).toEqual([]);
  expect(f.store.all('projectTrust')).toEqual([]); expect(seam.launches).toBe(0);
});

it.each(['no decision', 'failed publication'] as const)('retains the preparation trust requirement across disabled restart (%s)', async scenario => {
  const f = await fixture();
  expect(f.store.get('operationProjectTrustRequirement', f.operation.id)).toMatchObject({ version: 1, operationId: f.operation.id, operationRevision: f.operation.revision });
  if (scenario === 'failed publication') {
    const { decision } = await reviewed(f), internal = f.store.internal.bind(f.store);
    const spy = vi.spyOn(f.store, 'internal').mockImplementation((event, threadId, action) => {
      if (event === 'operation.projectTrust.decided') throw new Error('Owned publication failure');
      return internal(event, threadId, action);
    });
    await expect(f.service.projectTrust.decide(decision)).rejects.toThrow('Owned publication failure');
    spy.mockRestore(); expect(f.store.all('projectTrust')).toHaveLength(1);
  }
  expect(f.store.all('operationProjectTrust')).toEqual([]);
  await f.reopen(false);
  await f.service.command({ id: randomUUID(), type: 'run.resume', threadId: f.thread.id, payload: { modelId: 'test/model' } });
  await f.service.deliverOutbox(f.thread.id);
  await expect(f.service.projectTrust.preview(f.target)).rejects.toMatchObject({ code: 'PROJECT_TRUST_DISABLED' });
  await expect(f.approve()).rejects.toMatchObject({ code: 'PROJECT_TRUST_DISABLED' });
  expect(seam.launches).toBe(0);
});
