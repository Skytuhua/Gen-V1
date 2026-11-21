import { createJavaScriptExecutor } from '../../packages/runtime/tool-program-worker.ts';
import {
  CRASH_POINTS, REPLAY_OWNER, openReplayHarness, type CrashPoint, type ReplayFixtureState,
} from './tool-program-replay-harness-v3.ts';

const [directory, requestedPoint] = process.argv.slice(2);
if (!directory || !CRASH_POINTS.includes(requestedPoint as CrashPoint)) throw new Error('Invalid crash fixture arguments');
const target = requestedPoint as CrashPoint;
const executor = await createJavaScriptExecutor();
const harness = openReplayHarness(directory, {
  owner: REPLAY_OWNER, executor,
  boundary(point, programId) {
    if (point !== target) return;
    harness.store.internal('m12.fixture.crash', REPLAY_OWNER.threadId, () => {
      const state = harness.state();
      harness.store.put('m12ReplayFixture', 'fixture', REPLAY_OWNER.threadId, {
        ...state, programId, killedAt: target,
      } satisfies ReplayFixtureState);
      return { point, programId };
    });
    // An actual process death, after the requested transaction committed. There
    // is no exception catch, manager finalizer, worker stop, or SQLite close.
    process.kill(process.pid, 'SIGKILL');
    throw new Error('SIGKILL unexpectedly returned');
  },
});
const program = await harness.prepare();
await harness.programs.run(program.programId, REPLAY_OWNER, executor);
await harness.close();
await executor.stop();
throw new Error(`Crash boundary was not reached: ${target}`);
