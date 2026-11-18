import {afterEach, expect, it, vi} from 'vitest';
import {lstatSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {ProjectVerificationService, recipeApprovalCommitment, recipeDigest, sourceDigestSync, type LaunchedProcess, type VerificationLauncher} from '../packages/core/project-verification.ts';
import type {BrowserDriver} from '../packages/core/browser-verification.ts';
import {browserChecklistSchema, verificationRecipeV1Schema, type VerificationRecipeV1} from '../packages/contracts/verification.ts';
import type {ToolOwner} from '../packages/contracts/tool-effects.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) cleanup();});
const owner: ToolOwner = {threadId: 'managed-task', runId: 'run-1', epoch: 1, projectId: null, workspaceId: null, accountBinding: null};
function fixture(names: VerificationRecipeV1['phases'][number]['name'][] = ['BUILD', 'TEST'], timeoutMs = 60_000) {
  const root = mkdtempSync(join(tmpdir(), 'managed-recipe-')), store = new Store(join(root, 'state'));
  cleanups.push(() => {store.close(); rmSync(root, {recursive: true, force: true});});
  writeFileSync(join(root, 'app.ts'), 'export const ready = true;\n'); writeFileSync(join(root, 'lock.yaml'), 'version: 1\n');
  const stamp = new Date().toISOString(), stat = lstatSync(root, {bigint: true});
  const parsed = verificationRecipeV1Schema.parse({version: 1, recipeId: 'managed-recipe', revision: 1, createdAt: stamp,
    workspaceIdentity: {canonicalPath: root, dev: String(stat.dev), ino: String(stat.ino)}, approvedDigest: '0'.repeat(64), environment: {platform: process.platform, nodeVersion: process.version, packageManager: null},
    phases: names.map(name => ({name, executableId: name.toLowerCase(), argv: [], relativeCwd: '.', environmentRefs: [], timeoutMs})),
  });
  const recipe = {...parsed, approvedDigest: recipeDigest(parsed)};
  store.internal('fixture.owner', owner.threadId, () => {
    store.put('thread', owner.threadId, owner.threadId, {id: owner.threadId, title: 'Managed recipe', projectName: null, modelId: null, sessionPath: null, createdAt: stamp, updatedAt: stamp, runId: owner.runId, epoch: owner.epoch, status: 'working'});
    // This low-level runner fixture does not claim ordinary operation approval or native backend proof.
    store.put('approval', 'fixture-recipe-approval', owner.threadId, {approvalId: 'fixture-recipe-approval', operationId: 'fixture-op', actionCommitment: recipeApprovalCommitment(recipe), owner, targetPreconditions: [], issuedAt: stamp, expiresAt: new Date(Date.now() + 900_000).toISOString(), remainingUses: 1, issuer: 'fixture'});
  });
  const service = new ProjectVerificationService(store, {HARNESS_FLAG_VERIFICATION_WORKFLOW_V1: '1'});
  service.registerRecipe(recipe, 'fixture-recipe-approval', owner);
  const request = {recipeId: recipe.recipeId, sourceFiles: ['app.ts'], dependencyFiles: ['lock.yaml'], readiness: {host: '127.0.0.1' as const, port: 4100, path: '/health'}};
  const sourceCut = {codeDigest: sourceDigestSync(root, request.sourceFiles), dependencyDigest: sourceDigestSync(root, request.dependencyFiles)};
  const events: string[] = [], processes: LaunchedProcess[] = [];
  let start!: () => void; const started = new Promise<void>(resolve => {start = resolve;});
  const launcher: VerificationLauncher = {launch: async input => {
    events.push(input.executableId); let stop!: (result: Awaited<ReturnType<LaunchedProcess['wait']>>) => void;
    const wait = input.executableId === 'start' ? new Promise<Awaited<ReturnType<LaunchedProcess['wait']>>>(resolve => {stop = resolve;}) : Promise.resolve({exitCode: 0, termination: 'NONE' as const});
    const process: LaunchedProcess = {pid: 200 + processes.length, tree: async () => [process.pid], wait: () => wait, log: async () => ({text: 'Observed fixture output', truncated: false}), terminate: async () => {events.push('terminate:' + input.executableId); stop?.({exitCode: 143, termination: 'CANCELLED'});}};
    processes.push(process); if (input.executableId === 'start') start(); return process;
  }};
  const control = {signal: new AbortController().signal, assertCurrent: () => {}, environmentId: 'host-observed-environment', expectedSource: sourceCut, cleanup: vi.fn(async () => {events.push('session-close');})};
  return {root, store, service, recipe, request, sourceCut, launcher, processes, events, started, control};
}

it('runs the approved browser checklist while its owned server is live, then closes browser, server and executor', async () => {
  const f = fixture(['BUILD', 'TEST', 'START', 'READINESS', 'BROWSER', 'TEARDOWN']); vi.useFakeTimers();
  const driver: BrowserDriver = {launch: async () => {
    f.events.push('browser-open'); expect(f.events).not.toContain('terminate:start');
    return {page: {url: () => 'http://127.0.0.1:4100/', goto: async () => {}, click: async () => {}, type: async () => {}, text: async () => 'Ready', visible: async () => true, screenshot: async () => {throw Error('not requested');}}, observedOrigins: () => ['http://127.0.0.1:4100'], collectedFailures: () => ({console: [], network: []}), close: async () => {f.events.push('browser-close');}};
  }};
  const checklist = browserChecklistSchema.parse({version: 1, checklistId: 'ready', approvedOrigins: ['http://127.0.0.1:4100'], viewport: {width: 800, height: 600}, items: ['ready'], steps: [{kind: 'ASSERT_TEXT', selector: 'h1', text: 'Ready', checklistItemId: 'ready'}]});
  const pending = f.service.runRecipe(owner, f.request, f.launcher, {probe: async () => {f.events.push('probe'); return {reachable: true, ownerPid: f.processes.at(-1)!.pid};}}, {...f.control, browser: {driver, checklist, profileDir: join(f.root, 'fixture-profile')}});
  await f.started; await vi.advanceTimersByTimeAsync(2_000); const result = await pending;
  expect(result.outcome).toBe('PASS'); expect(f.events.indexOf('browser-open')).toBeGreaterThan(f.events.indexOf('probe'));
  expect(f.events.indexOf('browser-close')).toBeLessThan(f.events.indexOf('terminate:start')); expect(f.events.at(-1)).toBe('session-close');
  expect(result.observations.some(value => 'checklistItemId' in value && value.checklistItemId === 'ready' && value.outcome === 'PASS')).toBe(true);
  expect(result.observations.every(value => value.environmentId === f.control.environmentId)).toBe(true);
});

it.each(['app.ts', 'lock.yaml'])('a mid-check %s change retains the executed result, records drift and prevents later phases', async file => {
  const f = fixture();
  const launcher: VerificationLauncher = {launch: async input => {const process = await f.launcher.launch(input); return {...process, wait: async () => {writeFileSync(join(f.root, file), 'changed during the check\n'); return {exitCode: 0, termination: 'NONE'};}};}};
  const result = await f.service.runRecipe(owner, f.request, launcher, undefined, f.control);
  expect(result.outcome).toBe('BLOCKED'); expect(f.events).not.toContain('test'); expect(f.control.cleanup).toHaveBeenCalledTimes(1);
  expect(result.observations.some(value => value.phase === 'BUILD' && value.outcome === 'PASS' && value.codeDigest === f.sourceCut.codeDigest)).toBe(true);
  expect(result.observations.some(value => value.outcome === 'BLOCKED' && value.detail?.includes('BLOCKED_SOURCE_DRIFT'))).toBe(true);
});

it('cancellation interrupts an in-flight process and performs owned cleanup before returning', async () => {
  const f = fixture(), controller = new AbortController(); let entered!: () => void; const started = new Promise<void>(resolve => {entered = resolve;});
  const launcher: VerificationLauncher = {launch: async input => {const process = await f.launcher.launch(input); return {...process, wait: () => {entered(); return new Promise(() => {});}};}};
  const pending = f.service.runRecipe(owner, f.request, launcher, undefined, {...f.control, signal: controller.signal});
  await started; controller.abort(); const result = await pending;
  expect(result.outcome).toBe('CANCELLED'); expect(f.events).toContain('terminate:build'); expect(f.events).not.toContain('test'); expect(f.control.cleanup).toHaveBeenCalledTimes(1);
  expect(result.observations.some(value => value.outcome === 'PASS' && value.phase !== 'TEARDOWN')).toBe(false);
});

it('a managed executor cleanup failure remains execution-wide failed evidence', async () => {
  const f = fixture(['TEST']);
  const result = await f.service.runRecipe(owner, f.request, f.launcher, undefined, {...f.control, cleanup: async () => {throw Error('private browser profile still owned');}});
  expect(result.outcome).toBe('FAIL'); expect(result.cleanupFailures.join(' ')).toContain('private browser profile still owned');
  expect(result.observations.find(value => value.phase === 'TEARDOWN')).toMatchObject({outcome: 'FAIL', environmentId: f.control.environmentId});
});

it('source drift from the exact approved cut prevents every launch', async () => {
  const f = fixture(); writeFileSync(join(f.root, 'app.ts'), 'changed before launch\n');
  await expect(f.service.runRecipe(owner, f.request, f.launcher, undefined, f.control)).rejects.toMatchObject({code: 'BLOCKED_SOURCE_DRIFT'});
  expect(f.processes).toHaveLength(0);
});

it('a late process handle is terminated after its phase deadline and cannot write late artifacts', async () => {
  const f = fixture(['TEST'], 10); vi.useFakeTimers(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const launcher: VerificationLauncher = {launch: async input => {const process = await f.launcher.launch(input); entered(); return new Promise(resolve => {release = () => resolve(process);});}};
  const pending = f.service.runRecipe(owner, f.request, launcher, undefined, f.control);
  await started; await vi.advanceTimersByTimeAsync(10); const result = await pending;
  expect(result.outcome).toBe('FAIL'); release(); await vi.advanceTimersByTimeAsync(0);
  expect(f.events.filter(value => value === 'terminate:test')).toHaveLength(1); expect(f.store.all('verificationArtifact', owner.threadId)).toHaveLength(0);
});

it('owned executor cleanup is bounded even when the backend never settles', async () => {
  const f = fixture(['TEST']); vi.useFakeTimers(); let entered!: () => void; const closing = new Promise<void>(resolve => {entered = resolve;});
  const pending = f.service.runRecipe(owner, f.request, f.launcher, undefined, {...f.control, cleanup: () => {entered(); return new Promise(() => {});}});
  await closing; await vi.advanceTimersByTimeAsync(15_000); const result = await pending;
  expect(result.outcome).toBe('FAIL'); expect(result.cleanupFailures).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
});

it('an owned server that exits during a browser check cannot yield a successful recipe', async () => {
  const f = fixture(['START', 'READINESS', 'BROWSER']); vi.useFakeTimers();
  const checklist = browserChecklistSchema.parse({version: 1, checklistId: 'ready', approvedOrigins: ['http://127.0.0.1:4100'], viewport: {width: 800, height: 600}, items: ['ready'], steps: [{kind: 'ASSERT_TEXT', selector: 'h1', text: 'Ready', checklistItemId: 'ready'}]});
  const driver: BrowserDriver = {launch: async () => ({page: {url: () => 'http://127.0.0.1:4100/', goto: async () => {}, click: async () => {}, type: async () => {}, text: async () => {await f.processes[0].terminate(); return 'Ready';}, visible: async () => true, screenshot: async () => {throw Error('unused');}}, observedOrigins: () => ['http://127.0.0.1:4100'], collectedFailures: () => ({console: [], network: []}), close: async () => {}})};
  const pending = f.service.runRecipe(owner, f.request, f.launcher, {probe: async () => ({reachable: true, ownerPid: f.processes[0].pid})}, {...f.control, browser: {driver, checklist, profileDir: join(f.root, 'fixture-profile')}});
  await f.started; await vi.advanceTimersByTimeAsync(2_000); const result = await pending;
  expect(result.outcome).toBe('FAIL'); expect(result.observations.some(value => value.detail?.includes('START process exited'))).toBe(true);
});
