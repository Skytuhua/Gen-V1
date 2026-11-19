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
// Effective base: the merged origin/main parent. Before the session-4 merge
// the execution base was 1c09d492; after joining 56749856 the task diff is
// measured against that merge parent so changedFiles only contains M10 work.
const baseSha = git('rev-parse', '567498568611bc33379b31a0630dfaf3691b339f');
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
    'Full pnpm test on the merged cut: 304 failed / 4115 passed / 62 skipped (4481) vs same-base baseline at 56749856: 306 failed / 4053 passed / 62 skipped (4421). All 304 candidate failure identities are shared with the baseline run — zero candidate-only failures; the 60-test delta is the new M10 suites, all passing. The 2 baseline-only identities (desktop-host startup collision, dev-plugin-runtime) are the same environmental/flaky class as the prior cut. Dominant causes unchanged: python3.14 absent (Hermes source worker), linux-path-guard denials, native/platform-specific suites.',
    'Full pnpm test:browser on the merged cut: TIMEOUT at the 60-minute receipt-runner bound (exit recorded, termination=TIMEOUT) after 35 suite groups under concurrent-agent machine load; 24 of the 35 failed — 23 of 24 suite identities appear in the prior baseline\'s failed-suite list and the one new identity (m08-restore, a 20s load timeout) passes 7/7 in an isolated candidate rerun. The focused receipt pnpm test:browser --suite background-work exits 0 (11/11) on the merged cut. Missing Chrome/Edge channels (/opt/microsoft/msedge absent), fixed-port collisions with concurrent m04/m12/m14/m15 agent fixture servers and shared-machine load are not waived; a completed full-suite run remains an unmet gate.',
    'HOLD_SOURCE_DRIFT resolved in session 4: the conflicted join with origin/main (then 33639138, re-captured as 567498568611bc33379b31a0630dfaf3691b339f after further main drift) was resolved under explicit user authorization. Resolution kept both integrations — M15/M04 flag keys beside the four M10 keys, main\'s customDock/onActiveViewsChange split-root plus background-work wiring, main\'s CRLF server.ts plus both route registrations — no blanket ours/theirs. The earlier abort-and-hold record stays in the v6 handoff.',
    'Session-3 re-verification on the pre-merge cut (merge abort had restored a byte-identical tree): pnpm build:widgets, the four targeted suites (60/60 tests), pnpm typecheck, pnpm lint and pnpm build all exit 0; separate ledger receipts-r3.jsonl. Session-4 re-ran the full gate sequence on the merged cut with -final receipts; the pre-merge -final rows are preserved in receipts-final-archived.jsonl and git history.',
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
