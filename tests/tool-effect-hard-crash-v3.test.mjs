const { afterEach, expect, it } = await import('vitest');
const { mkdtemp, readFile, rm } = await import('node:fs/promises');
const { spawn } = await import('node:child_process');
const { createRequire } = await import('node:module');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { pathToFileURL } = await import('node:url');

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const require = createRequire(join(process.cwd(), 'package.json'));
const loader = pathToFileURL(require.resolve('tsx')).href;
const worker = join(process.cwd(), 'tests/fixtures/tool-effect-crash-worker.mjs');

async function runWorker(root, mode, phase = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', loader, worker, mode, root, phase],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    let checking = false, killAccepted = false, pauseMarker = null, pauseError = null;
    let poll;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20_000);
    const clear = () => { clearTimeout(timer); if (poll) clearInterval(poll); };
    if (mode === 'crash') poll = setInterval(() => {
      if (checking || killAccepted) return;
      checking = true;
      void readFile(join(root, 'termination-point.txt'), 'utf8').then(marker => {
        if (marker !== phase + '\n') throw new Error('Unexpected durability pause: ' + marker);
        pauseMarker = marker;
        killAccepted = child.kill('SIGKILL');
        clearInterval(poll);
        if (!killAccepted) throw new Error('Supervisor could not terminate its owned paused process');
      }).catch(error => {
        if (error.code !== 'ENOENT') {
          pauseError = error;
          clearInterval(poll);
          child.kill('SIGKILL');
        }
      }).finally(() => { checking = false; });
    }, 10);
    const collect = (text, isError) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + text.length > 128 * 1024) {
        overflow = true; child.kill('SIGKILL'); return;
      }
      if (isError) stderr += text; else stdout += text;
    };
    child.stdout.on('data', text => collect(text, false));
    child.stderr.on('data', text => collect(text, true));
    child.once('error', error => { clear(); reject(error); });
    child.once('close', (code, signal) => {
      clear();
      if (timedOut || overflow) reject(new Error('Owned crash worker exceeded its time/output bound: ' + stderr));
      else if (pauseError) reject(pauseError);
      else resolve({ code, signal, stdout, stderr, killAccepted, pauseMarker });
    });
  });
}

// Expected values follow the durability protocol, independently of production
// helpers. Fixed IDs and named pause points make every case reproducible.
const cases = [
  { phase: 'admission', state: null, effects: 0, uses: 1 },
  { phase: 'approval-written', state: null, effects: 0, uses: 1 },
  { phase: 'prepared-record', state: null, effects: 0, uses: 1 },
  { phase: 'dispatched-record', state: null, effects: 0, uses: 1 },
  { phase: 'admission-commit', state: 'UNKNOWN_EXTERNAL_OUTCOME', effects: 0, uses: 0 },
  { phase: 'before-external', state: 'UNKNOWN_EXTERNAL_OUTCOME', effects: 0, uses: 0 },
  { phase: 'external-committed', state: 'UNKNOWN_EXTERNAL_OUTCOME', effects: 1, uses: 0 },
  { phase: 'settlement', state: 'UNKNOWN_EXTERNAL_OUTCOME', effects: 1, uses: 0 },
  { phase: 'settlement-record', state: 'UNKNOWN_EXTERNAL_OUTCOME', effects: 1, uses: 0 },
  { phase: 'settlement-commit', state: 'SUCCEEDED', effects: 1, uses: 0 },
];

it.each(cases)('retains exact effect certainty after hard termination at $phase', async expected => {
  const root = await mkdtemp(join(tmpdir(), 'effect-hard-crash-'));
  roots.push(root);
  const crash = await runWorker(root, 'crash', expected.phase);
  expect(crash, JSON.stringify(crash)).toMatchObject({ code: null, signal: 'SIGKILL', killAccepted: true, pauseMarker: expected.phase + '\n' });
  expect(await readFile(join(root, 'termination-point.txt'), 'utf8')).toBe(expected.phase + '\n');
  const recovered = await runWorker(root, 'recover');
  expect(recovered, recovered.stderr).toMatchObject({ code: 0, signal: null });
  const first = JSON.parse(recovered.stdout);
  expect(first).toMatchObject({
    state: expected.state, externalEffects: expected.effects, remainingUses: expected.uses, approvalAuthenticated: true,
    beforeState: expected.state === null ? null : expected.state === 'SUCCEEDED' ? 'SUCCEEDED' : 'DISPATCHED',
    uncertain: expected.state === 'UNKNOWN_EXTERNAL_OUTCOME' ? ['operation:counted-write@1'] : [],
    readmissionStarted: 0,
    readmissionState: expected.state === 'SUCCEEDED' ? 'SUCCEEDED' : null,
    readmissionError: expected.state === 'UNKNOWN_EXTERNAL_OUTCOME' ? 'INVOCATION_IN_FLIGHT' : null,
  });
  expect(first.transitions).toEqual(expected.state === null ? null
    : ['PREPARED', 'DISPATCHED', expected.state]);
  // A second independently launched host must not replay the write or append
  // another uncertainty transition just to reconstruct the prior receipt.
  const reopened = await runWorker(root, 'recover');
  expect(reopened, reopened.stderr).toMatchObject({ code: 0, signal: null });
  const second = JSON.parse(reopened.stdout);
  expect(second).toMatchObject({
    state: first.state, transitions: first.transitions, externalEffects: expected.effects,
    remainingUses: expected.uses, approvalAuthenticated: true, sequence: first.sequence, readmissionStarted: 0, uncertain: [],
  });
});
