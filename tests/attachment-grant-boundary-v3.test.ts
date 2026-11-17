import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ResourceGrant } from '../packages/contracts/index.ts';
import { resolveGrant } from '../packages/core/security.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function profileFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'attachment-grant-')));
  const profile = join(root, 'profile'), attachments = join(profile, 'attachments');
  const owned = join(attachments, 'thread-a'), other = join(attachments, 'thread-b'), ordinary = join(root, 'notes.txt');
  for (const folder of [owned, other]) mkdirSync(folder, { recursive: true });
  writeFileSync(join(owned, 'secret.txt'), 'attachment bytes for thread a');
  writeFileSync(join(other, 'other.txt'), 'attachment bytes for thread b');
  writeFileSync(ordinary, 'ordinary file');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const grant = (path: string): ResourceGrant => ({ id: 'grant', threadId: 'thread', path, kind: 'attachment', label: basename(path), writable: false, createdAt: '2026-11-17T00:00:00Z' });
  return { profile, attachments, owned, other, ordinary, grant };
}

it('keeps stored attachments inside the conversation that uploaded them', async () => {
  const f = profileFixture();
  for (const write of [false, true]) {
    // A grant rooted at the profile or an ancestor must not reach any upload.
    await expect(resolveGrant(f.grant(f.profile), 'attachments/thread-a/secret.txt', write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(resolveGrant(f.grant(dirname(f.profile)), 'profile/attachments/thread-a/secret.txt', write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    // A grant rooted at the shared attachment root must not reach one conversation either.
    await expect(resolveGrant(f.grant(f.attachments), 'thread-a/secret.txt', write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(resolveGrant(f.grant(f.attachments), undefined, write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    // A conversation's own folder still cannot climb into a sibling's.
    await expect(resolveGrant(f.grant(f.owned), '../thread-b/other.txt', write, f.profile)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  }
});

it('still reads an attachment through the grant the host created for it', async () => {
  const f = profileFixture();
  await expect(resolveGrant(f.grant(join(f.owned, 'secret.txt')), undefined, false, f.profile)).resolves.toBe(join(f.owned, 'secret.txt'));
  // A directory grant rooted in the same conversation folder stays valid.
  await expect(resolveGrant({ ...f.grant(f.owned), kind: 'project' }, 'secret.txt', false, f.profile)).resolves.toBe(join(f.owned, 'secret.txt'));
  // Unrelated files inside the profile are still grantable.
  await expect(resolveGrant(f.grant(f.ordinary), undefined, false, f.profile)).resolves.toBe(f.ordinary);
});
