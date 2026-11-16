import { afterEach, expect, it } from 'vitest';
import { rmSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { memoryFixture } from './project-memory-fixture.ts';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import type { MemorySourceRefV1 } from '../packages/contracts/project-memory.ts';
import { digest } from '../packages/storage/store.ts';

const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

it.each(['removed', 'owner-changed', 'replaced', 'physical-replacement', 'missing-file'] as const)('host source authority excludes a retained FILE snapshot when its grant is %s', async change => {
  const fixture = await memoryFixture(); fixtures.push(fixture);
  const path = join(fixture.path, 'constraints.txt');
  const content = 'Use an explicit transaction for every persistence change.';
  writeFileSync(path, content);
  const identity = statSync(path, { bigint: true });
  const grant: ResourceGrant = {
    id: 'source-file', threadId: fixture.access.threadId, kind: 'file', path, label: 'constraints.txt', writable: false,
    createdAt: new Date().toISOString(), identity: { dev: String(identity.dev), ino: String(identity.ino) },
  };
  fixture.store.internal('fixture.file-grant', fixture.access.threadId, () => fixture.store.put('resource', grant.id, grant.threadId, grant));
  // This tests host-owned retained-source authorization. It is not native capture evidence.
  const sourceDigest = createHash('sha256').update(content, 'utf8').digest('hex');
  const ref: MemorySourceRefV1 = {
    ownerThreadId: fixture.access.threadId, sourceKind: 'FILE', sourceId: `${grant.id}:`, sourceRevision: sourceDigest,
    capturedSeq: fixture.store.sequence, digest: sourceDigest, observedStatus: 'OBSERVED',
  };
  fixture.store.internal('fixture.retained-file-source', fixture.access.threadId, () => fixture.store.put('projectMemorySource', digest(ref), fixture.access.threadId, {
    ref, projectIdentity: fixture.access.projectIdentity, accountId: fixture.access.accountId, content, label: grant.label,
    fileGrant: { resourceId: grant.id, grantDigest: digest(grant) },
  }));
  const proposed = fixture.propose('Every persistence change uses a transaction.', [ref]);
  fixture.act({ action: 'accept', itemId: proposed.id, baseRevision: proposed.revision });
  const accepted = fixture.memory.accepted(fixture.access)[0].item;
  expect(fixture.memory.sourceAvailable(fixture.access, ref)).toBe(true);

  if (change === 'physical-replacement') { renameSync(path, path + '.old'); writeFileSync(path, 'A different physical source.'); }
  if (change === 'missing-file') rmSync(path);

  fixture.store.internal('fixture.file-grant-revoked', fixture.access.threadId, () => {
    if (change === 'removed') fixture.store.remove('resource', grant.id);
    else if (change === 'owner-changed') fixture.store.put('resource', grant.id, 'other', { ...grant, threadId: 'other' });
    else if (change === 'replaced') fixture.store.put('resource', grant.id, grant.threadId, { ...grant, identity: { ...grant.identity, ino: '0' } });
  });

  expect(fixture.memory.sourceAvailable(fixture.access, ref)).toBe(false);
  expect(fixture.memory.accepted(fixture.access)).toEqual([]);
  expect(() => fixture.memory.source(fixture.access, accepted.id, accepted.revision, ref.digest, ref)).toThrow();
});
