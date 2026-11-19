import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { commandEvidenceSchema } from '../packages/contracts/implementation-evidence.ts';

it('retains a blocked receipt when an explicit executable cannot be found', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'm15-receipt-'));
  const cwd = realpathSync(fixture);
  const executable = join(cwd, 'missing-executable');
  const script = fileURLToPath(new URL('../scripts/m15-record.mjs', import.meta.url));
  try {
    const result = spawnSync(process.execPath, [script, 'missing-command', executable], {
      cwd, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const dir = join(cwd, 'docs', 'implementation', 'v3', 'm15-logs');
    const receipt = commandEvidenceSchema.parse(JSON.parse(readFileSync(join(dir, 'missing-command.json'), 'utf8')));
    expect(receipt).toMatchObject({
      argv: [executable], cwdIdentity: cwd, executableIdentity: executable,
      exitCode: null, termination: 'SPAWN_ERROR', status: 'BLOCKED',
    });
    const log = readFileSync(join(cwd, receipt.boundedLogRef));
    expect(log.toString()).toContain('termination: SPAWN_ERROR');
    expect(receipt.logDigest).toBe(createHash('sha256').update(log).digest('hex'));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

it.skipIf(process.platform === 'win32')('records the runnable PATH match, not a non-executable file ahead of it', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'm15-executable-'));
  const cwd = realpathSync(fixture);
  const blocked = join(cwd, 'first'), runnable = join(cwd, 'second');
  const script = fileURLToPath(new URL('../scripts/m15-record.mjs', import.meta.url));
  try {
    mkdirSync(blocked);
    mkdirSync(runnable);
    writeFileSync(join(blocked, 'evidence-node'), 'not executable', { mode: 0o644 });
    symlinkSync(process.execPath, join(runnable, 'evidence-node'));
    const result = spawnSync(process.execPath, [script, 'cli', 'evidence-node', '--version'], {
      cwd, encoding: 'utf8', timeout: 10_000, env: { ...process.env, PATH: [blocked, runnable].join(delimiter) },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const receipt = commandEvidenceSchema.parse(JSON.parse(readFileSync(join(cwd, 'docs/implementation/v3/m15-logs/cli.json'), 'utf8')));
    expect(receipt).toMatchObject({ status: 'PASS', executableIdentity: realpathSync(process.execPath) });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
