import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../packages/storage/store';
import type { ResourceGrant, StartRun } from '../packages/contracts';
import { withApprovedProjectContext } from '../packages/core/approved-project-context';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'm04-instruction-custody-')), project = join(directory, 'project'); mkdirSync(project);
  const store = new Store(join(directory, 'profile')), path = join(project, 'AGENTS.md'); writeFileSync(path, 'Keep selected source evidence.\n');
  const info = statSync(project, { bigint: true });
  const grant: ResourceGrant = { id: 'project', threadId: 'thread', kind: 'project', path: project, label: 'Project', writable: false, createdAt: '', identity: { dev: String(info.dev), ino: String(info.ino) } };
  const input: StartRun = { threadId: 'thread', runId: 'run', epoch: 1, modelId: 'test/model', accountId: null, prompt: 'Read the project', inputId: 'input', sessionPath: null, resources: [grant] };
  store.internal('fixture', 'thread', () => {
    store.put('thread', 'thread', 'thread', { id: 'thread', title: 'Fixture', status: 'working', ...input });
    store.put('resource', grant.id, grant.threadId, grant);
  });
  cleanup.push(() => { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5 }); });
  return { store, path, grant, input };
}

it.skipIf(process.platform !== 'win32')('holds the actual native file guard until instruction admission finishes', async () => {
  const f = fixture();
  await withApprovedProjectContext(f.store, f.input, new AbortController().signal, async (context, assertCurrent) => {
    expect(context?.instructionText).toContain('Keep selected source evidence.');
    expect(context?.instructions.entries).toHaveLength(1);
    await expect(writeFile(f.path, 'Changed while native request is being admitted')).rejects.toBeDefined();
    assertCurrent();
  });
  await expect(writeFile(f.path, 'Changed after admission')).resolves.toBeUndefined();
});

it.skipIf(process.platform !== 'win32')('rejects revoked source custody before dispatch under actual native file protection', async () => {
  const f = fixture();
  await expect(withApprovedProjectContext(f.store, f.input, new AbortController().signal, async (_context, assertCurrent) => {
    f.store.internal('fixture', 'thread', () => f.store.remove('resource', f.grant.id));
    assertCurrent();
  })).rejects.toMatchObject({ code: 'STALE_REQUEST_CONTEXT' });
});

it.skipIf(process.platform === 'win32')('reports unavailable native file custody without silently reading project instructions', async () => {
  const f = fixture();
  await withApprovedProjectContext(f.store, f.input, new AbortController().signal, async context => {
    expect(context?.instructionText).toBe('');
    expect(context?.instructions.entries).toEqual([]);
    expect(context?.instructions.exclusions).toContainEqual({ filename: 'AGENTS.md', resourceId: 'project', reason: 'UNAVAILABLE_CUSTODY' });
  });
});
