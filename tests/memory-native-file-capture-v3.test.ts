import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import { memoryScope, type MemorySourceSnapshot } from '../packages/contracts/project-memory.ts';
import { registeredCapabilityFlags } from '../packages/core/capability-flags.ts';
import { lexicalRecall } from '../packages/core/memory-retrieval.ts';
import { digest } from '../packages/storage/store.ts';
import { memoryFixture } from './project-memory-fixture.ts';

const content = 'Use explicit transactions for project persistence.\nUTF-8 evidence: café, 東京.\n';
const bytes = Buffer.from(content, 'utf8');
const sourceDigest = createHash('sha256').update(bytes).digest('hex');
const fixtures: Awaited<ReturnType<typeof memoryFixture>>[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function nativeFileFixture() {
  // This helper explicitly enables only its disposable ProjectMemory instance
  // and opts in its source thread. It does not change the host flag registry.
  const fixture = await memoryFixture(); fixtures.push(fixture);
  const selectedPath = join(fixture.path, 'constraints-café.txt');
  writeFileSync(selectedPath, bytes, { flag: 'wx' });
  const path = realpathSync.native(selectedPath), physical = statSync(path, { bigint: true });
  const grant: ResourceGrant = {
    id: 'native-source-file', threadId: fixture.access.threadId, kind: 'file', path,
    label: 'constraints-café.txt', writable: false, createdAt: new Date().toISOString(),
    identity: { dev: String(physical.dev), ino: String(physical.ino) },
  };
  fixture.store.internal('fixture.native-file-grant', fixture.access.threadId, () => {
    fixture.store.put('resource', grant.id, grant.threadId, grant);
  });
  return { ...fixture, filePath: path, physical, grant };
}

// These cases must execute on Windows to supply platform evidence. No file
// access module, guard, native process, or source snapshot is mocked here.
// A skip on another platform is not native FILE capture proof.
describe.skipIf(process.platform !== 'win32')('M05 native Windows FILE capture', () => {
  it('captures exact UTF-8 bytes through the real guard and reuses the immutable FILE source without modifying the file', async () => {
    const fixture = await nativeFileFixture(), capturedSeq = fixture.store.sequence;
    expect(registeredCapabilityFlags()).toMatchObject({
      'memory.projectV1': false, 'memory.externalRecallExperimentV1': false,
    });
    const ref = await fixture.memory.captureFile(fixture.access, fixture.grant.id);
    expect(ref).toEqual({
      ownerThreadId: fixture.access.threadId, sourceKind: 'FILE', sourceId: `${fixture.grant.id}:`,
      sourceRevision: sourceDigest, capturedSeq, digest: sourceDigest, observedStatus: 'OBSERVED',
    });
    const retained = fixture.store.get<MemorySourceSnapshot>('projectMemorySource', digest(ref));
    expect(retained).toEqual({
      ref, projectIdentity: fixture.access.projectIdentity, accountId: fixture.access.accountId,
      content, label: fixture.grant.label,
      fileGrant: { resourceId: fixture.grant.id, grantDigest: digest(fixture.grant) },
    });

    const proposal = fixture.propose('Use explicit transactions for project persistence.', [ref]);
    fixture.act({ action: 'accept', itemId: proposal.id, baseRevision: proposal.revision });
    const accepted = fixture.memory.accepted(fixture.access);
    expect(accepted).toHaveLength(1);
    const item = accepted[0].item;
    expect(fixture.memory.source(fixture.access, item.id, item.revision, ref.digest, ref)).toEqual({
      scope: memoryScope(fixture.access), ref, content, label: fixture.grant.label,
    });

    const beforeReuse = fixture.store.sequence;
    expect(await fixture.memory.captureFile(fixture.access, fixture.grant.id)).toEqual(ref);
    expect(fixture.store.sequence).toBe(beforeReuse);
    expect(fixture.store.all<MemorySourceSnapshot>('projectMemorySource').filter(source => source.ref.sourceKind === 'FILE')).toEqual([retained]);
    expect(readFileSync(fixture.filePath)).toEqual(bytes);
    const after = statSync(fixture.filePath, { bigint: true });
    expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeNs: after.mtimeNs }).toEqual({
      dev: fixture.physical.dev, ino: fixture.physical.ino, size: fixture.physical.size, mtimeNs: fixture.physical.mtimeNs,
    });
  }, 60_000);

  it.each(['grant revocation', 'physical replacement'] as const)('rejects native-captured FILE recall, detail and recapture after %s', async change => {
    const fixture = await nativeFileFixture();
    const ref = await fixture.memory.captureFile(fixture.access, fixture.grant.id);
    const proposal = fixture.propose('Use explicit transactions for project persistence.', [ref]);
    fixture.act({ action: 'accept', itemId: proposal.id, baseRevision: proposal.revision });
    const candidates = fixture.memory.accepted(fixture.access);
    expect(candidates).toHaveLength(1);
    const item = candidates[0].item;
    // Retain the old candidate list to prove that a fresh source check also
    // fences a caller that already captured accepted revisions before revocation.
    const recall = () => lexicalRecall({
      access: fixture.access, requestId: 'native-file-request', contextGeneration: 1,
      query: 'project persistence transactions', candidates,
      tombstones: fixture.memory.tombstones(fixture.access),
      sourceAvailable: source => fixture.memory.sourceAvailable(fixture.access, source),
    });
    expect(recall().recall.selectedRevisions).toEqual([{ itemId: item.id, revision: item.revision }]);
    expect(fixture.memory.source(fixture.access, item.id, item.revision, ref.digest, ref).content).toBe(content);

    if (change === 'grant revocation') {
      fixture.store.internal('fixture.native-file-revoked', fixture.access.threadId, () => {
        fixture.store.remove('resource', fixture.grant.id);
      });
    } else {
      renameSync(fixture.filePath, fixture.filePath + '.prior');
      // Identical bytes must not authorize a different physical file.
      writeFileSync(fixture.filePath, bytes, { flag: 'wx' });
      const replacement = statSync(fixture.filePath, { bigint: true });
      expect({ dev: String(replacement.dev), ino: String(replacement.ino) }).not.toEqual(fixture.grant.identity);
    }

    expect(fixture.memory.sourceAvailable(fixture.access, ref)).toBe(false);
    expect(fixture.memory.accepted(fixture.access)).toEqual([]);
    const deniedRecall = recall();
    expect(deniedRecall.items).toEqual([]);
    expect(deniedRecall.injection).toBe('');
    expect(deniedRecall.recall.exclusions).toEqual([{ itemId: item.id, reason: 'SOURCE_UNAVAILABLE' }]);
    expect(() => fixture.memory.source(fixture.access, item.id, item.revision, ref.digest, ref)).toThrowError('The exact supporting source revision is unavailable.');
    const beforeRecapture = fixture.store.sequence;
    const sources = fixture.store.all<MemorySourceSnapshot>('projectMemorySource');
    await expect(fixture.memory.captureFile(fixture.access, fixture.grant.id)).rejects.toMatchObject({ code: 'MEMORY_SOURCE_DENIED' });
    expect(fixture.store.sequence).toBe(beforeRecapture);
    expect(fixture.store.all<MemorySourceSnapshot>('projectMemorySource')).toEqual(sources);
  }, 60_000);
});
