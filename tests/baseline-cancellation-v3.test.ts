import { expect, it } from 'vitest';
import { existsSync, watch, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runProcess } from '../packages/capabilities/process.ts';
import { measuredArm, recordOfflineBenchmark } from './fixtures/offline-benchmark-receipt.ts';

const completedOutput = 'seed-42-completed-output\n'.repeat(512);
const childScript = [
  "const fs = require('node:fs');",
  "const [ready, release] = process.argv.slice(1);",
  "fs.writeFileSync(ready, 'ready', { flag: 'wx' });",
  "const deadline = setTimeout(() => { process.stderr.write('Owned child was not released\\n'); process.exitCode = 23; clearInterval(check); }, 15000);",
  "const check = setInterval(() => { if (fs.existsSync(release)) { clearInterval(check); clearTimeout(deadline); process.stdout.write('seed-42-completed-output\\n'.repeat(512)); } }, 5);",
].join('\n');

it('records normal completion and explicit cancellation of the same ready owned process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'm01-cancellation-'));
  const run = async (cancel: boolean) => {
    const directory = join(root, cancel ? 'cancel' : 'complete');
    await mkdir(directory);
    const readyPath = join(directory, 'ready'), releasePath = join(directory, 'release');
    let acceptReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((accept, reject) => { acceptReady = accept; rejectReady = reject; });
    // Observe a real child-written readiness file before choosing completion or
    // cancellation. No elapsed-time guess determines whether the child started.
    const watcher = watch(directory, () => { if (existsSync(readyPath)) acceptReady(); });
    watcher.on('error', rejectReady);
    const deadline = setTimeout(() => rejectReady(new Error('Owned child did not report readiness')), 15_000);
    const controller = new AbortController(), started = performance.now();
    const work = runProcess(process.execPath, ['--input-type=commonjs', '-e', childScript, readyPath, releasePath],
      directory, controller.signal, () => {}, 20_000, {}, 64 * 1024);
    try {
      await Promise.race([ready, work.then(result => { throw new Error('Owned process ended before readiness: ' + JSON.stringify(result)); })]);
      clearTimeout(deadline);
      const readinessMs = performance.now() - started;
      let abortedAt: number | null = null;
      if (cancel) { abortedAt = performance.now(); controller.abort(); }
      else writeFileSync(releasePath, 'release', { flag: 'wx' });
      const result = await work, closedAt = performance.now();
      return { result, elapsedMs: closedAt - started, readinessMs,
        abortToCloseMs: abortedAt === null ? null : closedAt - abortedAt };
    } finally {
      clearTimeout(deadline); watcher.close(); controller.abort();
      // runProcess settles only after its owned child closes and tree-kill work
      // settles. Cleanup never leaves a still-running fixture child behind.
      await work.catch(() => {});
    }
  };
  try {
    const baseline = await run(false), candidate = await run(true);
    expect(baseline.result).toMatchObject({ status: 'succeeded', exitCode: 0, cancelled: false,
      timedOut: false, truncated: false, stdout: completedOutput, stderr: '' });
    expect(candidate.result).toMatchObject({ status: 'cancelled', cancelled: true,
      timedOut: false, truncated: false, stdout: '', stderr: '' });
    for (const arm of [baseline, candidate]) {
      expect(arm.result.pid).toBeGreaterThan(0);
      expect(arm.readinessMs).toBeGreaterThanOrEqual(0);
      expect(arm.elapsedMs).toBeGreaterThanOrEqual(arm.readinessMs);
    }
    expect(baseline.abortToCloseMs).toBeNull(); expect(candidate.abortToCloseMs).toBeGreaterThanOrEqual(0);
    const outputBytes = (arm: typeof baseline) => Buffer.byteLength(arm.result.stdout) + Buffer.byteLength(arm.result.stderr);
    const observation = (arm: typeof baseline) => ({
      status: arm.result.status, exitCode: arm.result.exitCode, signal: arm.result.signal,
      cancelled: arm.result.cancelled, timedOut: arm.result.timedOut, pid: arm.result.pid,
      readinessObserved: true, readinessMs: arm.readinessMs, abortToCloseMs: arm.abortToCloseMs,
    });
    recordOfflineBenchmark(root, {
      fixture: 'cancellation', model: null, account: null, seed: 42,
      config: 'Identical ready owned Node child: explicit normal-release control versus AbortSignal cancellation scenario',
      baseline: measuredArm('baseline', baseline.elapsedMs, null, outputBytes(baseline)),
      candidate: measuredArm('candidate', candidate.elapsedMs, null, outputBytes(candidate)),
      notes: [
        'Both arms use the real shell-free runProcess launcher and the same child readiness handshake.',
        'The control is released to produce deterministic output. The scenario is cancelled while waiting and must produce no output.',
        'Elapsed covers child launch through actual process settlement; abort-to-close latency is separately observed.',
        'Output bytes are captured stdout plus stderr. Process, filesystem, and provider input bytes are not measured and remain null.',
        'The arms intentionally have different successful fixture outcomes. This is cancellation behavior, not an optimization or historical-build comparison.',
        'This does not certify native confinement, arbitrary descendants, model cancellation, or a full application workflow.',
      ],
    }, { expected: { baseline: 'succeeded', candidate: 'cancelled' },
      baseline: observation(baseline), candidate: observation(candidate) });
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 5 }); }
}, 60_000);
