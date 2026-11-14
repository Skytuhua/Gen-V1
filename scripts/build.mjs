// Runs the three independent build steps concurrently instead of serially.
import { spawn } from 'node:child_process';

const steps = [
  ['node', ['scripts/build-widgets.mjs']],
  ['node', ['scripts/build-plugin-runtime.mjs']],
  ['pnpm', ['exec', 'vite', 'build']],
];
const results = await Promise.all(steps.map(([file, args]) => new Promise(resolve => {
  const name = [file, ...args].join(' ');
  const child = spawn(file, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  let launchError;
  child.once('error', error => { launchError = error; });
  child.once('close', (status, signal) => resolve({ name, status, signal, launchError }));
})));
const failures = results.filter(result => result.launchError || result.status !== 0);
if (failures.length) {
  for (const { name, status, signal, launchError } of failures) {
    console.error(`build step failed (${launchError?.message ?? signal ?? status}): ${name}`);
  }
  process.exit(1);
}
