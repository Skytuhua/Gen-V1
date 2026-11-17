import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitExecutable, runProcess } from '../packages/capabilities/process.ts';
import { nativeGit } from '../packages/workspace/git-storage.ts';

const roots: string[] = [];
const syntheticToken = 'ghp_fixture/token+native=20261117';
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true, force: true, maxRetries: 5,
  })));
});
const quote = (path: string) => "'" + path.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";

async function runFixture(body: string) {
  const root = await mkdtemp(join(tmpdir(), 'git-output-boundary-'));
  roots.push(root);
  const metadata = join(root, 'repository.git'), script = join(root, 'output.cjs');
  const signal = new AbortController().signal, git = gitExecutable();
  const initialized = await runProcess(git, ['init', '--bare', metadata], root, signal, () => {}, 10_000);
  expect(initialized, initialized.stderr).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
  await writeFile(script, [
    "const token = process.env.GH_TOKEN;",
    "if (!token) throw Error('Fixture did not receive its scoped token');",
    body,
  ].join('\n'));
  // An explicit test-owned Git alias invokes only this owned Node fixture.
  // No remote is configured, no push occurs and the token is synthetic.
  const command = '!' + quote(process.execPath) + ' ' + quote(script);
  return nativeGit(git, metadata, undefined, ['-c', 'alias.secret-fixture=' + command, 'secret-fixture'],
    signal, { GH_TOKEN: syntheticToken });
}

const encodings = [
  ['raw', 'token'],
  ['base64', "Buffer.from(token, 'utf8').toString('base64')"],
  ['percent encoded', 'encodeURIComponent(token)'],
  ['ANSI split', "token.slice(0, 8) + String.fromCharCode(27) + '[31m' + token.slice(8)"],
] as const;

describe('M03 Git credential output boundary', () => {
  it.each(encodings)('redacts the injected %s credential from real Git child output', async (_name, expression) => {
    const output = await runFixture("process.stdout.write('before\\n' + (" + expression + ") + '\\nafter\\n');");
    expect(output).toBe('before\n[REDACTED]\nafter\n');
  });

  it('preserves ordinary output from the same real Git boundary', async () => {
    expect(await runFixture("process.stdout.write('ordinary git output\\n');")).toBe('ordinary git output\n');
  });

  it('redacts failed child output while preserving Git failure and termination metadata', async () => {
    let failure: unknown;
    try {
      await runFixture([
        "process.stdout.write('partial:' + token);",
        "process.stderr.write('diagnostic:' + token);",
        "process.exitCode = 17;",
      ].join('\n'));
    } catch (error) { failure = error; }
    if (!(failure instanceof Error)) throw Error('Expected the owned Git child to fail');
    const fields = Object.fromEntries(Object.getOwnPropertyNames(failure).map(key => [
      key, (failure as unknown as Record<string, unknown>)[key],
    ]));
    expect(JSON.stringify(fields)).not.toContain(syntheticToken);
    expect(failure).toMatchObject({
      code: 'GIT_ERROR',
      details: {
        status: 'failed', exitCode: 17, signal: null, cancelled: false, timedOut: false, truncated: false,
        stdout: 'partial:[REDACTED]', stderr: 'diagnostic:[REDACTED]',
      },
    });
  });
});
