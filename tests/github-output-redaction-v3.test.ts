import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubTools } from '../packages/workspace/github.ts';
import type { ProjectTools } from '../packages/workspace/tools.ts';
import type { TerminalHost } from '../packages/workspace/terminal.ts';

const roots: string[] = [];
const syntheticToken = 'ghp_fixture/only+synthetic=20261117';
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true, force: true, maxRetries: 5,
  })));
});

const publicPull = {
  number: 7, title: 'Public title', url: 'https://github.com/example/fixture/pull/7',
  state: 'OPEN', headRefOid: 'a'.repeat(40), headRefName: 'review', isDraft: true,
};

async function fixture(script: string) {
  const root = await mkdtemp(join(tmpdir(), 'github-output-boundary-'));
  roots.push(root);
  // Node executes this owned extensionless fixture when the real CLI boundary
  // passes ["pr", "list", ...]. No live GitHub operation or credential is used.
  await writeFile(join(root, 'pr'), script);
  const projects = {
    store: { dataDir: join(root, 'profile') },
    binding: async () => ({ path: root }),
    git: async () => 'https://github.com/example/fixture.git',
  } as unknown as ProjectTools;
  const github = new GitHubTools(projects, {} as TerminalHost, process.execPath);
  vi.spyOn(github.auth, 'token').mockResolvedValue(syntheticToken);
  return github;
}

const encodings = [
  ['raw', 'token'],
  ['percent encoded', 'encodeURIComponent(token)'],
  ['base64 encoded', "Buffer.from(token, 'utf8').toString('base64')"],
  ['ANSI split inside JSON', "token.slice(0, 10) + String.fromCharCode(27) + '[31m' + token.slice(10)"],
] as const;

describe('M03 GitHub credential output boundary', () => {
  it.each(encodings)('redacts a known %s token returned by the actual child', async (_name, expression) => {
    const github = await fixture(`
      const token = process.env.GH_TOKEN;
      if (!token) throw Error('Fixture did not receive its scoped token');
      const item = ${JSON.stringify(publicPull)};
      item.title = 'Public prefix\\n' + (${expression}) + '\\nPublic suffix';
      process.stdout.write(JSON.stringify([item]));
    `);
    const result = await github.list('fixture-project');
    expect(result).toEqual({
      repo: 'example/fixture',
      items: [{ ...publicPull, title: 'Public prefix\n[REDACTED]\nPublic suffix' }],
    });
  });

  it('preserves ordinary structured CLI output', async () => {
    const github = await fixture(`
      if (!process.env.GH_TOKEN) throw Error('Fixture did not receive its scoped token');
      process.stdout.write(${JSON.stringify(JSON.stringify([publicPull]))});
    `);
    expect(await github.list('fixture-project')).toEqual({
      repo: 'example/fixture', items: [publicPull],
    });
  });

  it('does not release stdout, stderr or command diagnostics from a failed child', async () => {
    const github = await fixture(`
      const token = process.env.GH_TOKEN;
      if (!token) throw Error('Fixture did not receive its scoped token');
      process.stdout.write('partial stdout: ' + token);
      process.stderr.write('diagnostic stderr: ' + token + '\\n' + Buffer.from(token).toString('base64'));
      process.exitCode = 17;
    `);
    let failure: unknown;
    try { await github.list('fixture-project'); } catch (error) { failure = error; }
    if (!(failure instanceof Error)) throw Error('Expected the owned child to fail');
    const fields = Object.fromEntries(Object.getOwnPropertyNames(failure).map(key => [
      key, (failure as unknown as Record<string, unknown>)[key],
    ]));
    const returned = JSON.stringify(fields);
    expect(returned).not.toContain(syntheticToken);
    expect(returned).not.toContain(Buffer.from(syntheticToken).toString('base64'));
    expect(failure).toMatchObject({ code: 'GITHUB_CLI_FAILED' });
  });
});
