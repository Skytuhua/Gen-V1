// Dependency-free command evidence for M15. Every attempt gets a new record.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync, existsSync, realpathSync} from 'node:fs';
import {resolve, join, delimiter} from 'node:path';
const [id, executable, ...args] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id) || !executable) throw Error('Usage: node scripts/m15-record.mjs ID COMMAND ...ARGS');
const dir = 'docs/implementation/v3/m15-logs';
mkdirSync(dir, {recursive: true});
const logRef = `${dir}/${id}.log`, recordRef = `${dir}/${id}.json`;
if (existsSync(recordRef) || existsSync(logRef)) throw Error('Use a new ID; failed evidence is immutable.');
const startedAt = new Date().toISOString(), cwdIdentity = realpathSync('.');
const executablePath = /[/\\]/.test(executable) ? resolve(executable) : (process.env.PATH ?? '').split(delimiter).map(p => join(p, executable)).find(existsSync);
// Identity lookup is best effort. A failed lookup must not prevent recording
// the actual spawn result, including an explicit missing command.
let executableIdentity = executable;
if (executablePath) {
  try { executableIdentity = realpathSync(executablePath); } catch { /* retain the requested name */ }
}
let output = '', ended = false;
const child = spawn(executable, args, {cwd: cwdIdentity, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false});
const collect = chunk => {output += chunk.toString(); if (output.length > 240000) output = '[earlier output truncated]\n' + output.slice(-200000);};
child.stdout.on('data', collect); child.stderr.on('data', collect);
function finish(exitCode, termination, error) {
  if (ended) return; ended = true;
  if (error) output += `\n${error.message}\n`;
  const log = `argv: ${JSON.stringify([executable, ...args])}\ncwd: ${cwdIdentity}\nexitCode: ${exitCode}\ntermination: ${termination}\n${output}`;
  writeFileSync(logRef, log);
  const record = {argv: [executable, ...args], cwdIdentity, executableIdentity,
    startedAt, endedAt: new Date().toISOString(), exitCode, termination, status: termination !== 'NONE' ? 'BLOCKED' : exitCode === 0 ? 'PASS' : 'FAIL',
    boundedLogRef: logRef, logDigest: createHash('sha256').update(log).digest('hex')};
  writeFileSync(recordRef, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({id, ...record})); console.log(output.slice(-5000));
  process.exitCode = exitCode ?? 1;
}
child.on('error', error => finish(null, 'SPAWN_ERROR', error));
// close follows exit and guarantees the child's stdout/stderr pipes drained.
child.on('close', (code, signal) => finish(code, signal ? 'CANCELLED' : 'NONE'));
