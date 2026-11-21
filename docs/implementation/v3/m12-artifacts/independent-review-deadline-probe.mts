import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Store } from '../../../../packages/storage/store.ts';
import { ToolAuthority, buildToolRegistry } from '../../../../packages/core/tool-authority.ts';
import { ToolEffectLedger } from '../../../../packages/core/tool-effects.ts';
import { ToolDisclosure } from '../../../../packages/core/tool-disclosure.ts';
import { PrivateToolResults } from '../../../../packages/core/tool-results.ts';
import { ToolPrograms } from '../../../../packages/core/tool-programs.ts';
import { createJavaScriptExecutor } from '../../../../packages/runtime/tool-program-worker.ts';

// Intended negative boundary probe: the actual QuickJS executor is bounded,
// while this synthetic host read deliberately does not acknowledge abort.
// No external endpoint, credential, user file, or external effect is involved.
const cwd = fileURLToPath(new URL('../../../../', import.meta.url));
const sourcePaths = [
  'packages/core/tool-programs.ts', 'packages/contracts/tool-program.ts',
  'packages/runtime/tool-program-worker.ts', 'packages/runtime/tool-program-worker-child.mjs',
];
const sourceSha256 = Object.fromEntries(sourcePaths.map(path => [path,
  createHash('sha256').update(readFileSync(join(cwd, path))).digest('hex'),
]));
const executor = await createJavaScriptExecutor();
const directory = mkdtempSync(join(tmpdir(), 'm12-independent-deadline-'));
const store = new Store(directory);
const owner = { threadId: 'review-thread', runId: 'review-run', epoch: 1,
  projectId: 'review-project', workspaceId: 'review-workspace', accountBinding: 'review-account' };
const authority = new ToolAuthority(buildToolRegistry());
const effects = new ToolEffectLedger(store, authority);
const disclosure = new ToolDisclosure(store, authority, { currentOwner: () => owner });
disclosure.disclose(owner, ['repository_read']);
const results = new PrivateToolResults(store, { currentOwner: () => owner });
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
let issued!: () => void;
const observedCall = new Promise<void>(resolve => { issued = resolve; });
let readSettled = false;
const programs = new ToolPrograms(store, {
  authority, effects, disclosure, results, currentOwner: () => owner, enabled: () => true,
  executeRead: async () => { issued(); await gate; readSettled = true; return { value: 1 }; },
});
try {
  const program = await programs.prepare({ owner, language: 'JAVASCRIPT',
    source: "return await tools.call('repository_read', {});", allowedTools: ['repository_read'],
    requestedAggregate: 'Read one fixture value', limits: { deadlineMs: 300 },
  }, executor);
  let rpcSettled = false;
  const started = performance.now();
  const running = programs.run(program.programId, owner, executor).finally(() => { rpcSettled = true; });
  await observedCall;
  await new Promise(resolve => setTimeout(resolve, 600));
  const checkpoint = {
    elapsedMs: Math.round(performance.now() - started),
    programState: programs.inspect(program.programId, owner).program.state,
    programError: programs.inspect(program.programId, owner).program.error?.code,
    rpcSettled, readSettled,
    nestedState: programs.calls(program.programId, owner)[0]?.state,
    nestedEffectState: effects.get(`${program.programId}:call:0`)?.state,
  };
  release();
  const terminal = await running;
  console.log(JSON.stringify({
    schema: 'M12IndependentReviewProbeV1', name: 'noncooperative-host-read-deadline',
    recordedAt: new Date().toISOString(), cwd, sourceSha256,
    intendedNegative: true, liveExternalEffects: false,
    backend: executor.proof, requestedDeadlineMs: 300,
    observation: checkpoint,
    afterRelease: { elapsedMs: Math.round(performance.now() - started), rpcSettled, readSettled, state: terminal.state },
    conclusion: 'Guest execution and admission are bounded; RPC completion and noncooperative host read teardown are not a hard deadline guarantee.',
  }, null, 2));
  if (checkpoint.programState !== 'FAILED' || checkpoint.rpcSettled || checkpoint.readSettled
    || checkpoint.nestedState !== 'UNKNOWN' || checkpoint.nestedEffectState !== 'UNKNOWN_EXTERNAL_OUTCOME') process.exitCode = 1;
} finally {
  release();
  await programs.close();
  await executor.stop();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
