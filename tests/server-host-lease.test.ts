import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/store.ts';
import { Service } from '../packages/core/service.ts';
import { acquireProfileLease } from '../apps/server/profile-lease.ts';
import { registerWorkspaceHost, workspaceHost } from '../apps/server/workspace-host.ts';
import { HarnessError } from '../packages/contracts/index.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'server-lease-')); roots.push(root); return root; }
const runtime = { configure() {}, async models() { return []; }, async history() { return []; }, async followUp() { throw new Error('unused'); }, async compact() { throw new Error('unused'); }, async cancel() {}, async dispose() {}, async start() {} };

it('rejects an empty profile directory before touching the filesystem', () => {
  for (const value of ['', '   ']) expect(() => acquireProfileLease(value)).toThrowError(HarnessError);
});

it('leases a profile exactly once and releases it for a later owner', () => {
  const root = fixture(), directory = join(root, 'profile'), first = acquireProfileLease(directory);
  expect(first.dataDir).toBe(realpathSync(directory));
  expect(() => acquireProfileLease(directory)).toThrowError(expect.objectContaining({code:'PROFILE_IN_USE'}));
  first.close();
  const second = acquireProfileLease(directory);
  second.close();
  acquireProfileLease(directory).close();
});

it('refuses a planted ownership file that is not an ordinary private file', () => {
  const root = fixture(), directory = join(root, 'profile'), marker = join(directory, '.host-lease.sqlite');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'real'), 'planted');
  symlinkSync('real', marker);
  expect(() => acquireProfileLease(directory)).toThrowError(HarnessError);
});

it('registers a workspace host once per service and rejects a second registration', async () => {
  const root = fixture(), store = new Store(join(root, 'state')), service = new Service(store, runtime);
  try {
    const host = { projects: null!, terminals: null! };
    registerWorkspaceHost(service, host);
    expect(workspaceHost(service)).toBe(host);
    expect(() => registerWorkspaceHost(service, host)).toThrowError('already registered');
  } finally { await service.dispose(); store.close(); }
});

it('creates a lazy workspace host for an unregistered service', async () => {
  const root = fixture(), store = new Store(join(root, 'state2')), service = new Service(store, runtime);
  try {
    const host = workspaceHost(service);
    expect(host.projects).toBeDefined();
    expect(host.terminals).toBeDefined();
    expect(workspaceHost(service)).toBe(host);
  } finally { await service.dispose(); store.close(); }
});
