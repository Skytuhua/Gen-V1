// Runs the three independent build steps concurrently instead of serially.
import { spawn } from 'node:child_process';

const steps = [
  ['node', ['scripts/build-widgets.mjs']],
  ['node', ['scripts/build-plugin-runtime.mjs']],
  ['pnpm', ['exec', 'vite', 'build']],
];
const children = steps.map(([file, args]) => spawn(file, args, { stdio: 'inherit', shell: process.platform === 'win32' }));
const results = await Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))));
const failures = results.map((status, index) => ({ status, name: steps[index][1].at(-1) })).filter(result => result.status !== 0);
if (failures.length) {
  for (const failure of failures) console.error(`build step failed (${failure.status}): ${failure.name}`);
  process.exit(1);
}
