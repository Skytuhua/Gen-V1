import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Observed command receipt runner: one JSONL row per executed command with
// real timestamps, exit code and a bounded log reference. No chain hides a
// later unexecuted command; each invocation is separate.
const [logPath, receiptPath, ...argv] = process.argv.slice(2);
if (!logPath || !receiptPath || !argv.length) { console.error('usage: node run-command.mjs <log> <receipts.jsonl> <cmd...>'); process.exit(2); }
mkdirSync(dirname(resolve(logPath)), { recursive: true });
const startedAt = new Date().toISOString();
const out = createWriteStream(resolve(logPath));
const child = spawn(argv[0], argv.slice(1), { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(out); child.stderr.pipe(out);
let termination = 'NONE';
const timer = setTimeout(() => { termination = 'TIMEOUT'; child.kill('SIGKILL'); }, 60 * 60 * 1000);
child.on('error', error => { termination = 'SPAWN_ERROR'; out.write(String(error) + '\n'); });
child.on('close', (code, signal) => {
  clearTimeout(timer);
  const endedAt = new Date().toISOString();
  if (signal && termination === 'NONE') termination = 'CANCELLED';
  const receipt = {
    argv, cwdIdentity: process.cwd(), executableIdentity: argv[0], startedAt, endedAt,
    exitCode: typeof code === 'number' ? code : null, termination,
    status: termination === 'NONE' && code === 0 ? 'PASS' : 'FAIL',
    boundedLogRef: logPath,
  };
  appendFileSync(resolve(receiptPath), JSON.stringify(receipt) + '\n');
  out.end();
  process.exit(typeof code === 'number' ? code : 1);
});
