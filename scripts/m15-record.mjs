// Dependency-free command evidence for M15. Every attempt gets a new record.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync, mkdirSync, openSync, writeFileSync, existsSync, realpathSync} from 'node:fs';
import {resolve, join, delimiter} from 'node:path';
const [id, executable, ...args] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id) || !executable) throw Error('Usage: node scripts/m15-record.mjs ID COMMAND ...ARGS');
const dir = 'docs/implementation/v3/m15-logs';
mkdirSync(dir, {recursive: true});
const logRef = `${dir}/${id}.log`, recordRef = `${dir}/${id}.json`;
if (existsSync(recordRef)) throw Error('Use a new ID; failed evidence is immutable.');
const startedAt = new Date().toISOString(), cwdIdentity = realpathSync('.');
const executablePath = /[/\\]/.test(executable) ? resolve(executable) : (process.env.PATH ?? '').split(delimiter).map(p => join(p, executable)).find(existsSync);
// An unavailable canonical path must not hide the actual spawn result.
let executableIdentity = executable;
if (executablePath) {
  try { executableIdentity = realpathSync(executablePath); } catch { /* retain the requested name */ }
}
// Claim the ID before starting the process. A second recorder cannot run under
// the same ID, and a recorder interrupted before completion cannot recycle it.
const logHandle = (() => {
  try { return openSync(logRef, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Use a new ID; failed evidence is immutable.');
    throw error;
  }
})();
let output = '', ended = false;
const child = spawn(executable, args, {cwd: cwdIdentity, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false});
const collect = chunk => {output += chunk.toString(); if (output.length > 240000) output = '[earlier output truncated]\n' + output.slice(-200000);};
child.stdout.on('data', collect); child.stderr.on('data', collect);
function finish(exitCode, termination, error) {
  if (ended) return; ended = true;
  if (error) output += `\n${error.message}\n`;
  const log = `argv: ${JSON.stringify([executable, ...args])}\ncwd: ${cwdIdentity}\nexitCode: ${exitCode}\ntermination: ${termination}\n${output}`;
  try { writeFileSync(logHandle, log); } finally { closeSync(logHandle); }
  const record = {argv: [executable, ...args], cwdIdentity, executableIdentity,
    startedAt, endedAt: new Date().toISOString(), exitCode, termination, status: termination !== 'NONE' ? 'BLOCKED' : exitCode === 0 ? 'PASS' : 'FAIL',
    boundedLogRef: logRef, logDigest: createHash('sha256').update(log).digest('hex')};
  writeFileSync(recordRef, JSON.stringify(record, null, 2) + '\n', {flag:'wx'});
  console.log(JSON.stringify({id, ...record})); console.log(output.slice(-5000));
  process.exitCode = exitCode ?? 1;
}
child.on('error', error => finish(null, 'SPAWN_ERROR', error));
// close follows exit and guarantees the child's stdout/stderr pipes drained.
child.on('close', (code, signal) => finish(code, signal ? 'CANCELLED' : 'NONE'));
