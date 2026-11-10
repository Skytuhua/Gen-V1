// Evidence capture only. No service, model, company authority or shell composition.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const [outputArgument, executable, ...args] = process.argv.slice(2);
if (!outputArgument || !executable || !path.isAbsolute(executable)) {
  console.error('Usage: node tools/company/capture-command.mjs <new-output-directory> <absolute-executable> [arguments...]');
  process.exitCode = 2;
} else {
  const output = path.resolve(outputArgument);
  fs.mkdirSync(output); // Refuse an existing directory; never overwrite older evidence.
  const stdout = fs.openSync(path.join(output, 'stdout.bin'), 'wx');
  const stderr = fs.openSync(path.join(output, 'stderr.bin'), 'wx');
  const startedAt = new Date().toISOString();
  const runner = spawnSync(executable, args, {
    cwd: process.cwd(), shell: false, windowsHide: true, stdio: ['ignore', stdout, stderr],
  });
  // First operation after the native process returns: durable exit capture.
  // null means no observed normal exit (for example launch failure or signal).
  fs.writeFileSync(path.join(output, 'runner-exit.txt'), JSON.stringify(runner.status) + '\n', {
    encoding: 'utf8', flag: 'wx', flush: true,
  });
  let collectorExit = runner.error ? 1 : 0;
  try {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    fs.writeFileSync(path.join(output, 'run.json'), JSON.stringify({
      startedAt, finishedAt: new Date().toISOString(), executable, args,
      runnerExit: runner.status, runnerSignal: runner.signal,
      launchErrorCode: runner.error?.code ?? null,
    }, null, 2) + '\n', {encoding: 'utf8', flag: 'wx'});
  } catch (error) {
    collectorExit = 1;
    try {
      fs.writeFileSync(path.join(output, 'collector-error.json'), JSON.stringify({
        kind: 'metadata_write_failed', code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
      }) + '\n', {encoding: 'utf8', flag: 'wx'});
    } catch { /* The separately persisted runner exit remains authoritative. */ }
  } finally {
    fs.writeFileSync(path.join(output, 'collector-exit.txt'), collectorExit + '\n', {
      encoding: 'utf8', flag: 'wx', flush: true,
    });
  }
  // Keep native failure visible while distinguishing collector failure in its own file.
  process.exitCode = collectorExit || (runner.status ?? 1);
}
