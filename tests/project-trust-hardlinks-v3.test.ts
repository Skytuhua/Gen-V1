import { link, mkdir, mkdtemp, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectTrust, verifyProjectTrust } from '../packages/core/project-trust.ts';
import { assertNotStorage } from '../packages/core/security.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true, force: true, maxRetries: 5,
  })));
});
const scope = { read: true, write: false, network: 'none' as const };
const approvedFiles = [{ path: 'tool.txt', kind: 'executable' as const }];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'trust-hardlinks-'));
  roots.push(root);
  const project = join(root, 'project'), tool = join(project, 'tool.txt');
  await mkdir(project);
  await writeFile(tool, 'approved executable bytes');
  const decision = { trustId: 'subject', rootPath: project, approvedFiles, scope, decision: 'trusted' as const };
  return { root, project, tool, decision };
}

describe('M03 project trust single-link file custody', () => {
  it('rejects the same hardlink alias that the existing resource guard refuses', async () => {
    const state = await fixture(), dataDir = join(state.root, 'profile');
    await mkdir(join(dataDir, 'github'), { recursive: true });
    const privateFixture = join(dataDir, 'github', 'credentials.json');
    await writeFile(privateFixture, 'synthetic private bytes for an owned fixture');
    await unlink(state.tool);
    await link(privateFixture, state.tool);
    const original = await stat(privateFixture, { bigint: true });
    const alias = await stat(state.tool, { bigint: true });
    expect({ dev: alias.dev, ino: alias.ino, nlink: alias.nlink }).toEqual({
      dev: original.dev, ino: original.ino, nlink: 2n,
    });
    expect(() => assertNotStorage(state.tool, dataDir)).toThrow(/hardlinks/i);
    await expect(createProjectTrust(state.decision)).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('invalidates approval if another hardlink appears without changing the approved bytes', async () => {
    const state = await fixture(), trust = await createProjectTrust(state.decision);
    await link(state.tool, join(state.root, 'outside-alias.txt'));
    expect((await stat(state.tool, { bigint: true })).nlink).toBe(2n);
    expect(await verifyProjectTrust(trust, state.project)).toEqual({
      status: 'INVALIDATED', reasons: ['approved-file-unavailable:tool.txt'],
    });
  });

  it('preserves approval for an ordinary single-link file', async () => {
    const state = await fixture(), trust = await createProjectTrust(state.decision);
    expect((await stat(state.tool, { bigint: true })).nlink).toBe(1n);
    expect(await verifyProjectTrust(trust, state.project)).toEqual({ status: 'CURRENT', reasons: [] });
  });

  it('preserves a resolved directory alias to the same approved physical root', async () => {
    const state = await fixture(), trust = await createProjectTrust(state.decision);
    const alias = join(state.root, 'project-alias');
    await symlink(state.project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await verifyProjectTrust(trust, alias)).toEqual({ status: 'CURRENT', reasons: [] });
  });
});
