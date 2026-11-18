import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bundleStatus, validatePhaseEvidence, type CommandEvidence, type PhaseEvidence } from '../packages/contracts/implementation-evidence.ts';

const command = (overrides: Partial<CommandEvidence> = {}): CommandEvidence => ({
  argv: ['node', 'fixture'], cwdIdentity: '/fixture', executableIdentity: '/node',
  startedAt: '2026-11-17T00:00:00Z', endedAt: '2026-11-17T00:00:01Z',
  exitCode: 0, termination: 'NONE', status: 'PASS', boundedLogRef: 'fixture.log',
  logDigest: 'a'.repeat(64), ...overrides,
});
const phase = (overrides: Partial<PhaseEvidence> = {}): PhaseEvidence => ({
  id: 'core', status: 'PASS', requiredCases: [{ id: 'required', status: 'PASS' }],
  commands: [command()], artifactRefs: [], ...overrides,
});

const unsupported: [string, PhaseEvidence][] = [
  ['unrun required case', phase({ requiredCases: [{ id: 'required', status: 'NOT_RUN' }] })],
  ['missing commands', phase({ commands: [] })],
  ['empty required coverage', phase({ requiredCases: [] })],
  ['timeout labelled PASS', phase({ commands: [command({ termination: 'TIMEOUT', exitCode: null })] })],
  ['expected negative without assertion', phase({ commands: [command({ status: 'EXPECTED_NEGATIVE' })] })],
];

describe('M01 aggregate cannot promote unsupported PASS claims', () => {
  it.each(unsupported)('blocks %s', (_name, value) => {
    expect(validatePhaseEvidence(value).length).toBeGreaterThan(0);
    expect(bundleStatus([value])).toBe('BLOCKED');
  });

  it('reports PARTIAL when a valid phase accompanies an unsupported PASS', () => {
    expect(bundleStatus([phase(), phase({ id: 'integration', commands: [] })])).toBe('PARTIAL');
  });

  it('preserves an observed required failure as FAIL', () => {
    expect(bundleStatus([phase({ requiredCases: [{ id: 'required', status: 'FAIL' }] })])).toBe('FAIL');
  });

  it('retains honest failed attempts without discarding later valid evidence', () => {
    const value = phase({ commands: [command({ status: 'FAIL', exitCode: 7 }), command()] });
    expect(validatePhaseEvidence(value)).toEqual([]);
    expect(bundleStatus([value])).toBe('PASS');
  });

  it('keeps a fully supported phase PASS', () => {
    expect(bundleStatus([phase()])).toBe('PASS');
    expect(bundleStatus([])).toBe('BLOCKED');
  });
});

it('reserves an M15 command evidence ID before running its command', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'm15-command-id-'));
  const recorder = fileURLToPath(new URL('../scripts/m15-record.mjs', import.meta.url));
  const args = [recorder, 'same-id', process.execPath, '-e'];
  const first = spawn(process.execPath, [...args, "const fs=require('node:fs');fs.writeFileSync('first-started',''); const t=setInterval(()=>{if(fs.existsSync('release')){clearInterval(t);console.log('first output');}},10);setTimeout(()=>process.exit(98),6000).unref();"], { cwd, stdio: 'ignore' });
  const closed = once(first, 'close');
  try {
    await expect.poll(() => {
      try { readFileSync(join(cwd, 'first-started')); return true; } catch { return false; }
    }, { timeout: 3000 }).toBe(true);
    const duplicate = spawnSync(process.execPath, [...args, "require('node:fs').writeFileSync('second-started','');console.log('second output');"], { cwd, encoding: 'utf8', timeout: 3000 });
    expect(duplicate.error).toBeUndefined();
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('Use a new ID');
    expect(() => readFileSync(join(cwd, 'second-started'))).toThrow(/ENOENT/);
    writeFileSync(join(cwd, 'release'), '');
    expect(await closed).toEqual([0, null]);
    const base = join(cwd, 'docs/implementation/v3/m15-logs/same-id');
    const log = readFileSync(base + '.log', 'utf8'), record = JSON.parse(readFileSync(base + '.json', 'utf8'));
    expect(log).toContain('first output');
    expect(log).not.toContain('second output');
    expect(record.logDigest).toBe(createHash('sha256').update(log).digest('hex'));
  } finally {
    writeFileSync(join(cwd, 'release'), '');
    await closed;
    rmSync(cwd, { recursive: true, force: true });
  }
}, 10000);
