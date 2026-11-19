import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('preserves UTF-8 output split across interleaved stdout and stderr chunks', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'gen-m15-output-'));
  try {
    const script = fileURLToPath(new URL('../scripts/m15-record.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [script, 'utf8', process.execPath, '--eval', `
      process.stdout.write(Buffer.from([0xf0, 0x9f]));
      process.stderr.write(Buffer.from([0xe6, 0xbc]));
      setTimeout(() => {
        process.stdout.write(Buffer.from([0x9a, 0xb4, 10]));
        process.stderr.write(Buffer.from([0xa2, 10]));
      }, 200);
    `], { cwd, encoding: 'utf8', timeout: 15000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const log = readFileSync(join(cwd, 'docs/implementation/v3/m15-logs/utf8.log'), 'utf8');
    expect(log).toContain('🚴\n');
    expect(log).toContain('漢\n');
    expect(log).not.toContain('\uFFFD');
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
  }
});
