import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectTrustLedger } from '../packages/core/project-trust.ts';
import { Store } from '../packages/storage/store.ts';

const roots: string[] = [];
const stores = new Set<Store>();
const scope = { read: true, write: false, network: 'none' as const };
const approvedFiles = [{ path: 'tool.txt', kind: 'executable' as const }];
afterEach(async () => {
  for (const store of stores) store.close();
  stores.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true, force: true, maxRetries: 5,
  })));
});

function openStore(directory: string) {
  const store = new Store(directory);
  stores.add(store);
  return store;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'trust-persistence-'));
  roots.push(root);
  const project = join(root, 'project'), dataDir = join(root, 'state');
  await mkdir(project);
  await writeFile(join(project, 'tool.txt'), 'approved executable bytes');
  const store = openStore(dataDir), ledger = new ProjectTrustLedger(store);
  const decision = { trustId: 'subject', rootPath: project, approvedFiles, scope, decision: 'trusted' as const };
  return { project, dataDir, store, ledger, decision };
}

async function failPendingDecision(state: Awaited<ReturnType<typeof fixture>>) {
  // The real filesystem verification yields before persistence. Closing the
  // real SQLite writer models shutdown before that pending decision commits.
  const pending = state.ledger.decide(state.decision);
  state.store.close();
  stores.delete(state.store);
  await expect(pending).rejects.toBeInstanceOf(Error);
}

describe('M03 trust authority after a failed durable decision', () => {
  it('does not grant new trust when the pending decision cannot commit', async () => {
    const state = await fixture();
    await failPendingDecision(state);
    expect(state.ledger.get('subject')).toBeNull();
    expect(await state.ledger.verify('subject', state.project)).toEqual({
      status: 'INVALIDATED', reasons: ['unknown-trust-record'],
    });
    expect(new ProjectTrustLedger(openStore(state.dataDir)).get('subject')).toBeNull();
  });

  it('does not replace a committed decline with a failed trusted decision', async () => {
    const state = await fixture();
    await state.ledger.decide({ ...state.decision, decision: 'declined' });
    const before = state.ledger.get('subject');
    await failPendingDecision(state);
    expect(state.ledger.get('subject')).toEqual(before);
    expect((await state.ledger.verify('subject', state.project)).status).toBe('INVALIDATED');
    expect(new ProjectTrustLedger(openStore(state.dataDir)).get('subject')).toEqual(before);
  });

  it('does not resurrect revoked trust when the replacement cannot commit', async () => {
    const state = await fixture();
    await state.ledger.decide(state.decision);
    expect(state.ledger.revoke('subject')).toBe(true);
    const before = state.ledger.get('subject');
    await failPendingDecision(state);
    expect(state.ledger.get('subject')).toEqual(before);
    expect(await state.ledger.verify('subject', state.project)).toEqual({
      status: 'INVALIDATED', reasons: ['trust-revoked'],
    });
    expect(new ProjectTrustLedger(openStore(state.dataDir)).get('subject')).toEqual(before);
  });

  it('makes the committed authority visible to synchronous Store subscribers', async () => {
    const state = await fixture(), observed: unknown[] = [];
    const stop = state.store.subscribe(event => {
      if (event.type === 'projectTrust.changed') observed.push(state.ledger.get('subject'));
    });
    await state.ledger.decide(state.decision);
    stop();
    expect(observed).toEqual([state.ledger.get('subject')]);
    expect((await state.ledger.verify('subject', state.project)).status).toBe('CURRENT');
    expect(new ProjectTrustLedger(openStore(state.dataDir)).get('subject')).toEqual(state.ledger.get('subject'));
  });
});
