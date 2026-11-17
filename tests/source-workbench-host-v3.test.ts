import {afterEach, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage/store.ts';
import {Service, type ServiceOptions} from '../packages/core/service.ts';
import {__setCapabilityFlagForTests, capabilityEnabled} from '../packages/core/capability-flags.ts';
import type {ArtifactRecord, DataRecord, Message, ResourceGrant, RuntimeAdapter, RuntimeCallbacks, StartRun, Thread} from '../packages/contracts/index.ts';
import {sourceDigestSync} from '../packages/core/project-verification.ts';
import {computeAssessment} from '../packages/core/verification-gate.ts';
import type {CheckObservationV1} from '../packages/contracts/verification.ts';
import type {ConnectionAccount} from '../packages/contracts/accounts.ts';
import {createWorkspaceCanvas, WorkspaceRepository} from '../packages/core/workspace-layout.ts';
import type {WorkspaceProfile} from '../packages/contracts/workspace.ts';
import type {WorkspaceBinding} from '../packages/workspace/tools.ts';

const cleanup: (() => Promise<void>)[] = [];
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
afterEach(async () => {vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); try {__setCapabilityFlagForTests('ui.sourceWorkbenchV1', undefined);} catch {/* The initial failing fixture predates the flag. */}});

function fixture(options: ServiceOptions = {}, seedAssistant = true) {
  const root = mkdtempSync(join(tmpdir(), 'm15-host-')), store = new Store(join(root, 'data'));
  const starts: StartRun[] = [], followUps: StartRun[] = []; let callbacks!: RuntimeCallbacks;
  const runtime: RuntimeAdapter = {configure(value) {callbacks = value;}, models: async () => [{id: 'test/model', provider: 'test', name: 'Test'}], start: async input => {starts.push(input);}, followUp: async input => {followUps.push(input);}, cancel: async () => {}, compact: async () => {}, history: async () => [], dispose: async () => {}};
  const service = new Service(store, runtime, options);
  cleanup.push(async () => {await service.dispose(); store.close(); rmSync(root, {recursive: true, force: true});});
  const thread: Thread = {id: 'thread-a', title: 'Task', projectName: null, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z', status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null};
  const assistant: Message = {id: 'message-a', threadId: thread.id, role: 'assistant', content: 'A😀B\nSecond line', runId: null, createdAt: thread.createdAt};
  store.internal('fixture', thread.id, () => {store.put('thread', thread.id, thread.id, thread); if (seedAssistant) store.put('message', assistant.id, thread.id, assistant);});
  const owner = {threadId: thread.id, projectId: null, workspaceId: null};
  const source = {kind: 'MESSAGE' as const, sourceId: assistant.id, sourceRevision: sha(assistant.content), contentDigest: sha(assistant.content), logicalOwner: owner, capturedAt: thread.createdAt, range: {encoding: 'UTF16' as const, start: 1, end: 3, selectedTextDigest: sha('😀')}};
  const workbench = () => {expect(service, 'M15 must use a host source service').toHaveProperty('sourceWorkbench'); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); return service.sourceWorkbench;};
  const send = (id: string, sourceRefs: unknown[], sendMode = 'NOW') => service.command({id, type: 'message.send', threadId: thread.id, payload: {content: 'Explain the source', modelId: 'test/model', sourceRefs, sendMode}});
  return {root, store, service, runtime, starts, followUps, thread, assistant, owner, source, workbench, send, event: (event: Record<string, unknown>) => callbacks.onEvent(event as Parameters<RuntimeCallbacks['onEvent']>[0])};
}

async function emptyTaskAccountFixture(requestContextEnabled = false) {
  const f = fixture({requestContextEnabled}, false), workbench = f.workbench();
  vi.spyOn(f.runtime, 'models').mockResolvedValue([{id: 'openai/model', provider: 'openai', name: 'Account fixture'}]);
  const account = (await f.service.command({id: 'first-account-create', type: 'account.create', payload: {providerId: 'openai', label: 'First account'}})).result as ConnectionAccount;
  await f.service.command({id: 'first-account-select', type: 'account.select', payload: {providerId: 'openai', accountId: account.id}});
  const send = (id: string, sourceRefs: unknown[] = []) => f.service.command({id, type: 'message.send', threadId: f.thread.id, payload: {content: 'Explain the source', modelId: 'openai/model', sourceRefs}});
  return {...f, workbench, account, send};
}

async function emptyTaskSourceFixture(requestContextEnabled = false) {
  const f = await emptyTaskAccountFixture(requestContextEnabled), workbench = f.workbench;
  // A declared host artifact isolates account admission from native file access.
  // This fixture has no canonical messages, native session or accepted inputs.
  const data: DataRecord = {id: 'empty-task-data', threadId: f.thread.id, revision: 1, value: [{name: 'Retained first source'}], provenance: 'executor', createdAt: f.thread.createdAt};
  const artifact: ArtifactRecord = {id: 'empty-task-artifact', threadId: f.thread.id, messageId: 'declared-fixture-source', title: 'Declared source', purpose: 'Account custody fixture', kind: 'structured', revision: 1, spec: {root: 'rows', elements: {rows: {type: 'Table', props: {rowsBinding: 'rows'}}}}, widget: null, bindings: {rows: {mode: 'live', id: data.id}}, actions: {}, stateId: 'empty-task-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: f.thread.createdAt, updatedAt: f.thread.createdAt};
  f.store.internal('fixture.empty-task-artifact', f.thread.id, () => {f.store.put('data', data.id, f.thread.id, data); f.store.put('artifact', artifact.id, f.thread.id, artifact);});
  const descriptor = await workbench.describe({logicalOwner: f.owner, locator: {kind: 'ARTIFACT_REGION', sourceId: artifact.id, binding: 'rows'}});
  const captured = await workbench.capture({commandId: 'first-source-capture', source: {...descriptor.locator, logicalOwner: f.owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: f.thread.createdAt, range: {encoding: 'JSON_POINTER', pointer: '/0'}}});
  const send = (id: string, sourceRefs: unknown[] = [captured.ref]) => f.service.command({id, type: 'message.send', threadId: f.thread.id, payload: {content: 'Explain the source', modelId: 'openai/model', sourceRefs}});
  return {...f, captured, send};
}

it.each([false, true])('admits first-account source custody for a truly empty task (host artifact fixture, M04 %s)', async requestContextEnabled => {
  const f = await emptyTaskSourceFixture(requestContextEnabled);
  expect(f.store.all('message', f.thread.id)).toEqual([]); expect(f.store.all('outbox', f.thread.id)).toEqual([]);
  expect(f.store.get<Thread>('thread', f.thread.id)?.accountId).toBeUndefined();
  const savedCapture = f.store.get('sourceCapture', f.captured.ref.captureId);
  const receipt = await f.send('first-source-send');
  expect(receipt.result).toMatchObject({inputId: 'first-source-send'});
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0]).toMatchObject({accountId: f.account.id, sourceRefs: [f.captured.ref], resources: []});
  expect(f.starts[0].prompt).toContain('Retained first source');
  expect(await f.workbench.open({logicalOwner: f.owner, ref: f.captured.ref})).toMatchObject({ref: f.captured.ref, state: 'CURRENT', text: '{"name":"Retained first source"}'});
  expect(await f.send('first-source-send')).toEqual(receipt);
  expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);
  expect(f.store.get('sourceCapture', f.captured.ref.captureId)).toEqual(savedCapture);
});

it('preserves unsent captured custody when an ordinary first input pins its account', async () => {
  const f = await emptyTaskSourceFixture();
  await f.send('plain-first-account-send', []); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0].sourceRefs).toBeUndefined();
  expect(await f.workbench.open({logicalOwner: f.owner, ref: f.captured.ref})).toMatchObject({ref: f.captured.ref, state: 'CURRENT', text: '{"name":"Retained first source"}'});
});

it('rolls back initial source-account custody with a failed input commit and retries the same identity', async () => {
  const f = await emptyTaskSourceFixture(), savedCapture = f.store.get('sourceCapture', f.captured.ref.captureId), put = f.store.put.bind(f.store);
  const failure = vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'sourceAccountAdmission') throw new Error('fixture admission persistence failed'); return put(kind, ...args);});
  await expect(f.send('atomic-first-source-send')).rejects.toThrow('fixture admission persistence failed'); failure.mockRestore();
  expect(f.store.get('sourceAccountAdmission', f.thread.id)).toBeNull(); expect(f.store.all('outbox', f.thread.id)).toEqual([]); expect(f.store.all('message', f.thread.id)).toEqual([]);
  expect(f.store.get<Thread>('thread', f.thread.id)?.accountId).toBeUndefined(); expect(f.store.get('sourceCapture', f.captured.ref.captureId)).toEqual(savedCapture);
  expect(await f.send('atomic-first-source-send')).toMatchObject({result: {inputId: 'atomic-first-source-send'}});
  await vi.waitFor(() => expect(f.starts).toHaveLength(1)); expect(f.starts[0].accountId).toBe(f.account.id);
});

it('retries the same explicit M04 preparation after initial source-account persistence rolls back', async () => {
  const f = await emptyTaskSourceFixture(true), savedCapture = f.store.get('sourceCapture', f.captured.ref.captureId);
  const preparation = await f.service.prepareRequestContext(f.thread.id, 'Explain the source', {modelId: 'openai/model'});
  const command = {id: 'm04-atomic-first-source-send', type: 'message.send', threadId: f.thread.id, payload: {content: 'Explain the source', modelId: 'openai/model', sourceRefs: [f.captured.ref], requestContextId: preparation.requestId}};
  const put = f.store.put.bind(f.store), failure = new Error('fixture M04 source admission persistence failed');
  const persistence = vi.spyOn(f.store, 'put').mockImplementation((kind, ...args) => {if (kind === 'sourceAccountAdmission') throw failure; return put(kind, ...args);});
  await expect(f.service.command(command)).rejects.toBe(failure); persistence.mockRestore();
  expect(f.store.receipt(command)).toBeNull(); expect(f.store.all('outbox', f.thread.id)).toEqual([]); expect(f.store.all('message', f.thread.id)).toEqual([]);
  expect(f.store.get('sourceAccountAdmission', f.thread.id)).toBeNull(); expect(f.store.get<Thread>('thread', f.thread.id)?.accountId).toBeUndefined();
  expect(f.store.get('sourceCapture', f.captured.ref.captureId)).toEqual(savedCapture);
  const receipt = await f.service.command(command);
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0]).toMatchObject({accountId: f.account.id, sourceRefs: [f.captured.ref], requestContext: {requestId: preparation.requestId, contextGeneration: preparation.contextGeneration}});
  expect(f.starts[0].prompt).toContain('Retained first source');
  expect(await f.service.command(command)).toEqual(receipt); expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);
  await expect(f.service.command({...command, id: 'm04-source-token-reuse'})).rejects.toMatchObject({code: 'STALE_REQUEST_CONTEXT'});
  expect(f.store.get('sourceCapture', f.captured.ref.captureId)).toEqual(savedCapture);
});

it('rejects a selected-account change during first-source admission without creating a custody witness', async () => {
  const f = await emptyTaskSourceFixture(), savedCapture = f.store.get('sourceCapture', f.captured.ref.captureId);
  const replacement = (await f.service.command({id: 'replacement-account-create', type: 'account.create', payload: {providerId: 'openai', label: 'Replacement account'}})).result as ConnectionAccount;
  let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => {release = resolve;}), began = new Promise<void>(resolve => {entered = resolve;});
  vi.mocked(f.runtime.models).mockImplementationOnce(async () => {entered(); await gate; return [{id: 'openai/model', provider: 'openai', name: 'Account fixture'}];});
  const pending = f.send('changed-account-first-send'); await began;
  await f.service.command({id: 'replacement-account-select', type: 'account.select', payload: {providerId: 'openai', accountId: replacement.id}}); release();
  await expect(pending).rejects.toMatchObject({code: 'ACCOUNT_SELECTION_CHANGED', details: {sendAccepted: false}});
  expect(f.store.get('sourceAccountAdmission', f.thread.id)).toBeNull(); expect(f.store.all('outbox', f.thread.id)).toEqual([]); expect(f.store.get('sourceCapture', f.captured.ref.captureId)).toEqual(savedCapture);
  await f.send('current-account-first-send'); await vi.waitFor(() => expect(f.starts).toHaveLength(1)); expect(f.starts[0].accountId).toBe(replacement.id);
});

it('denies captured source reuse after a settled account is replaced, even when captured bytes are retained', async () => {
  const f = await emptyTaskSourceFixture(); await f.send('settled-account-first-send'); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  f.store.internal('fixture.replace-settled-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.store.get<Thread>('thread', f.thread.id)!, accountId: 'replacement-account'}));
  const retained = {...f.captured.ref, keepCaptured: true};
  await expect(f.workbench.open({logicalOwner: f.owner, ref: retained})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  await expect(f.workbench.prepareSend(f.owner, [retained])).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);
});

it('preserves initial source custody when the admitted account is the default profile', async () => {
  const f = await emptyTaskSourceFixture();
  await f.service.command({id: 'default-account-select', type: 'account.select', payload: {providerId: 'openai', accountId: null}});
  await f.send('default-account-first-send'); await vi.waitFor(() => expect(f.starts).toHaveLength(1)); expect(f.starts[0].accountId).toBeNull();
  expect(await f.workbench.open({logicalOwner: f.owner, ref: f.captured.ref})).toMatchObject({ref: f.captured.ref, state: 'CURRENT'});
});

it('requires recapture for legacy sources without proof of initial unbound account custody', async () => {
  const f = await emptyTaskSourceFixture(), saved = f.store.get<Record<string, unknown>>('sourceCapture', f.captured.ref.captureId)!;
  const {accountUnbound: _unbound, ...legacy} = saved;
  f.store.internal('fixture.legacy-source-capture', f.thread.id, () => f.store.put('sourceCapture', f.captured.ref.captureId, f.thread.id, legacy));
  await expect(f.send('legacy-first-source-send')).rejects.toMatchObject({code: 'CAPABILITY_DENIED', details: {sendAccepted: false}});
  expect(f.store.get('sourceAccountAdmission', f.thread.id)).toBeNull(); expect(f.store.all('outbox', f.thread.id)).toEqual([]); expect(f.store.get<Thread>('thread', f.thread.id)?.accountId).toBeUndefined();
  const refreshed = await f.workbench.refresh({commandId: 'legacy-source-refresh', logicalOwner: f.owner, ref: f.captured.ref});
  await f.send('refreshed-first-source-send', [refreshed.ref]); await vi.waitFor(() => expect(f.starts).toHaveLength(1)); expect(f.starts[0].sourceRefs).toEqual([refreshed.ref]);
});

it('captures exact UTF16 text once, rejects forged revisions and prevents surrogate splitting', async () => {
  const f = fixture(), workbench = f.workbench();
  const captured = await workbench.capture({commandId: 'capture-one', source: f.source});
  expect(captured.preview).toBe('😀'); expect(captured.ref.source).toMatchObject({...f.source, capturedAt: expect.any(String)});
  expect(await workbench.capture({commandId: 'capture-one', source: f.source})).toEqual(captured);
  await expect(workbench.capture({commandId: 'capture-forged', source: {...f.source, contentDigest: '0'.repeat(64)}})).rejects.toMatchObject({code: 'STALE_SOURCE'});
  await expect(workbench.capture({commandId: 'capture-split', source: {...f.source, range: {...f.source.range, start: 2}}})).rejects.toMatchObject({code: 'INVALID_SOURCE_RANGE'});
  await expect(workbench.capture({commandId: 'capture-owner', source: {...f.source, logicalOwner: {...f.owner, workspaceId: 'other'}}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('sourceCapture', f.thread.id)).toHaveLength(1);
});

it('keeps historical bytes immutable and requires explicit retained-version send after source changes', async () => {
  const f = fixture(), workbench = f.workbench(), captured = await workbench.capture({commandId: 'capture-stale', source: f.source});
  f.store.internal('fixture.edit', f.thread.id, () => f.store.put('message', f.assistant.id, f.thread.id, {...f.assistant, content: 'A changed answer'}));
  const opened = await workbench.open({logicalOwner: f.owner, ref: captured.ref});
  expect(opened).toMatchObject({state: 'STALE', text: '😀', retained: true});
  await expect(f.send('stale-send', [captured.ref])).rejects.toMatchObject({code: 'STALE_SOURCE'});
  const receipt = await f.send('retained-send', [{...captured.ref, keepCaptured: true}]);
  expect(receipt.result).toMatchObject({inputId: 'retained-send'});
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0].prompt).toContain('😀'); expect(f.starts[0].prompt).toContain('captured'); expect(f.starts[0].resources).toEqual([]);
  expect(f.store.all<Message>('message', f.thread.id).filter(message => message.role === 'user')).toEqual([expect.objectContaining({sourceRefs: [{...captured.ref, keepCaptured: true}]})]);
});

// The existing Linux guard explicitly refuses leaf/readOnly policies. This
// positive integration must run on the actual supported target, without mocks.
it.runIf(process.platform === 'win32')('reauthorizes retained file bytes after grant revocation and never grants source context [Windows required]', async () => {
  const f = fixture(), workbench = f.workbench(), path = join(f.root, 'source.txt'); writeFileSync(path, 'first\nsecond\nthird\n');
  const grant: ResourceGrant = {id: 'grant-a', threadId: f.thread.id, kind: 'file', path, label: 'source.txt', writable: false, createdAt: f.thread.createdAt};
  f.store.internal('fixture.grant', f.thread.id, () => f.store.put('resource', grant.id, f.thread.id, grant));
  const descriptor = await workbench.describe({logicalOwner: f.owner, locator: {kind: 'FILE_RANGE', sourceId: grant.id}});
  const source = {...descriptor.locator, logicalOwner: f.owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: f.thread.createdAt, range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 2}};
  const captured = await workbench.capture({commandId: 'file-capture', source}); expect(captured.preview).toBe('second');
  f.store.internal('fixture.revoke', f.thread.id, () => f.store.remove('resource', grant.id));
  await expect(workbench.open({logicalOwner: f.owner, ref: {...captured.ref, keepCaptured: true}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  await expect(f.send('revoked-send', [{...captured.ref, keepCaptured: true}])).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('outbox', f.thread.id)).toEqual([]);
});

it.runIf(process.platform === 'win32')('admits the first captured file under its selected account [Windows native guard, runtime fixture]', async () => {
  const f = await emptyTaskAccountFixture(true), path = join(f.root, 'first-source.txt'); writeFileSync(path, 'first\nselected second\nthird\n');
  const grant: ResourceGrant = {id: 'first-file-grant', threadId: f.thread.id, kind: 'file', path, label: 'first-source.txt', writable: false, createdAt: f.thread.createdAt};
  f.store.internal('fixture.first-file-grant', f.thread.id, () => f.store.put('resource', grant.id, f.thread.id, grant));
  const descriptor = await f.workbench.describe({logicalOwner: f.owner, locator: {kind: 'FILE_RANGE', sourceId: grant.id}});
  const captured = await f.workbench.capture({commandId: 'first-file-capture', source: {...descriptor.locator, logicalOwner: f.owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: f.thread.createdAt, range: {encoding: 'LINES_1_BASED', startLine: 2, endLine: 2}}});
  expect(f.store.all('message', f.thread.id)).toEqual([]); expect(f.store.get<Thread>('thread', f.thread.id)?.accountId).toBeUndefined();
  await f.send('first-file-send', [captured.ref]); await vi.waitFor(() => expect(f.starts).toHaveLength(1), {timeout: 45_000});
  expect(f.starts[0]).toMatchObject({accountId: f.account.id, sourceRefs: [captured.ref], resources: [grant]}); expect(f.starts[0].prompt).toContain('selected second');
  expect(await f.workbench.open({logicalOwner: f.owner, ref: captured.ref})).toMatchObject({ref: captured.ref, text: 'selected second', state: 'CURRENT'});
  f.store.internal('fixture.revoke-first-file', f.thread.id, () => f.store.remove('resource', grant.id));
  await expect(f.workbench.open({logicalOwner: f.owner, ref: {...captured.ref, keepCaptured: true}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  await expect(f.send('revoked-first-file-send', [{...captured.ref, keepCaptured: true}])).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);
});

it('reads artifact rows only through a declared same-owner structured binding', async () => {
  const f = fixture(), workbench = f.workbench();
  const data: DataRecord = {id: 'rows-a', threadId: f.thread.id, revision: 1, value: [{name: 'Approved row', count: 7}], provenance: 'executor', createdAt: f.thread.createdAt};
  const artifact: ArtifactRecord = {id: 'artifact-a', threadId: f.thread.id, messageId: f.assistant.id, title: 'Report', purpose: 'Read declared rows', kind: 'structured', revision: 1, spec: {root: 'rows', elements: {rows: {type: 'Table', props: {rowsBinding: 'rows'}}}}, widget: null, bindings: {rows: {mode: 'live', id: data.id}}, actions: {}, stateId: 'state-a', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: f.thread.createdAt, updatedAt: f.thread.createdAt};
  f.store.internal('fixture.artifact', f.thread.id, () => {f.store.put('data', data.id, f.thread.id, data); f.store.put('artifact', artifact.id, f.thread.id, artifact);});
  const descriptor = await workbench.describe({logicalOwner: f.owner, locator: {kind: 'ARTIFACT_REGION', sourceId: artifact.id, binding: 'rows'}});
  const captured = await workbench.capture({commandId: 'artifact-capture', source: {...descriptor.locator, logicalOwner: f.owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: f.thread.createdAt, range: {encoding: 'JSON_POINTER', pointer: '/0'}}});
  expect(captured.preview).toContain('Approved row');
  await expect(workbench.describe({logicalOwner: f.owner, locator: {kind: 'ARTIFACT_REGION', sourceId: artifact.id, binding: 'undeclared'}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  f.store.internal('fixture.foreign', f.thread.id, () => f.store.put('data', data.id, 'other', {...data, threadId: 'other'}));
  await expect(workbench.open({logicalOwner: f.owner, ref: {...captured.ref, keepCaptured: true}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('preserves artifact source custody through retained legacy layout apply/select and rejects new retired presets [Service/Store, runtime fixture]', async () => {
  const f = await emptyTaskAccountFixture(true), layouts = new WorkspaceRepository(f.store);
  const owner = {threadId: f.thread.id, projectId: 'layout-project', workspaceId: 'layout-working-copy'};
  const projectPath = join(f.root, 'project'), workingPath = join(f.root, 'working-copy'), commonDirectory = join(f.root, 'git-metadata'), gitDirectory = join(commonDirectory, 'worktrees', owner.workspaceId);
  for (const path of [projectPath, workingPath, gitDirectory]) mkdirSync(path, {recursive: true});
  const identity = (path: string) => {const value = statSync(path, {bigint: true}); return {dev: String(value.dev), ino: String(value.ino)};};
  // These measured directories exercise owner custody, not native Git or file access.
  const workingCopy: WorkspaceBinding = {id: owner.workspaceId, threadId: owner.threadId, projectId: owner.projectId, path: workingPath, branch: 'gen/layout-source', gitDirectory, commonDirectory, identity: identity(workingPath), gitDirectoryIdentity: identity(gitDirectory), commonDirectoryIdentity: identity(commonDirectory)};
  const data: DataRecord = {id: 'layout-source-data', threadId: owner.threadId, revision: 1, value: [{name: 'Retained layout source', count: 7}], provenance: 'executor', createdAt: f.thread.createdAt};
  const artifact: ArtifactRecord = {id: 'layout-source-artifact', threadId: owner.threadId, messageId: 'declared-layout-source', title: 'Layout source', purpose: 'Retained layout custody fixture', kind: 'structured', revision: 1, spec: {root: 'rows', elements: {rows: {type: 'Table', props: {rowsBinding: 'rows'}}}}, widget: null, bindings: {rows: {mode: 'live', id: data.id}}, actions: {}, stateId: 'layout-source-state', lifecycle: 'active', placement: 'inline', pinned: false, catalogVersion: '1', createdAt: f.thread.createdAt, updatedAt: f.thread.createdAt};
  const initial = layouts.read().state;
  const legacy = createWorkspaceCanvas('research', 'Retained Research', 'retained-research', {authority: {kind: 'local'}, threadId: owner.threadId, projectId: owner.projectId});
  const profile: WorkspaceProfile = {version: 1, id: 'retained-layout-profile', name: 'Saved before retirement', canvases: [...initial.canvases, legacy], activeCanvasId: legacy.id, disabledKinds: [], integrations: initial.integrations, createdAt: f.thread.createdAt, updatedAt: f.thread.createdAt};
  f.store.internal('fixture.layout-source-owner', owner.threadId, () => {
    f.store.put('thread', owner.threadId, owner.threadId, {...f.thread, kind: 'main', projectId: owner.projectId, workspaceId: owner.workspaceId, projectName: 'Layout project'});
    f.store.put('workspaceProject', owner.projectId, null, {id: owner.projectId, name: 'Layout project', authority: {kind: 'local'}, rootPath: projectPath, createdAt: f.thread.createdAt});
    f.store.put('workspaceProjectRoot', owner.projectId, null, {path: projectPath, identity: identity(projectPath)});
    f.store.put('workspaceBinding', workingCopy.id, owner.threadId, workingCopy);
    f.store.put('data', data.id, owner.threadId, data); f.store.put('artifact', artifact.id, owner.threadId, artifact);
    // Seed a historical saved record. New retired-preset creation remains forbidden.
    f.store.put('workspaceState', 'personal', null, {...initial, profiles: [profile]});
  });
  const descriptor = await f.workbench.describe({logicalOwner: owner, locator: {kind: 'ARTIFACT_REGION', sourceId: artifact.id, binding: 'rows'}});
  const captured = await f.workbench.capture({commandId: 'layout-source-capture', source: {...descriptor.locator, logicalOwner: owner, sourceRevision: descriptor.sourceRevision, contentDigest: descriptor.contentDigest, capturedAt: f.thread.createdAt, range: {encoding: 'JSON_POINTER', pointer: '/0'}}});
  const originalCapture = f.store.get('sourceCapture', captured.ref.captureId);
  expect(originalCapture).toMatchObject({accountUnbound: true});
  const custody = () => ({thread: f.store.get('thread', owner.threadId), account: f.store.get('account', f.account.id), settings: f.store.get('settings', 'global'), project: f.store.get('workspaceProject', owner.projectId), projectRoot: f.store.get('workspaceProjectRoot', owner.projectId), workingCopy: f.store.get('workspaceBinding', owner.workspaceId), captures: f.store.all('sourceCapture'), admission: f.store.get('sourceAccountAdmission', owner.threadId), outbox: f.store.all('outbox'), messages: f.store.all('message'), artifacts: f.store.all('artifact'), data: f.store.all('data'), resources: f.store.all('resource')});
  const assertCustody = async (before: ReturnType<typeof custody>, starts: number) => {
    expect(custody()).toEqual(before); expect(f.workbench.owner(owner.threadId)).toEqual(owner);
    expect(await f.workbench.open({logicalOwner: owner, ref: captured.ref})).toMatchObject({ref: captured.ref, state: 'CURRENT', text: '{"name":"Retained layout source","count":7}'});
    expect(f.starts).toHaveLength(starts); expect(f.followUps).toEqual([]);
  };
  const applyAndSelect = async (phase: string) => {
    const before = custody(), starts = f.starts.length;
    const apply = {id: phase + '-layout-apply', type: 'workspace.profile.apply', payload: {profileId: profile.id, baseRevision: layouts.read().state.revision}};
    const receipt = layouts.command(apply);
    expect(layouts.command(apply)).toEqual(receipt);
    expect(layouts.read().state.activeCanvasId).toBe(legacy.id);
    expect(layouts.read().state.canvases.find(canvas => canvas.id === legacy.id)).toEqual(legacy);
    await assertCustody(before, starts);
    for (const canvasId of [initial.activeCanvasId, legacy.id]) {
      layouts.command({id: phase + '-select-' + canvasId, type: 'workspace.canvas.select', payload: {canvasId, baseRevision: layouts.read().state.revision}});
      expect(layouts.read().state.activeCanvasId).toBe(canvasId);
      await assertCustody(before, starts);
    }
  };
  expect(f.store.all('message')).toEqual([]); expect(f.store.all('outbox')).toEqual([]);
  await applyAndSelect('unsent');
  const receipt = await f.send('layout-source-send', [captured.ref]);
  await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(f.starts[0]).toMatchObject({threadId: owner.threadId, inputId: 'layout-source-send', accountId: f.account.id, sourceRefs: [captured.ref], resources: []});
  const deliveredSources = f.starts[0].prompt.split('\n').filter(line => line.startsWith('{"captureId":'));
  expect(deliveredSources).toHaveLength(1);
  expect(JSON.parse(deliveredSources[0])).toEqual({captureId: captured.ref.captureId, source: captured.ref.source, version: 'current captured version', text: '{"name":"Retained layout source","count":7}'});
  expect(f.starts[0].requestContext).toBeDefined();
  expect(f.store.get('sourceCapture', captured.ref.captureId)).toEqual(originalCapture);
  expect(f.store.get('sourceAccountAdmission', owner.threadId)).toMatchObject({inputId: 'layout-source-send', logicalOwner: owner, accountId: f.account.id});
  expect(f.store.get('outbox', 'layout-source-send')).toMatchObject({threadId: owner.threadId, sourceRefs: [captured.ref], status: 'processing'});
  await applyAndSelect('accepted');
  const admitted = custody();
  for (const preset of ['research', 'code-review', 'custom']) {
    const before = layouts.read().state, rejected = {id: 'create-retired-' + preset, type: 'workspace.canvas.create', payload: {name: preset, preset, threadId: owner.threadId, baseRevision: before.revision}};
    expect(() => layouts.command(rejected)).toThrowError(expect.objectContaining({code: 'PRESET_RETIRED'}));
    expect(f.store.receipt(rejected)).toBeNull(); expect(layouts.read().state).toEqual(before);
    await assertCustody(admitted, 1);
  }
  expect(await f.send('layout-source-send', [captured.ref])).toEqual(receipt);
  await assertCustody(admitted, 1);
  expect(f.store.all('sourceCapture')).toEqual([originalCapture]); expect(f.store.all('outbox')).toHaveLength(1);
});

it('rejects mutation during model discovery and preserves the accepted command identity on retries', async () => {
  const f = fixture(), workbench = f.workbench(), captured = await workbench.capture({commandId: 'race-capture', source: f.source});
  const models = f.runtime.models;
  vi.spyOn(f.runtime, 'models').mockImplementationOnce(async options => {f.store.internal('fixture.race', f.thread.id, () => f.store.put('message', f.assistant.id, f.thread.id, {...f.assistant, content: 'Mutated while preparing'})); return models(options);});
  await expect(f.send('race-send', [captured.ref])).rejects.toMatchObject({code: 'STALE_SOURCE'});
  expect(f.store.all('outbox', f.thread.id)).toHaveLength(0);
  const kept = {...captured.ref, keepCaptured: true}, receipt = await f.send('retry-send', [kept]);
  expect(await f.send('retry-send', [kept])).toEqual(receipt);
  await expect(f.send('retry-send', [])).rejects.toMatchObject({code: 'DUPLICATE_COMMAND'});
  expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);
});

it.each([false, true])('queues AFTER_CURRENT and starts the next native epoch after settlement (context custody %s)', async requestContextEnabled => {
  const f = fixture({requestContextEnabled}), workbench = f.workbench(), captured = await workbench.capture({commandId: 'queued-capture', source: f.source});
  await f.send('first-send', []); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  await f.send('queued-send', [captured.ref], 'AFTER_CURRENT');
  expect(f.followUps).toHaveLength(0);
  expect(f.store.get('outbox', 'queued-send')).toMatchObject({status: 'persisted', sendMode: 'AFTER_CURRENT', sourceRefs: [captured.ref]});
  const active = f.starts[0];
  f.event({...active, type: 'input.processing', inputIds: ['first-send']});
  await f.service.tool({name: 'task_finish', args: {summary: 'First input complete'}}, active);
  f.event({...active, type: 'settled'});
  await vi.waitFor(() => expect(f.starts).toHaveLength(2));
  expect(f.starts[1]).toMatchObject({inputId: 'queued-send', epoch: active.epoch + 1, sourceRefs: [captured.ref]});
  expect(f.followUps).toEqual([]);
});

it('measures selected references through M04 without replacing its original prompt claim', async () => {
  const f = fixture({requestContextEnabled: true}), captured = await f.workbench().capture({commandId: 'm04-capture', source: f.source});
  await f.send('m04-send', [captured.ref]); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  const input = f.starts[0];
  expect(input.requestContext?.segments).toEqual(expect.arrayContaining([expect.objectContaining({category: 'REFERENCE', sourceId: 'selected-sources:m04-send'})]));
  expect(input.requestContext?.budget.utf8Bytes).toBe(Buffer.byteLength(input.prompt));
  const sourceStart = input.prompt.indexOf('\n\nSelected source evidence'); expect(sourceStart).toBeGreaterThan(0);
  expect(input.requestContext?.segments.find(segment => segment.sourceId === 'selected-sources:m04-send')?.contentRef).toBe('sha256:' + sha(input.prompt.slice(sourceStart)));
  expect(f.store.get('outbox', 'm04-send')).toMatchObject({content: 'Explain the source', sourceRefs: [captured.ref]});
});

it('blocks dispatch if a source mutates during the M04 finalize boundary', async () => {
  let mutate = () => {};
  const f = fixture({requestContextEnabled: true, requestContextHooks: {finalize: async () => {mutate(); return {sources: []};}}});
  const captured = await f.workbench().capture({commandId: 'finalize-capture', source: f.source});
  mutate = () => f.store.internal('fixture.finalize', f.thread.id, () => f.store.put('message', f.assistant.id, f.thread.id, {...f.assistant, content: 'Changed at finalize'}));
  await f.send('finalize-send', [captured.ref]);
  await vi.waitFor(() => expect(f.store.get<Thread>('thread', f.thread.id)?.status).toBe('interrupted'));
  expect(f.starts).toEqual([]); expect(f.store.get('outbox', 'finalize-send')).toMatchObject({sourceRefs: [captured.ref], enteredRuntime: false});
});

it.runIf(process.platform === 'linux')('keeps file captures unavailable under the real unsupported Linux leaf guard', async () => {
  const f = fixture(), workbench = f.workbench(), path = join(f.root, 'guarded.txt'); writeFileSync(path, 'retained source');
  f.store.internal('fixture.grant', f.thread.id, () => f.store.put('resource', 'grant-linux', f.thread.id, {id: 'grant-linux', threadId: f.thread.id, kind: 'file', path, label: 'guarded.txt', writable: false, createdAt: f.thread.createdAt}));
  await expect(workbench.describe({logicalOwner: f.owner, locator: {kind: 'FILE_RANGE', sourceId: 'grant-linux'}})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('sourceCapture', f.thread.id)).toEqual([]);
});

it('keeps diff capture disabled until its owning service supplies an atomic comparison witness', async () => {
  const f = fixture(), workbench = f.workbench();
  const listed = await workbench.list(f.thread.id);
  expect(listed.sourceCapabilities).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'DIFF_HUNK', state: 'UNSUPPORTED', reason: expect.stringContaining('atomic')})]));
  await expect(workbench.capture({commandId: 'no-diff-witness', source: {kind: 'DIFF_HUNK', sourceId: 'd'.repeat(64), sourceRevision: 'r1', logicalOwner: f.owner, contentDigest: 'a'.repeat(64), capturedAt: f.thread.createdAt, path: 'a.ts', comparison: {kind: 'local', scope: 'worktree'}, range: {encoding: 'DIFF_LINES_1_BASED', startLine: 1, endLine: 3}}})).rejects.toMatchObject({code: 'SOURCE_UNSUPPORTED'});
  expect(f.store.all('sourceCapture', f.thread.id)).toEqual([]);
});

it('labels quoted assistant claims as reported and leaves unmeasured evidence freshness unknown', async () => {
  const f = fixture(), workbench = f.workbench(), captured = await workbench.capture({commandId: 'claim-capture', source: f.source});
  f.store.internal('fixture.check', f.thread.id, () => f.store.put('checkObservation', 'observed-check', f.thread.id, {version: 1, checkId: 'observed-check', executionId: 'execution-a', owner: {...f.owner, runId: null, epoch: 0, accountBinding: null}, codeDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64), recipeDigest: 'c'.repeat(64), environmentId: 'environment-a', argv: ['node', 'check.mjs'], cwdIdentity: 'fixture-workspace', phase: 'TEST', startedAt: f.thread.createdAt, endedAt: f.thread.createdAt, exitCode: 0, outcome: 'PASS', artifactRefs: ['retained/check.log', 'retained/check.png'], observationKind: 'process'}));
  const evidence = await workbench.evidence(f.thread.id);
  expect(evidence.items.find(item => item.id === captured.ref.captureId)).toMatchObject({grade: 'REPORTED', sourceRef: expect.objectContaining({captureId: captured.ref.captureId})});
  expect(evidence.items.find(item => item.id === 'observed-check')).toMatchObject({grade: 'OBSERVED', freshness: 'UNKNOWN', command: ['node', 'check.mjs'], sourceRevision: 'a'.repeat(64), logRefs: ['retained/check.log'], screenshotRefs: ['retained/check.png']});
});

it('reads complete authorized activity beyond the mounted window and rejects stale or foreign rows', async () => {
  const f = fixture(), workbench = f.workbench();
  expect(workbench).toHaveProperty('readOutput');
  const messages = [{id: 'log-a', content: Array.from({length: 100000}, (_, index) => 'line ' + index).join('\n')}];
  f.store.internal('fixture.output', f.thread.id, () => {for (const message of messages) f.store.put('message', message.id, f.thread.id, {...f.assistant, ...message, role: 'activity'});});
  const request = {logicalOwner: f.owner, messageIds: messages.map(message => message.id), sourceRevision: sha(JSON.stringify(messages))};
  const result = workbench.readOutput(request);
  expect(result).toMatchObject({logicalOwner: f.owner, sourceId: 'log-a', sourceRevision: request.sourceRevision, complete: true});
  expect(result.rows).toHaveLength(100000); expect(result.rows[99999]).toEqual({id: 'log-a:99999', text: 'line 99999'});
  expect(() => workbench.readOutput({...request, sourceRevision: 'a'.repeat(64)})).toThrowError(expect.objectContaining({code: 'STALE_SOURCE'}));
  expect(() => workbench.readOutput({...request, logicalOwner: {...f.owner, workspaceId: 'other'}})).toThrowError(expect.objectContaining({code: 'CAPABILITY_DENIED'}));
  expect(() => workbench.readOutput({...request, messageIds: [f.assistant.id]})).toThrowError(expect.objectContaining({code: 'CAPABILITY_DENIED'}));
  f.store.internal('fixture.foreign-output', 'other', () => f.store.put('message', 'log-a', 'other', {...f.assistant, ...messages[0], role: 'activity', threadId: 'other'}));
  expect(() => workbench.readOutput(request)).toThrowError(expect.objectContaining({code: 'CAPABILITY_DENIED'}));
});

it('rejects missing, duplicate and oversized full activity reads rather than returning partial copy data', async () => {
  const f = fixture(), workbench = f.workbench(); expect(workbench).toHaveProperty('readOutput');
  const payload = {logicalOwner: f.owner, messageIds: ['log-missing'], sourceRevision: 'a'.repeat(64)};
  expect(() => workbench.readOutput(payload)).toThrowError(expect.objectContaining({code: 'CAPABILITY_DENIED'}));
  expect(() => workbench.readOutput({...payload, messageIds: ['log-a', 'log-a']})).toThrow();
  f.store.internal('fixture.large-output', f.thread.id, () => f.store.put('message', 'log-big', f.thread.id, {...f.assistant, id: 'log-big', role: 'activity', content: 'x'.repeat(4 * 1024 * 1024 + 1)}));
  expect(() => workbench.readOutput({...payload, messageIds: ['log-big']})).toThrowError(expect.objectContaining({code: 'RESOURCE_LIMIT'}));
});

it('preserves a terminal newline in a complete 100000-line authorized output', async () => {
  const f = fixture(), workbench = f.workbench(), messages = [{id: 'log-newline', content: 'line\n'.repeat(100000)}];
  f.store.internal('fixture.output-newline', f.thread.id, () => f.store.put('message', messages[0].id, f.thread.id, {...f.assistant, ...messages[0], role: 'activity'}));
  const result = workbench.readOutput({logicalOwner: f.owner, messageIds: [messages[0].id], sourceRevision: sha(JSON.stringify(messages))});
  expect(result.rows).toHaveLength(100000); expect(result.trailingNewline).toBe(true);
  expect(result.rows.map(row => row.text).join('\n') + '\n').toBe(messages[0].content);
});

it('does not commit a capture or disclose retained text after its account owner changes', async () => {
  const f = fixture(), workbench = f.workbench();
  const pending = workbench.capture({commandId: 'capture-account-race', source: f.source});
  f.store.internal('fixture.account-replace', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, accountId: 'replacement-account'}));
  await expect(pending).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('sourceCapture', f.thread.id)).toEqual([]);
});

it('rechecks the workbench flag before committing a source-free queued send after model discovery', async () => {
  const f = fixture(); f.workbench(); const models = f.runtime.models;
  vi.spyOn(f.runtime, 'models').mockImplementationOnce(async options => {__setCapabilityFlagForTests('ui.sourceWorkbenchV1', false); return models(options);});
  await expect(f.send('disabled-queue', [], 'AFTER_CURRENT')).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
  expect(f.store.all('outbox', f.thread.id)).toEqual([]);
});

it('returns the accepted receipt for a concurrent retry that finishes model discovery after dispatch', async () => {
  const f = fixture(), captured = await f.workbench().capture({commandId: 'concurrent-capture', source: f.source});
  let release!: () => void, count = 0; const gate = new Promise<void>(resolve => {release = resolve;}), models = f.runtime.models;
  vi.spyOn(f.runtime, 'models').mockImplementation(async options => {if (++count === 2) await gate; return models(options);});
  const first = f.send('concurrent-send', [captured.ref]), retry = f.send('concurrent-send', [captured.ref]);
  try {const receipt = await first; await vi.waitFor(() => expect(f.starts).toHaveLength(1)); release(); expect(await retry).toEqual(receipt); expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);} finally {release(); await Promise.allSettled([first, retry]);}
});

it('drains multiple persisted NOW inputs through ordinary follow-up delivery when M04 is disabled', async () => {
  const f = fixture({requestContextEnabled: false}), captured = await f.workbench().capture({commandId: 'batch-capture', source: f.source});
  f.store.internal('fixture.persisted-batch', f.thread.id, () => {
    f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, modelId: 'test/model'});
    for (const id of ['saved-one', 'saved-two']) f.store.put('outbox', id, f.thread.id, {id, threadId: f.thread.id, content: id, status: 'persisted', runId: null, sourceRefs: [captured.ref]});
  });
  await f.service.deliverOutbox(f.thread.id);
  expect(f.starts).toHaveLength(1); expect(f.followUps).toHaveLength(1); expect(f.followUps[0].inputId).toBe('saved-two');
});

it('keeps the flag off by default and retains saved-source read access after rollback', async () => {
  const f = fixture();
  expect(() => capabilityEnabled('ui.sourceWorkbenchV1')).not.toThrow(); expect(capabilityEnabled('ui.sourceWorkbenchV1')).toBe(false);
  const workbench = f.workbench(), captured = await workbench.capture({commandId: 'rollback-capture', source: f.source});
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  expect(await workbench.open({logicalOwner: f.owner, ref: captured.ref})).toMatchObject({text: '😀', state: 'CURRENT'});
  await expect(workbench.capture({commandId: 'disabled-capture', source: f.source})).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('reads only request receipts bound to the current logical owner and account', async () => {
  const f = fixture({requestContextEnabled: true}), workbench = f.workbench();
  await f.send('context-owner-send', []); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  expect(workbench).toHaveProperty('context');
  expect(workbench.context(f.thread.id)).toMatchObject({logicalOwner: f.owner, state: 'AVAILABLE', requestContext: {receipt: {requestId: f.starts[0].requestContext!.requestId}}});
  f.store.internal('fixture.context-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.store.get<Thread>('thread', f.thread.id)!, accountId: 'replacement-account'}));
  expect(workbench.context(f.thread.id)).toEqual({logicalOwner: f.owner, state: 'EMPTY', requestContext: null});
});

it('denies evidence assembled across an account change', async () => {
  const f = fixture(), workbench = f.workbench(); await workbench.capture({commandId: 'evidence-account-capture', source: f.source});
  const open = workbench.open.bind(workbench);
  vi.spyOn(workbench, 'open').mockImplementationOnce(async raw => {
    const result = await open(raw);
    f.store.internal('fixture.evidence-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.thread, accountId: 'replacement-account'}));
    return result;
  });
  await expect(workbench.evidence(f.thread.id)).rejects.toMatchObject({code: 'CAPABILITY_DENIED'});
});

it('uses the existing authenticated host and CSRF boundaries for captures and source reads', async () => {
  const f = fixture(); f.workbench(); const {buildServer} = await import('../apps/server/server.ts'); const app = await buildServer(f.service, {port: 4317, dev: false}); cleanup.push(() => app.close());
  const host = {host: '127.0.0.1:4317'}, boot = await app.inject({url: '/api/bootstrap', headers: host});
  const headers = {...host, cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  const url = '/api/workbench/sources/capture', payload = {commandId: 'http-capture', source: f.source};
  expect((await app.inject({method: 'POST', url, headers: host, payload})).statusCode).toBe(401);
  expect((await app.inject({method: 'POST', url, headers: {...headers, 'x-harness-csrf': ''}, payload})).statusCode).toBe(403);
  expect((await app.inject({method: 'POST', url, headers: {...headers, origin: 'https://foreign.invalid'}, payload})).statusCode).toBe(403);
  const result = await app.inject({method: 'POST', url, headers, payload}); expect(result.statusCode).toBe(200); expect(result.headers['cache-control']).toBe('no-store'); expect(result.json().preview).toBe('😀');
  expect((await app.inject({url: '/api/workbench/threads/' + f.thread.id + '/evidence', headers})).statusCode).toBe(200);
});

it('composes unrelated host routes without exposing workbench APIs when its owning service is absent', async () => {
  const f = fixture(), {buildServer} = await import('../apps/server/server.ts');
  const app = await buildServer({store: f.store, models: f.runtime.models} as unknown as Service, {port: 4317, dev: false}); cleanup.push(() => app.close());
  const host = {host: '127.0.0.1:4317'}, boot = await app.inject({url: '/api/bootstrap', headers: host});
  const headers = {...host, cookie: String(boot.headers['set-cookie']).split(';')[0], 'x-harness-csrf': boot.json().csrfToken};
  expect((await app.inject({url: '/api/models', headers})).statusCode).toBe(200);
  expect((await app.inject({url: '/api/workbench/threads/' + f.thread.id, headers})).statusCode).toBe(404);
  expect((await app.inject({method: 'POST', url: '/api/workbench/sources/capture', headers, payload: {commandId: 'absent-service-capture', source: f.source}})).statusCode).toBe(404);
  expect(f.store.all('sourceCapture')).toEqual([]);
});

it.each(['rollback', 'revoked'] as const)('reports definitive %s source rejection, then admits an ordinary edited send', async reason => {
  const f = fixture(), captured = await f.workbench().capture({commandId: 'rejected-capture', source: f.source});
  if (reason === 'rollback') __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  else f.store.internal('fixture.revoke-message-owner', 'other', () => f.store.put('message', f.assistant.id, 'other', {...f.assistant, threadId: 'other'}));
  await expect(f.send('rejected-source-send', [captured.ref])).rejects.toMatchObject({code: 'CAPABILITY_DENIED', details: {sendAccepted: false}});
  expect(f.store.get('outbox', 'rejected-source-send')).toBeNull();
  const accepted = await f.send('edited-ordinary-send', []); expect(accepted.result).toMatchObject({inputId: 'edited-ordinary-send'});
  await vi.waitFor(() => expect(f.starts).toHaveLength(1)); expect(f.starts[0].sourceRefs).toBeUndefined();
});

it('coalesces same-command admission so a concurrent retry cannot report rejection while the first can commit', async () => {
  const f = fixture(), captured = await f.workbench().capture({commandId: 'coalesced-capture', source: f.source});
  let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => {release = resolve;}), began = new Promise<void>(resolve => {entered = resolve;});
  const models = f.runtime.models, spy = vi.spyOn(f.runtime, 'models').mockImplementationOnce(async options => {entered(); await gate; return models(options);});
  const first = f.send('coalesced-send', [captured.ref]); await began; __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  let settled = false; const retry = f.send('coalesced-send', [captured.ref]).then(value => {settled = true; return value;}, error => {settled = true; return error;});
  try {await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false); expect(spy).toHaveBeenCalledTimes(1); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); release(); expect(await retry).toEqual(await first); expect(f.store.all('outbox', f.thread.id)).toHaveLength(1);}
  finally {__setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); release(); await Promise.allSettled([first, retry]);}
});

async function blockedQueuedSource(requestContextEnabled = false) {
  const f = fixture({requestContextEnabled}), workbench = f.workbench(), captured = await workbench.capture({commandId: 'blocked-capture', source: f.source});
  await f.send('blocking-first', []); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  await f.send('blocked-queued', [captured.ref], 'AFTER_CURRENT');
  f.store.internal('fixture.stale-queued', f.thread.id, () => f.store.put('message', f.assistant.id, f.thread.id, {...f.assistant, content: 'A later source revision'}));
  const active = f.starts[0]; f.event({...active, type: 'input.processing', inputIds: ['blocking-first']});
  await f.service.tool({name: 'task_finish', args: {summary: 'The first input is complete'}}, active); f.event({...active, type: 'settled'});
  await vi.waitFor(() => expect(f.store.get<Thread>('thread', f.thread.id)?.status).toBe('interrupted'));
  return {...f, workbench, captured};
}

it.each([false, true])('explicitly retains a blocked accepted input without automatic resume (M04 %s)', async custody => {
  const f = await blockedQueuedSource(custody); expect(f.workbench).toHaveProperty('inputs'); expect(f.workbench).toHaveProperty('recoverInput');
  const inspected = await f.workbench.inputs(f.thread.id);
  expect(inspected.inputs).toEqual([expect.objectContaining({inputId: 'blocked-queued', state: 'BLOCKED', canKeepCaptured: true, canCancel: true, sourceRefs: [f.captured.ref]})]);
  const request = {commandId: 'keep-accepted', logicalOwner: f.owner, inputId: 'blocked-queued', action: 'KEEP_CAPTURED' as const};
  const receipt = await f.workbench.recoverInput(request); expect(receipt.result).toEqual({inputId: 'blocked-queued', action: 'KEEP_CAPTURED', resumeRequired: true});
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  expect(await f.workbench.recoverInput(request)).toEqual(receipt); expect(f.starts).toHaveLength(1);
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true);
  await f.service.deliverOutbox(f.thread.id); expect(f.starts).toHaveLength(1);
  await f.service.command({id: 'explicit-recovery-resume', type: 'run.resume', threadId: f.thread.id, payload: {modelId: 'test/model'}});
  await vi.waitFor(() => expect(f.starts).toHaveLength(2));
  expect(f.starts[1]).toMatchObject({inputId: 'blocked-queued', sourceRefs: [{...f.captured.ref, keepCaptured: true}]});
  expect(f.store.all<Message>('message', f.thread.id).find(message => message.role === 'user' && message.sourceRefs?.length)?.sourceRefs).toEqual([f.captured.ref]);
});

it('cancels only a proven undispatched accepted input after rollback and preserves its canonical message', async () => {
  const f = await blockedQueuedSource(); expect(f.workbench).toHaveProperty('recoverInput');
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  await expect(f.workbench.recoverInput({commandId: 'disabled-keep-accepted', logicalOwner: f.owner, inputId: 'blocked-queued', action: 'KEEP_CAPTURED'})).rejects.toMatchObject({code: 'CAPABILITY_DENIED', details: {recoveryAccepted: false}});
  const request = {commandId: 'cancel-accepted', logicalOwner: f.owner, inputId: 'blocked-queued', action: 'CANCEL' as const};
  const receipt = await f.workbench.recoverInput(request); expect(await f.workbench.recoverInput(request)).toEqual(receipt);
  expect(f.store.get('outbox', 'blocked-queued')).toMatchObject({status: 'handled', runId: null, enteredRuntime: false});
  expect(f.store.all<Message>('message', f.thread.id).filter(message => message.role === 'user')).toHaveLength(2);
  expect((await f.workbench.inputs(f.thread.id)).inputs).toEqual([]); expect(f.starts).toHaveLength(1);
});

it.each(['CANCEL', 'KEEP_CAPTURED'] as const)('does not dispatch an old input snapshot after concurrent %s recovery', async action => {
  const f = fixture(), workbench = f.workbench(), captured = await workbench.capture({commandId: 'cancel-race-capture', source: f.source});
  expect(workbench).toHaveProperty('recoverInput');
  await f.send('cancel-race-first', []); await vi.waitFor(() => expect(f.starts).toHaveLength(1)); await f.send('cancel-race-queued', [captured.ref], 'AFTER_CURRENT');
  let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => {release = resolve;}), began = new Promise<void>(resolve => {entered = resolve;}), prepare = workbench.prepareSend.bind(workbench);
  vi.spyOn(workbench, 'prepareSend').mockImplementation(async (owner, refs, options) => {const result = await prepare(owner, refs, options); if (options?.accepted) {entered(); await gate;} return result;});
  const active = f.starts[0]; f.event({...active, type: 'input.processing', inputIds: ['cancel-race-first']}); await f.service.tool({name: 'task_finish', args: {summary: 'Done'}}, active); f.event({...active, type: 'settled'});
  await began;
  try {await workbench.recoverInput({commandId: 'cancel-while-preparing', logicalOwner: f.owner, inputId: 'cancel-race-queued', action});} finally {release();}
  await f.service.deliverOutbox(f.thread.id);
  expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]); expect(f.store.get('outbox', 'cancel-race-queued')).toMatchObject({status: action === 'CANCEL' ? 'handled' : 'persisted', runId: null, sourceRecovery: {resumeRequired: action === 'KEEP_CAPTURED'}});
});

it('coalesces recovery retries while retained-source authorization is pending', async () => {
  const f = await blockedQueuedSource(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), began = new Promise<void>(resolve => {entered = resolve;}), prepare = f.workbench.prepareSend.bind(f.workbench);
  const spy = vi.spyOn(f.workbench, 'prepareSend').mockImplementationOnce(async (...args) => {const result = await prepare(...args); entered(); await gate; return result;});
  const request = {commandId: 'coalesced-recovery', logicalOwner: f.owner, inputId: 'blocked-queued', action: 'KEEP_CAPTURED' as const};
  const first = f.workbench.recoverInput(request); await began; __setCapabilityFlagForTests('ui.sourceWorkbenchV1', false);
  let settled = false; const retry = f.workbench.recoverInput(request).then(value => {settled = true; return value;}, error => {settled = true; return error;});
  try {await new Promise(resolve => setTimeout(resolve, 0)); expect(settled).toBe(false); expect(spy).toHaveBeenCalledTimes(1); __setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); release(); expect(await retry).toEqual(await first);}
  finally {__setCapabilityFlagForTests('ui.sourceWorkbenchV1', true); release(); await Promise.allSettled([first, retry]);}
});

it('hides prior-account capture identities and denies recovery once runtime delivery has started', async () => {
  const f = fixture(), workbench = f.workbench(), captured = await workbench.capture({commandId: 'private-input-capture', source: f.source});
  expect(workbench).toHaveProperty('inputs'); expect(workbench).toHaveProperty('recoverInput');
  await f.send('private-input-send', [captured.ref]); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  await expect(workbench.recoverInput({commandId: 'unsafe-cancel', logicalOwner: f.owner, inputId: 'private-input-send', action: 'CANCEL'})).rejects.toMatchObject({code: 'INPUT_RECOVERY_UNAVAILABLE'});
  f.store.internal('fixture.private-input-account', f.thread.id, () => f.store.put('thread', f.thread.id, f.thread.id, {...f.store.get<Thread>('thread', f.thread.id)!, accountId: 'replacement-account'}));
  const inspected = await workbench.inputs(f.thread.id); expect(inspected.inputs[0]).toMatchObject({canKeepCaptured: false, canCancel: false}); expect(inspected.inputs[0].sourceRefs).toBeUndefined();
  expect(JSON.stringify(inspected)).not.toContain(captured.ref.captureId);
});

it.each([null, 'prior-account'])('grades a requirement only from linked evidence authorized to the current account (%s)', async accountBinding => {
  const f = fixture(), workbench = f.workbench(); writeFileSync(join(f.root, 'app.ts'), 'export const value = 1;'); writeFileSync(join(f.root, 'lock.yaml'), 'version: 1');
  const codeDigest = sourceDigestSync(f.root, ['app.ts']), dependencyDigest = sourceDigestSync(f.root, ['lock.yaml']), environmentId = 'test-environment';
  const observation: CheckObservationV1 = {version: 1, checkId: 'owned-check', executionId: 'owned-execution', owner: {...f.owner, runId: null, epoch: 0, accountBinding}, codeDigest, dependencyDigest, recipeDigest: 'a'.repeat(64), environmentId, argv: ['node', 'check.mjs'], cwdIdentity: f.root, phase: 'TEST', startedAt: f.thread.createdAt, endedAt: f.thread.createdAt, exitCode: 0, outcome: 'PASS', artifactRefs: ['check.log'], observationKind: 'process'};
  const requirements = [{id: 'requires-current-owner', checkRefs: [observation.checkId]}];
  const assessment = computeAssessment({threadId: f.thread.id, sourceCut: {headSha: null, codeDigest, dependencyDigest, environmentId}, requirements, observations: [observation], unresolvedEffects: [], verifierIdentity: 'test', provenance: 'actual stored assessment fixture'});
  f.store.internal('fixture.owned-evidence', f.thread.id, () => {f.store.put('verificationDeclaration', f.thread.id, f.thread.id, {version: 1, rootPath: f.root, sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], environmentId, requirements}); f.store.put('checkObservation', observation.checkId, f.thread.id, observation); f.store.put('assessment', assessment.assessmentId, f.thread.id, assessment);});
  const evidence = await workbench.evidence(f.thread.id), requirement = evidence.items.find(item => item.kind === 'REQUIREMENT');
  expect(requirement).toMatchObject(accountBinding === null ? {grade: 'VERIFIED', freshness: 'CURRENT', outcome: 'VERIFIED'} : {grade: 'REPORTED', freshness: 'UNKNOWN', outcome: 'UNVERIFIED'});
});

it('does not verify an execution when a bound failure falls outside the displayed observation window', async () => {
  const f = fixture(), workbench = f.workbench();
  writeFileSync(join(f.root, 'app.ts'), 'export const value = 1;'); writeFileSync(join(f.root, 'lock.yaml'), 'version: 1');
  const codeDigest = sourceDigestSync(f.root, ['app.ts']), dependencyDigest = sourceDigestSync(f.root, ['lock.yaml']), environmentId = 'test-environment';
  const observations: CheckObservationV1[] = Array.from({length: 101}, (_, index) => ({
    version: 1, checkId: index === 0 ? 'early-bound-failure' : `later-bound-pass-${index}`, executionId: 'bounded-execution',
    owner: {...f.owner, runId: null, epoch: 0, accountBinding: null}, codeDigest, dependencyDigest, recipeDigest: 'a'.repeat(64), environmentId,
    argv: ['node', 'check.mjs'], cwdIdentity: f.root, phase: 'TEST', startedAt: f.thread.createdAt, endedAt: f.thread.createdAt,
    exitCode: index === 0 ? 1 : 0, outcome: index === 0 ? 'FAIL' : 'PASS', artifactRefs: [], observationKind: 'process',
  }));
  const requirements = [{id: 'requires-complete-execution', checkRefs: ['bounded-execution']}];
  const assessment = computeAssessment({threadId: f.thread.id, sourceCut: {headSha: null, codeDigest, dependencyDigest, environmentId}, requirements, observations, unresolvedEffects: [], verifierIdentity: 'test', provenance: 'complete authorized assessment fixture'});
  expect(assessment.requirements[0].assessment).toBe('FAILED');
  f.store.internal('fixture.bounded-evidence', f.thread.id, () => {
    f.store.put('verificationDeclaration', f.thread.id, f.thread.id, {version: 1, rootPath: f.root, sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], environmentId, requirements});
    for (const observation of observations) f.store.put('checkObservation', observation.checkId, f.thread.id, observation);
    f.store.put('assessment', assessment.assessmentId, f.thread.id, assessment);
  });
  const evidence = await workbench.evidence(f.thread.id), requirement = evidence.items.find(item => item.kind === 'REQUIREMENT');
  expect(evidence.items.filter(item => item.kind === 'CHECK').length).toBeLessThanOrEqual(100);
  expect(requirement?.grade).not.toBe('VERIFIED');
  expect(requirement?.outcome).not.toBe('VERIFIED');
  expect(requirement).toMatchObject({grade:'REPORTED',freshness:'UNKNOWN',outcome:'UNVERIFIED_PARTIAL'});
  expect(evidence.items.find(item=>item.id==='verification-partial')).toMatchObject({outcome:'PARTIAL'});
});


it.each([
  {entered: true, action: 'CANCEL'}, {entered: true, action: 'KEEP_CAPTURED'},
  {entered: false, action: 'CANCEL'}, {entered: false, action: 'KEEP_CAPTURED'},
] as const)('retains prior delivery uncertainty after resumed finalization fails ($entered, $action)', async ({entered, action}) => {
  let failFinalize = false, finalizes = 0;
  const f = fixture({requestContextEnabled: true, requestContextHooks: {finalize: async () => {finalizes++; if (failFinalize) throw Error('Resumed preparation failed'); return {sources: []};}}});
  const workbench = f.workbench(), captured = await workbench.capture({commandId: 'prior-delivery-capture', source: f.source});
  await f.send('prior-delivery-input', [captured.ref]); await vi.waitFor(() => expect(f.starts).toHaveLength(1));
  if (entered) f.event({...f.starts[0], type: 'input.processing', inputIds: ['prior-delivery-input']});
  expect(f.store.get('outbox', 'prior-delivery-input')).toMatchObject({runId: f.starts[0].runId, enteredRuntime: entered});
  await f.service.command({id: 'stop-prior-delivery', type: 'run.stop', threadId: f.thread.id, payload: {}});
  failFinalize = true;
  await f.service.command({id: 'resume-prior-delivery', type: 'run.resume', threadId: f.thread.id, payload: {modelId: 'test/model'}});
  await vi.waitFor(() => expect(f.service.thread(f.thread.id).status).toBe('interrupted'));
  expect(finalizes).toBe(2); expect(f.starts).toHaveLength(1); expect(f.followUps).toEqual([]);
  expect(f.store.get('outbox', 'prior-delivery-input')).toMatchObject({runId: expect.any(String), sourceRefs: [captured.ref]});
  expect((await workbench.inputs(f.thread.id)).inputs).toEqual([expect.objectContaining({inputId: 'prior-delivery-input', canCancel: false, canKeepCaptured: false})]);
  await expect(workbench.recoverInput({commandId: 'unsafe-prior-recovery', logicalOwner: f.owner, inputId: 'prior-delivery-input', action})).rejects.toMatchObject({code: 'INPUT_RECOVERY_UNAVAILABLE'});
  expect(f.store.get('outbox', 'prior-delivery-input')).toMatchObject({status: 'processing', sourceRefs: [captured.ref]});
});

it.each(['CANCEL', 'KEEP_CAPTURED'] as const)('allows %s recovery after a first finalization fails before runtime', async action => {
  const f = fixture({requestContextEnabled: true, requestContextHooks: {finalize: async () => {throw Error('Initial preparation failed');}}});
  const workbench = f.workbench(), captured = await workbench.capture({commandId: 'never-delivered-capture', source: f.source});
  await f.send('never-delivered-input', [captured.ref]);
  await vi.waitFor(() => expect(f.service.thread(f.thread.id).status).toBe('interrupted'));
  expect(f.starts).toEqual([]); expect(f.followUps).toEqual([]);
  expect(f.store.get('outbox', 'never-delivered-input')).toMatchObject({runId: null, enteredRuntime: false});
  expect((await workbench.inputs(f.thread.id)).inputs).toEqual([expect.objectContaining({inputId: 'never-delivered-input', canCancel: true, canKeepCaptured: true})]);
  expect(await workbench.recoverInput({commandId: 'safe-first-recovery', logicalOwner: f.owner, inputId: 'never-delivered-input', action})).toMatchObject({result: {inputId: 'never-delivered-input', action, resumeRequired: action === 'KEEP_CAPTURED'}});
  expect(f.starts).toEqual([]); expect(f.followUps).toEqual([]);
});
