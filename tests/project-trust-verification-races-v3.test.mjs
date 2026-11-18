import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectTrustLedger } from '../packages/core/project-trust.ts';

const pauses = vi.hoisted(() => []);
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    async realpath(...args) {
      const pause = pauses.shift();
      if (pause) { pause.enter(); await pause.released; }
      return actual.realpath(...args);
    },
  };
});

const roots = [];
const scope = { read: true, write: false, network: 'none' };
const approvedFiles = [{ path: 'tool.txt', kind: 'executable' }];
afterEach(async () => {
  pauses.splice(0);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'trust-revocation-'));
  roots.push(root);
  await writeFile(join(root, 'tool.txt'), 'approved executable bytes');
  const ledger = new ProjectTrustLedger();
  await ledger.decide({ trustId: 'subject', rootPath: root, approvedFiles, scope, decision: 'trusted' });
  return { root, ledger };
}

// Delay one real I/O operation, then forward to the real filesystem. Authority,
// records, hashes and identity checks all use the production implementation.
async function verifyAcrossChange({ root, ledger }, change) {
  let enter, resume;
  const entered = new Promise(resolve => { enter = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  pauses.push({ enter, released });
  const pending = ledger.verify('subject', root);
  await entered;
  try { await change(); } finally { resume(); }
  return pending;
}

describe('M03 project trust current authority after asynchronous verification', () => {
  it('rejects revocation while filesystem verification is pending', async () => {
    const fixtureState = await fixture();
    const result = await verifyAcrossChange(fixtureState, () => {
      expect(fixtureState.ledger.revoke('subject')).toBe(true);
    });
    expect(result).toEqual({ status: 'INVALIDATED', reasons: ['trust-revoked'] });
  });

  it('rejects a replaced decision that was declined during verification', async () => {
    const fixtureState = await fixture();
    const result = await verifyAcrossChange(fixtureState, async () => {
      const replacement = await fixtureState.ledger.decide({
        trustId: 'subject', rootPath: fixtureState.root, approvedFiles, scope, decision: 'declined',
      });
      expect(replacement.revision).toBe(2);
    });
    expect(result.status).toBe('INVALIDATED');
  });

  it('requires a new verification after replacement with another trusted scope', async () => {
    const fixtureState = await fixture();
    const result = await verifyAcrossChange(fixtureState, async () => {
      await fixtureState.ledger.decide({
        trustId: 'subject', rootPath: fixtureState.root, approvedFiles,
        scope: { ...scope, read: false }, decision: 'trusted',
      });
    });
    expect(result.status).toBe('INVALIDATED');
    expect((await fixtureState.ledger.verify('subject', fixtureState.root)).status).toBe('CURRENT');
  });

  it('does not invalidate an unrelated trust record', async () => {
    const fixtureState = await fixture();
    await fixtureState.ledger.decide({
      trustId: 'unrelated', rootPath: fixtureState.root, approvedFiles, scope, decision: 'trusted',
    });
    const result = await verifyAcrossChange(fixtureState, () => {
      expect(fixtureState.ledger.revoke('unrelated')).toBe(true);
    });
    expect(result).toEqual({ status: 'CURRENT', reasons: [] });
  });
});
