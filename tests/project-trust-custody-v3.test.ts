import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalRootIdentity, ProjectTrustLedger, trustScopeCovers,
} from '../packages/core/project-trust.ts';

const roots: string[] = [];
const approvedFiles = [{ path: 'tool.txt', kind: 'executable' as const }];
const scope = { read: true, write: false, network: 'none' as const };
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'trust-custody-'));
  roots.push(root);
  await writeFile(join(root, 'tool.txt'), 'approved executable bytes');
  const ledger = new ProjectTrustLedger();
  const record = await ledger.decide({
    trustId: 'custody', rootPath: root, approvedFiles, scope, decision: 'trusted',
  });
  return { root, ledger, record };
}

describe('M03 project trust authority custody', () => {
  for (const surface of ['decision result', 'ledger lookup'] as const) {
    it(`cannot replace approved digests through the ${surface}`, async () => {
      const { root, ledger, record } = await fixture();
      const exposed = surface === 'decision result' ? record : ledger.get('custody')!.record;
      await writeFile(join(root, 'tool.txt'), 'unapproved replacement bytes');
      exposed.approvedDigests[0]!.sha256 = digest('unapproved replacement bytes');

      expect(await ledger.verify('custody', root)).toEqual({
        status: 'INVALIDATED', reasons: ['approved-bytes-changed:tool.txt'],
      });
    });
  }

  it('cannot remove executable checks by editing a returned digest array', async () => {
    const { root, ledger } = await fixture();
    ledger.get('custody')!.record.approvedDigests.splice(0);
    await writeFile(join(root, 'tool.txt'), 'unapproved replacement bytes');

    expect((await ledger.verify('custody', root)).status).toBe('INVALIDATED');
  });

  it('cannot widen the approved scope through a returned nested object', async () => {
    const { ledger } = await fixture();
    const exposed = ledger.get('custody')!.record;
    exposed.scope.write = true;
    exposed.scope.network = 'allowlist';

    expect(trustScopeCovers(ledger.get('custody')!.record.scope, {
      read: true, write: true, network: 'allowlist',
    })).toBe(false);
  });

  it('cannot retarget the physical root through a returned nested identity', async () => {
    const { root, ledger } = await fixture();
    const other = await fixture();
    const identity = await canonicalRootIdentity(other.root);
    const exposed = ledger.get('custody')!.record;
    exposed.root.canonicalPath = identity.canonicalPath;
    exposed.root.identity.dev = identity.dev;
    exposed.root.identity.ino = identity.ino;

    expect((await ledger.verify('custody', other.root)).status).toBe('INVALIDATED');
    expect((await ledger.verify('custody', root)).status).toBe('CURRENT');
  });

  it('retains explicit replacement decisions and trust revocation', async () => {
    const { root, ledger, record } = await fixture();
    await writeFile(join(root, 'tool.txt'), 'explicitly approved replacement');
    const replacement = await ledger.decide({
      trustId: 'custody', rootPath: root, approvedFiles,
      scope: { ...scope, write: true }, decision: 'trusted',
    });
    expect(replacement.revision).toBe(2);
    expect(record.revision).toBe(1);
    expect(record.scope.write).toBe(false);
    expect((await ledger.verify('custody', root)).status).toBe('CURRENT');
    expect(ledger.revoke('custody')).toBe(true);
    expect(await ledger.verify('custody', root)).toEqual({
      status: 'INVALIDATED', reasons: ['trust-revoked'],
    });
  });
});
