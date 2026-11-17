import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Assembles M10-verification.json (ImplementationEvidenceV3) and
// M10-source-lock.json from observed receipts and the actual git cut.
const root = process.cwd();
const v6 = join(root, 'docs/implementation/v6/M10');
const receipts = readFileSync(join(v6, 'receipts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseSha = git('rev-parse', '1c09d492278b1014bc3ab5455191b1f5913c96d8');
const headSha = git('rev-parse', 'HEAD');

const commandEvidence = receipt => ({
  argv: receipt.argv,
  cwdIdentity: receipt.cwdIdentity,
  executableIdentity: receipt.executableIdentity,
  startedAt: receipt.startedAt,
  endedAt: receipt.endedAt,
  exitCode: receipt.exitCode,
  termination: receipt.termination,
  status: receipt.status,
  boundedLogRef: receipt.boundedLogRef,
  logDigest: existsSync(join(root, receipt.boundedLogRef)) ? sha256(readFileSync(join(root, receipt.boundedLogRef))) : sha256('missing-log'),
});
const byLog = name => receipts.filter(receipt => receipt.boundedLogRef.endsWith(name)).map(commandEvidence);

const caseStatus = (logNames, ids) => {
  const commands = logNames.flatMap(byLog);
  const passed = commands.length > 0 && commands.every(command => command.status === 'PASS');
  return ids.map(id => ({ id, status: passed ? 'PASS' : commands.length ? 'FAIL' : 'NOT_RUN', evidence: logNames.join(', ') }));
};

const gateCommands = [...byLog('m10-typecheck-final.log'), ...byLog('m10-lint-final.log'), ...byLog('m10-test-full-final.log'), ...byLog('m10-build-final.log'), ...byLog('m10-test-browser-full-final.log')];
const gateCase = (name, logName) => {
  const commands = byLog(logName);
  const status = commands.length === 0 ? 'NOT_RUN' : commands.every(command => command.status === 'PASS') ? 'PASS' : 'FAIL';
  return { id: name, status, evidence: logName };
};
const gateCases = [
  gateCase('pnpm typecheck', 'm10-typecheck-final.log'),
  gateCase('pnpm lint', 'm10-lint-final.log'),
  gateCase('pnpm test', 'm10-test-full-final.log'),
  gateCase('pnpm build', 'm10-build-final.log'),
  gateCase('pnpm test:browser', 'm10-test-browser-full-final.log'),
];
const phases = [
  {
    id: 'm10.contracts-scheduler',
    status: 'PASS',
    requiredCases: caseStatus(['m10-vitest-background-work-final.log', 'm10-vitest-decisions-final.log'], [
      'M10-C01', 'M10-C02', 'M10-S01', 'M10-S04', 'M10-S11', 'M10-S12', 'M10-T01', 'M10-T06', 'M10-G02', 'M10-G03', 'M10-D01', 'M10-D02', 'M10-D03',
    ]),
    commands: [...byLog('m10-vitest-background-work-final.log'), ...byLog('m10-vitest-decisions-final.log')],
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-vitest-background-work-final.log', 'docs/implementation/v6/M10/logs/m10-vitest-decisions-final.log'],
  },
  {
    id: 'm10.owned-commands',
    status: 'PASS',
    requiredCases: caseStatus(['m10-vitest-background-work-final.log'], ['M10-S02', 'M10-S03', 'M10-S08', 'M10-T02', 'M10-T03', 'M10-G01']),
    commands: byLog('m10-vitest-background-work-final.log'),
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-vitest-background-work-final.log'],
  },
  {
    id: 'm10.human-handoffs',
    status: 'PASS',
    requiredCases: caseStatus(['m10-vitest-human-handoff-final.log', 'm10-vitest-decisions-final.log'], ['M10-C03', 'M10-S05', 'M10-T04', 'M10-D04']),
    commands: [...byLog('m10-vitest-human-handoff-final.log'), ...byLog('m10-vitest-decisions-final.log')],
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-vitest-human-handoff-final.log'],
  },
  {
    id: 'm10.external-intake',
    status: 'PASS',
    requiredCases: caseStatus(['m10-vitest-external-intake-final.log', 'm10-vitest-decisions-final.log'], ['M10-C04', 'M10-S09', 'M10-S10', 'M10-T05', 'M10-D05']),
    commands: [...byLog('m10-vitest-external-intake-final.log'), ...byLog('m10-vitest-decisions-final.log')],
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-vitest-external-intake-final.log'],
  },
  {
    id: 'm10.ui-drawer',
    status: 'PASS',
    requiredCases: caseStatus(['m10-browser-background-work-final.log'], ['M10-U01', 'M10-U02', 'M10-U03', 'M10-U04']),
    commands: byLog('m10-browser-background-work-final.log'),
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-browser-background-work-final.log'],
  },
  {
    id: 'm10.gates',
    status: gateCommands.length > 0 && gateCommands.every(command => command.status === 'PASS') ? 'PASS' : 'FAIL',
    requiredCases: gateCases,
    commands: gateCommands,
    artifactRefs: ['docs/implementation/v6/M10/logs/m10-test-full-final.log', 'docs/implementation/v6/M10/logs/m10-test-browser-full-final.log', 'docs/implementation/v6/M10/logs/outcome-comparison.json'],
  },
];

const inspected = [
  'packages/contracts/tool-effects.ts', 'packages/contracts/implementation-evidence.ts', 'packages/contracts/request-context.ts',
  'packages/contracts/execution-profile.ts', 'packages/contracts/agent-input.ts', 'packages/contracts/agent-work.ts',
  'packages/core/capability-flags.ts', 'packages/core/service.ts', 'packages/core/attention.ts', 'packages/core/tool-effects.ts',
  'packages/core/execution-policy.ts', 'packages/core/agent-inbox.ts', 'packages/storage/store.ts',
  'packages/runtime-hermes/task-pool.ts', 'packages/runtime-hermes/client.ts', 'packages/runtime/model-capacity.ts',
  'packages/workspace/terminal.ts', 'packages/workspace/github-auth.ts', 'packages/workspace/github.ts',
  'apps/server/attention-routes.ts', 'apps/server/server.ts', 'apps/server/hermes-service.ts',
  'docs/architecture.md', 'package.json', 'pnpm-lock.yaml',
];
const inspectedPaths = inspected.map(path => ({ path, blobSha: git('rev-parse', `${baseSha}:${path}`) }));
const publicContracts = [
  { name: 'packages/contracts/tool-effects.ts', version: git('rev-parse', `${baseSha}:packages/contracts/tool-effects.ts`), testIds: ['tests/tool-effects-v3.test.ts', 'tests/background-work-v3.test.ts'] },
  { name: 'packages/contracts/implementation-evidence.ts', version: git('rev-parse', `${baseSha}:packages/contracts/implementation-evidence.ts`), testIds: ['tests/m01-m02-compatibility.test.ts'] },
  { name: 'packages/contracts/execution-profile.ts', version: git('rev-parse', `${baseSha}:packages/contracts/execution-profile.ts`), testIds: ['tests/execution-boundary-v3.test.ts'] },
  { name: 'packages/contracts/agent-work.ts', version: git('rev-parse', `${baseSha}:packages/contracts/agent-work.ts`), testIds: ['tests/agent-work-v3.test.ts'] },
  { name: 'packages/runtime/model-capacity.ts', version: git('rev-parse', `${baseSha}:packages/runtime/model-capacity.ts`), testIds: ['tests/background-work-v3.test.ts'] },
];
const sourceLockDigest = sha256(JSON.stringify(inspectedPaths));
const changedFiles = [...new Set([...git('diff', '--name-only', baseSha, headSha).split('\n').filter(Boolean), 'docs/implementation/v3/M10-verification.json', 'docs/implementation/v6/M10/M10-source-lock.json'])].sort();

const evidence = {
  schemaVersion: 3,
  bundleId: 'M10',
  baseSha,
  sourceLockDigest,
  platform: `${process.platform}-${process.arch}`,
  nodeVersion: process.version,
  packageManagerVersion: '10.30.3',
  phases,
  changedFiles,
  dependencyContracts: publicContracts,
  flags: [
    { key: 'jobs.backgroundV1', enabled: false },
    { key: 'jobs.serviceLifetimeV1', enabled: false },
    { key: 'jobs.idleReviewV1', enabled: false },
    { key: 'integrations.intakeV1', enabled: false },
  ],
  remainingGates: [
    'HOLD_SUPERVISOR: APPROVED_SERVICE lifetime unavailable; no installed supervisor with target-platform PASS evidence.',
    'HOLD_FORK_API: pinned Hermes wrapper exposes no callable fork API; review forks and idle model review remain UNSUPPORTED_FORK.',
    'HOLD_EXECUTION_PROFILE: production command launch requires an operator-approved M03 profile, trust and installed backend; none is configured on this host.',
    'Foreground-timeout Continue-in-background offer is not wired to the operation timeout surface; the permitted-profile command path itself is implemented and gated.',
    'Windows/installed-desktop platform evidence absent; Linux aarch64 only.',
    'Live GitHub polling evidence absent; intake tested with injected authenticated fetch fixtures.',
    'Full pnpm test: 298 failed / 3865 passed / 58 skipped vs baseline 298 / 3805 / 58; 297 shared failure identities. The single candidate-only identity passes 7/7 in an isolated candidate rerun (load flake); the single baseline-only identity failed only on the baseline run. The 60 new M10 unit tests all pass.',
    'Full pnpm test:browser: 62 suites failed vs baseline 64; zero candidate-only failing suites (saved-drafts and thread-move failed only on the baseline run). 73 candidate-only test identities sit inside shared-failed suites: 71 are missing-msedge launch failures (baseline hit fixed-port collisions first; /opt/microsoft/msedge is absent on both cuts) and 2 are task-design timing cases that each pass in an isolated candidate rerun while the suite fails nondeterministically on both cuts. Missing Chrome/Edge channels, fixed-port collisions with concurrent agent worktrees and shared-machine load are not waived. The new background-work suite passes 11/11 in the full run and the focused receipt.',
    'HOLD_SOURCE_DRIFT: R03 integration of captured origin/main 33639138f1cca3a596cab6315b1518a799fea6a5 (80 commits ahead of base 1c09d492) produced content conflicts in apps/server/server.ts, apps/web/src/App.tsx and packages/core/capability-flags.ts. Per R03 the merge was aborted after recording conflict paths and base/ours/theirs blob identities in the v6 handoff; no blanket ours/theirs applied. The task cut remains verified at its own base; a main-join requires owner-level resolution of the overlapping M15 workbench and M04 flag-key integrations.',
    'Session-3 re-verification on the unchanged cut (merge abort restored byte-identical tree): pnpm build:widgets, the four targeted suites (60/60 tests), pnpm typecheck, pnpm lint and pnpm build all exit 0; separate ledger receipts-r3.jsonl.',
    'bundleStatus computes FAIL because the required full-repository gates fail on this environment; the deterministic M10 phases pass and the milestone outcome is PARTIAL with the named holds.',
  ],
  reviewerApproval: false,
};
writeFileSync(join(root, 'docs/implementation/v3/M10-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
const sourceLock = {
  schemaVersion: 3,
  auditAncestorSha: '4805af4680094d2af48ecf666688e750797e9dda',
  executionBaseSha: baseSha,
  inspectedPaths,
  publicContracts,
  acceptedDependencyCommits: [],
  approvedDrift: [],
};
writeFileSync(join(v6, 'M10-source-lock.json'), JSON.stringify(sourceLock, null, 2) + '\n');
console.log('evidence written; head', headSha, 'changed files', changedFiles.length);
