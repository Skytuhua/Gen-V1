import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {DependencyScanService, DEPENDENCY_SCAN_RESULT, dependencyScopeKey} from '../packages/workspace/dependency-scan.ts';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags.ts';
import {loadDomainTools} from '../packages/runtime-pi/tool-definitions.ts';
import {handleDomainTool, type DomainContext} from '../packages/capabilities/index.ts';
import {workspaceOwnerScope} from '../packages/workspace/edit-journal.ts';
import type {Operation} from '../packages/contracts/index.ts';
import type {DependencyScanResult} from '../packages/contracts/dependency-check.ts';

let root: string, stateDir: string, store: Store;
const projectId = 'proj-1', threadId = 'thread-1';

const put = async (rel: string, content: string) => {
  await mkdir(join(root, rel, '..'), {recursive: true});
  await writeFile(join(root, rel), content);
};
const npmLock = (packages: Record<string, unknown>) => JSON.stringify({name: 'fixture', lockfileVersion: 3, packages});
const publicLock = () => npmLock({
  'node_modules/leftpad': {version: '1.3.0', resolved: 'https://registry.npmjs.org/leftpad/-/leftpad-1.3.0.tgz'},
});
const privateLock = () => npmLock({
  'node_modules/secretlib': {version: '9.9.9', resolved: 'https://registry.internal.example/secretlib/-/secretlib-9.9.9.tgz'},
});
const ownerScope = (pid = projectId, tid: string | undefined = threadId) =>
  workspaceOwnerScope(pid, tid, {id: 'wc-1', path: root, gitDirectory: join(root, '.git'), identity: {dev: 1, ino: 1}});

const sent: {url: string; body?: string}[] = [];
const transport = async (url: string, init: {method: string; body?: string}) => {
  sent.push({url, body: init.body});
  const tuples = url.includes('querybatch') ? JSON.parse(init.body!).queries as {package: {name: string}}[] : [];
  return {
    status: 200, headers: {get: () => null},
    text: async () => JSON.stringify({results: tuples.map(q => q.package.name === 'leftpad' ? {vulns: [{id: 'GHSA-aaaa-0001', modified: '2024-01-01T00:00:00Z'}]} : {})}),
  };
};
const detailTransport = async (url: string, init: {method: string; body?: string}) => {
  sent.push({url, body: init.body});
  if (url.includes('/vulns/')) {
    const advisory = {id: 'GHSA-aaaa-0001', modified: '2024-01-01T00:00:00Z', severity: [{type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'}], affected: [{package: {name: 'leftpad'}, ranges: [{type: 'SEMVER', events: [{introduced: '0'}, {fixed: '1.4.0'}]}]}]};
    return {status: 200, headers: {get: () => null}, text: async () => JSON.stringify(advisory)};
  }
  return transport(url, init);
};

let scan: DependencyScanService;
const makeScan = (overrides: Partial<ConstructorParameters<typeof DependencyScanService>[1]> = {}) =>
  new DependencyScanService(store, {transport: detailTransport, now: () => '2026-11-21T00:00:00.000Z', ...overrides});
const ctxFor = (owner: unknown = {projectId, threadId}) =>
  ({signal: new AbortController().signal, owner: owner as never, authenticatedApprovals: true});
const putOp = (op: Operation) => store.internal('fixture.operation', threadId, () => store.put('operation', op.id, threadId, op));
const approvedOp = async (mutate?: (op: Operation) => void): Promise<Operation> => {
  const op = await scan.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {}});
  if (mutate) mutate(op);
  op.approved = true; op.status = 'running';
  putOp(op);
  return op;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dep-host-'));
  stateDir = await mkdtemp(join(tmpdir(), 'dep-host-state-'));
  store = new Store(stateDir);
  scan = makeScan();
  sent.length = 0;
  __setCapabilityFlagForTests('workspace.dependencyCheckV1', true);
});
afterEach(async () => {
  __setCapabilityFlagForTests('workspace.dependencyCheckV1', undefined);
  store.close();
  await rm(root, {recursive: true, force: true});
  await rm(stateDir, {recursive: true, force: true});
});

describe('flag off', () => {
  beforeEach(() => __setCapabilityFlagForTests('workspace.dependencyCheckV1', false));
  it('prepare and capability are denied, domain tool hidden from discovery and denied', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    await expect(scan.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {}})).rejects.toThrowError(/disabled/i);
    expect(scan.capability(null)).toEqual({available: false});
    const tools = await loadDomainTools();
    expect(tools.some(t => t.name === 'dependency_check_read')).toBe(false);
    await expect(handleDomainTool('dependency_check_read', {}, {} as DomainContext)).rejects.toThrowError(/disabled/i);
  });
  it('executor refuses to send', async () => {
    await expect(scan.execute({id: 'op-x', threadId, revision: 1, kind: 'integration.dependency.scan', args: {}, resourceIds: [], preconditions: {}, description: '', status: 'running', approved: true, createdAt: ''} as Operation, ctxFor())).rejects.toThrowError(/disabled/i);
    expect(sent).toHaveLength(0);
  });
});
describe('flag on discovery/execution gates', () => {
  it('dependency_check_read is discoverable and reads the scoped result', async () => {
    const tools = await loadDomainTools();
    expect(tools.some(t => t.name === 'dependency_check_read')).toBe(true);
    const scope = ownerScope(), key = dependencyScopeKey(scope);
    const result = {scanId: 's1', status: 'complete', checkedAt: '2026-11-21T00:00:00Z', scopeKey: key, inputDigest: 'd'.repeat(64), fresh: true, coverage: [], queriedCount: 1, findings: [], remoteAlerts: [], remoteAlertState: 'not_requested'};
    store.internal('fixture.scan', threadId, () => store.put(DEPENDENCY_SCAN_RESULT, key, threadId, result));
    const out = await handleDomainTool('dependency_check_read', {scanId: 's1'}, {
      threadId, signal: new AbortController().signal,
      readDependencyScan: (id, cursor) => scan.read(scope, {scanId: id, cursor}),
    } as DomainContext);
    expect((out as DependencyScanResult).scanId).toBe('s1');
  });
});
describe('prepare / approval sealing', () => {
  it('declined scan sends nothing; approval binds the exact inventory basis', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await scan.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {}});
    expect(op.status).toBe('prepared');
    expect(op.kind).toBe('integration.dependency.scan');
    expect(op.preconditions.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(op.args)).not.toMatch(/registry\.internal|\.git\/|node_modules\//);
    expect(sent).toHaveLength(0);
  });
  it('private-registry pins never reach the provider', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    await put('lib/package.json', '{}'); await put('lib/package-lock.json', privateLock());
    const op = await approvedOp();
    await scan.execute(op, ctxFor());
    const batches = sent.filter(s => s.url.includes('querybatch'));
    for (const batch of batches) expect(batch.body).not.toContain('secretlib');
    const result = store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, dependencyScopeKey(ownerScope()))!;
    expect(result.coverage.some(c => c.status === 'private_registry')).toBe(true);
  });
});
describe('dispatch revalidation', () => {
  it('owner mismatch denies before any send', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    await expect(scan.execute(op, ctxFor({projectId: 'proj-evil', threadId}))).rejects.toThrowError(/owner/i);
    expect(sent).toHaveLength(0);
  });
  it('manipulated stored args are rejected', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    const tampered = {...op, args: {...(op.args as Record<string, unknown>), root: '/etc'}};
    store.internal('fixture.operation', threadId, () => store.put('operation', op.id, threadId, tampered));
    await expect(scan.execute(op, ctxFor())).rejects.toThrowError(/changed|cancelled/i);
    expect(sent).toHaveLength(0);
  });
  it('stale input digest (lockfile changed after approval) aborts before any send', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    await put('package-lock.json', npmLock({'node_modules/leftpad': {version: '2.0.0', resolved: 'https://registry.npmjs.org/leftpad/-/leftpad-2.0.0.tgz'}}));
    await expect(scan.execute(op, ctxFor())).rejects.toThrowError(/Lockfiles changed/i);
    expect(sent).toHaveLength(0);
  });
  it('cancelled mid-scan writes no result', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const ctrl = new AbortController();
    const slow = async (url: string, init: {signal: AbortSignal}) => { ctrl.abort(); return detailTransport(url, {...init, body: undefined} as never); };
    const scan2 = makeScan({transport: slow});
    const op2 = await scan2.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {}});
    op2.approved = true; op2.status = 'running';
    putOp(op2);
    await expect(scan2.execute(op2, {signal: ctrl.signal, owner: {projectId, threadId} as never, authenticatedApprovals: true})).rejects.toThrowError();
    expect(store.get(DEPENDENCY_SCAN_RESULT, dependencyScopeKey(ownerScope()))).toBeNull();
  });
});
describe('accepted result semantics', () => {
  it('stores a normalized finding page scoped to this owner; no advisory prose or lockfile bytes', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    const out = await scan.execute(op, ctxFor()) as DependencyScanResult;
    expect(out.status).toBe('complete');
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].advisoryIds).toEqual(['GHSA-aaaa-0001']);
    expect(out.findings[0].fixedVersions).toContain('1.4.0');
    expect(JSON.stringify(out)).not.toMatch(/secretlib|integrity|resolved\":\"https/);
    const page = scan.read(ownerScope(), {scanId: op.id});
    expect(page.findings).toHaveLength(1);
  });
  it('partial transport failure marks status partial', async () => {
    await put('package.json', '{}');
    await put('package-lock.json', npmLock({
      'node_modules/leftpad': {version: '1.3.0', resolved: 'https://registry.npmjs.org/leftpad/-/leftpad-1.3.0.tgz'},
      'node_modules/rightpad': {version: '2.0.0', resolved: 'https://registry.npmjs.org/rightpad/-/rightpad-2.0.0.tgz'},
    }));
    const failing = async (url: string, init: {method: string; body?: string}) => {
      // One malformed slot: leftpad answers, rightpad stays indeterminate.
      if (url.includes('querybatch')) {
        const queries = JSON.parse(init.body!).queries as {package: {name: string}}[];
        return {status: 200, headers: {get: () => null}, text: async () => JSON.stringify({results: queries.map(q => q.package.name === 'leftpad' ? {vulns: [{id: 'GHSA-aaaa-0001', modified: '2024-01-01T00:00:00Z'}]} : null)})};
      }
      return detailTransport(url, init);
    };
    const scan2 = makeScan({transport: failing});
    const op = await scan2.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {}});
    op.approved = true; op.status = 'running';
    putOp(op);
    const out = await scan2.execute(op, ctxFor()) as DependencyScanResult;
    expect(out.status).toBe('partial');
  });
  it('new basis marks the old result stale; read with a stale scanId is refused', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    await scan.execute(op, ctxFor());
    const scope = ownerScope();
    expect(() => scan.read(scope, {scanId: 'not-this-scan'})).toThrowError(/new check/i);
    scan.markStale(scope, 'f'.repeat(64));
    const stale = store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, dependencyScopeKey(scope))!;
    expect(stale.status).toBe('stale');
    expect(stale.fresh).toBe(false);
  });
  it('a newer accepted result is never overwritten by a late one', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    await scan.execute(op, ctxFor());
    const scope = ownerScope(), key = dependencyScopeKey(scope);
    const current = store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, key)!;
    const newer = {...current, scanId: 'newer', checkedAt: '2026-11-22T00:00:00.000Z'};
    store.internal('fixture.scan', threadId, () => store.put(DEPENDENCY_SCAN_RESULT, key, threadId, newer));
    // Re-run the old op; its result must not displace the newer accepted scan.
    const staleOp = {...op, approved: true, status: 'running' as const};
    store.internal('fixture.operation', threadId, () => store.put('operation', op.id, threadId, staleOp));
    await scan.execute(staleOp, ctxFor());
    expect(store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, key)!.scanId).toBe('newer');
  });
  it('another thread scope cannot read this thread\'s result', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    const op = await approvedOp();
    await scan.execute(op, ctxFor());
    expect(() => scan.read(ownerScope(projectId, 'thread-2'))).toThrowError(/new check/i);
    expect(() => scan.read(ownerScope('proj-2', threadId))).toThrowError(/new check/i);
  });
  it('github source enrichs matching alerts opt-in only', async () => {
    await put('package.json', '{}'); await put('package-lock.json', publicLock());
    let githubCalls = 0;
    const scan2 = makeScan({dependabotAlerts: async () => { githubCalls++; return [{package: 'leftpad', advisoryIds: ['GHSA-aaaa-0001'], severity: 'high', firstPatched: '1.4.0', matchedOccurrence: true}]; }});
    const op = await scan2.prepare({projectId, threadId, binding: {root, owner: ownerScope()}, sources: {github: true}, githubOrigin: {owner: 'acme', repo: 'demo'}});
    op.approved = true; op.status = 'running';
    putOp(op);
    const out = await scan2.execute(op, ctxFor()) as DependencyScanResult;
    expect(githubCalls).toBe(1);
    expect(out.remoteAlertState).toBe('available');
    expect(out.remoteAlerts).toHaveLength(1);
    const args = JSON.stringify(op.args);
    expect(args).not.toContain('github.com/acme'); // origin recorded, never a URL
  });
});
