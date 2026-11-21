// Bounded evidence runner for the M12 v6 merged-tree verification receipts.
// Executes each named command as its own observed receipt, writes a bounded log
// (JSON header + capped output) under logs/, and prints the commandEvidence
// record for M12-verification.json assembly. No statuses are synthesized.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = '<worktree:m12-v6>';
const logsDir = resolve(root, 'docs/implementation/v6/M12/logs');
mkdirSync(logsDir, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const CAP = 65536;

const name = process.argv[2];
const commands = {
  'vitest-tool-program-v3': ['pnpm', 'exec', 'vitest', 'run', 'tests/tool-program-v3.test.ts'],
  'vitest-replay-v3': ['pnpm', 'exec', 'vitest', 'run', 'tests/tool-program-replay-v3.test.ts'],
  'vitest-python-kernel-v3': ['pnpm', 'exec', 'vitest', 'run', 'tests/python-kernel-v3.test.ts'],
  'vitest-continuation-v6': ['pnpm', 'exec', 'vitest', 'run', 'tests/tool-program-continuation-v6.test.ts'],
  'typecheck': ['pnpm', 'typecheck'],
  'lint': ['pnpm', 'lint'],
  'test': ['pnpm', 'test'],
  'build': ['pnpm', 'build'],
  'test-browser': ['pnpm', 'test:browser'],
};
const argv = commands[name];
if (!argv) { console.error(`unknown command: ${name}`); process.exit(2); }

const startedAt = new Date().toISOString();
const run = spawnSync(argv[0], argv.slice(1), {
  cwd: root,
  env: { ...process.env, PATH: `<toolchain>:${process.env.PATH}` },
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  timeout: 4 * 60 * 60 * 1000,
});
const endedAt = new Date().toISOString();
let output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '');
let truncated = false;
if (output.length > CAP - 8192) { const head = 24 * 1024, tail = CAP - 8192 - head; output = `${output.slice(0, head)}\n[bounded: elided ${output.length - head - tail} chars]\n${output.slice(-tail)}`; truncated = true; }
const timedOut = !!run.error && /ETIMEDOUT/i.test(String(run.error.code ?? run.error));
const termination = timedOut ? 'TIMEOUT' : run.signal ? 'CANCELLED' : run.error ? 'SPAWN_ERROR' : 'NONE';
const exitCode = run.status ?? null;
const header = { argv, cwd: root, startedAt, endedAt, exitCode, termination, truncated };
const log = `${JSON.stringify(header, null, 2)}\n\n${output}`;
const logPath = resolve(logsDir, `${name}.log`);
writeFileSync(logPath, log);
const receipt = {
  argv,
  cwdIdentity: root,
  executableIdentity: execFileSync('sh', ['-c', `command -v ${argv[0]}`], { env: { ...process.env, PATH: `<toolchain>:${process.env.PATH}` }, encoding: 'utf8' }).trim(),
  startedAt,
  endedAt,
  exitCode,
  termination,
  status: termination === 'NONE' && exitCode === 0 ? 'PASS' : 'FAIL',
  boundedLogRef: `docs/implementation/v6/M12/logs/${name}.log`,
  logDigest: sha256(readFileSync(logPath)),
};
console.log(JSON.stringify(receipt, null, 2));
process.exit(exitCode ?? 1);
