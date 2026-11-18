// Assembles the v6 M12-verification.json (implementationEvidenceV3Schema) for
// the merged tree from the real bounded-log receipts produced by
// run-evidence.mjs. Run after all receipts exist; exits nonzero listing
// missing/unrun gates instead of fabricating them.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = new URL('../../../..', import.meta.url).pathname;
const v6 = `${root}/docs/implementation/v6/M12`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = name => existsSync(`${v6}/logs/${name}.receipt.json`) ? JSON.parse(readFileSync(`${v6}/logs/${name}.receipt.json`)) : null;

const gates = [
  ['vitest-tool-program-v3', 'pnpm exec vitest run tests/tool-program-v3.test.ts'],
  ['vitest-replay-v3', 'pnpm exec vitest run tests/tool-program-replay-v3.test.ts'],
  ['vitest-python-kernel-v3', 'pnpm exec vitest run tests/python-kernel-v3.test.ts'],
  ['vitest-continuation-v6', 'pnpm exec vitest run tests/tool-program-continuation-v6.test.ts'],
  ['typecheck', 'pnpm typecheck'],
  ['lint', 'pnpm lint'],
  ['test', 'pnpm test'],
  ['build', 'pnpm build'],
  ['test-browser', 'pnpm test:browser'],
];
const receipts = {}, missing = [];
for (const [name, label] of gates) { receipts[name] = receipt(name); if (!receipts[name]) missing.push(label); }
if (missing.length) { console.error('missing receipts:', missing); process.exit(1); }
for (const [name] of gates) {
  const r = receipts[name];
  r.logDigest = sha256(readFileSync(`${root}/${r.boundedLogRef}`));
}
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
const lock = JSON.parse(readFileSync(`${v6}/M12-source-lock.json`));
const sourceLockDigest = sha256(readFileSync(`${v6}/M12-source-lock.json`));
const changedFiles = git('diff', '--name-only', 'fcaa52f7fcdc9f39420118a79f9a8250ba83c563', 'HEAD').split('\n')
  .concat(git('ls-files', '--others', '--exclude-standard').split('\n').filter(p => p.startsWith('docs/implementation/v6/') || p === 'tests/tool-program-continuation-v6.test.ts'))
  .filter(p => p && !p.startsWith('docs/implementation/v3/'));
const statusOf = r => r.status ?? (r.exitCode === 0 ? 'PASS' : 'FAIL');
const COMMAND_KEYS = ['argv', 'cwdIdentity', 'executableIdentity', 'startedAt', 'endedAt', 'exitCode', 'termination', 'status', 'boundedLogRef', 'logDigest', 'expectedNegative'];
const toCommand = r => r ? Object.fromEntries(COMMAND_KEYS.filter(k => r[k] !== undefined).map(k => [k, r[k]])) : r;
// Optional secondary run of tool-program-v3 (calmer-host retry). The primary
// receipt stays canonical; a preserved loaded-failure pair documents the
// observed wall-clock PROGRAM_DEADLINE under host contention.
const tpv3Run1 = receipt('vitest-tool-program-v3-run1-loaded');
if (tpv3Run1) tpv3Run1.logDigest = sha256(readFileSync(`${root}/${tpv3Run1.boundedLogRef}`));
const tpv3Commands = [receipts['vitest-tool-program-v3'], tpv3Run1].filter(Boolean);
// Pre-fix full-suite run retained for provenance (fixture-parity failures it
// exposed were fixed and the rerun is the canonical test receipt).
const testRun1 = receipt('test-run1-prefix-fixes');
if (testRun1) testRun1.logDigest = sha256(readFileSync(`${root}/${testRun1.boundedLogRef}`));
const caseStatus = c => c.every(x => x === 'PASS') ? 'PASS' : (c.includes('FAIL') ? 'FAIL' : 'NOT_RUN');

const evidence = {
  schemaVersion: 3,
  bundleId: 'M12',
  baseSha: lock.executionBaseSha,
  sourceLockDigest,
  platform: 'linux-arm64',
  nodeVersion: process.version,
  packageManagerVersion: '10.30.3',
  phases: [
    {
      id: 'V6.custody-merge-and-focus',
      get status() { return caseStatus(this.requiredCases.map(x => x.status)); },
      requiredCases: [
        { id: 'exact-head-recovery', status: 'PASS', evidence: 'Isolated worktree <worktree:m12-v6> at pre-merge branch head f04cb74eff8d36a7ebcbfb51ca43c6e30ff23ffc (itself carrying round-1 merge 44c19075 + evidence commits); original checkout and other worktrees untouched.' },
        { id: 'merge-current-main', status: 'PASS', evidence: 'Merged main 4aef753ec272d6ab9f9f9eec1df0ca232386975b via merge --no-commit --no-ff; all 14 conflict paths composed semantically (merge-resolution.json records base/ours/theirs/result blob identities; round-1 merge 44c19075 preserved in the same record); committed as 0548ebc51ea9f8b55a6bd2b68b7d711cc8d32a19.' },
        { id: 'focused-m12-suites-on-merged-tree', status: statusOf(receipts['vitest-tool-program-v3']) === 'PASS' && statusOf(receipts['vitest-replay-v3']) === 'PASS' && statusOf(receipts['vitest-python-kernel-v3']) === 'PASS' ? 'PASS' : 'FAIL', evidence: 'Three named v3 vitest files re-run against the combined tree; receipts under docs/implementation/v6/M12/logs/. tests/tool-program-v3.test.ts carries the required M12-S03 default-limit boundary (64 admitted / 65th denied, maxCalls 64, maxConcurrentCalls 4, 30s deadline); under host contention (load avg >11 from a parallel foreign-worktree vitest on this shared box) the two 64-call cases recorded PROGRAM_DEADLINE before CALL_LIMIT — preserved as vitest-tool-program-v3-run1-loaded.receipt.json; the required coverage was not reduced.' },
        { id: 'v6-continuation-D01-D05', status: statusOf(receipts['vitest-continuation-v6']), evidence: 'tests/tool-program-continuation-v6.test.ts: persistent-cell generation/reset, replay divergence on argument/digest/order corruption, grant revocation before dispatch, guest-memory-scope label, noncooperative-cancellation uncertainty.' },
      ],
      commands: [...tpv3Commands, receipts['vitest-replay-v3'], receipts['vitest-python-kernel-v3'], receipts['vitest-continuation-v6'], receipts['typecheck']].map(toCommand),
      artifactRefs: ['docs/implementation/v6/M12/requirements.json', 'docs/implementation/v6/M12/merge-resolution.json', 'docs/implementation/v6/M12/M12-source-lock.json'],
    },
    {
      id: 'V6.full-gates',
      status: [receipts['lint'], receipts['test'], receipts['build'], receipts['test-browser']].every(r => statusOf(r) === 'PASS') ? 'PASS' : 'FAIL',
      requiredCases: [
        { id: 'lint', status: statusOf(receipts['lint']), evidence: 'pnpm lint (UI guard check).' },
        { id: 'full-test', status: statusOf(receipts['test']), evidence: 'pnpm test = build:credential-lease + build:widgets + full vitest run on linux-arm64 under a shared box (load avg 15-21 from parallel foreign-worktree sessions). The post-fix rerun is authoritative; the earlier pre-fix run is preserved as test-run1-prefix-fixes.receipt.json. Non-M12 failing files match a same-base clean-main control run at 4aef753e (59 files — confinement-guard paths needing the privileged CAP_SYS_ADMIN broker, desktop/server/service timing suites), so inherited/environmental, not a merge regression. Merge-attributable failures found and fixed: integration-v3/recovery-v3 lacked audit-mode key custody (fixture parity; verified 6/6 and 15/15 standalone). Load-only failures: backend-v3 delivery-concurrency, replay-v3 deadline, tool-program-v3 64-call boundary — each passes standalone (47/47, 22/22).' },
        { id: 'build', status: statusOf(receipts['build']), evidence: 'pnpm build.' },
        { id: 'browser', status: statusOf(receipts['test-browser']), evidence: 'pnpm test:browser on the actual configured platform terminated at the evidence-runner 4h bound (termination TIMEOUT, receipt exitCode 0 because the harness killed it) after ~30 of ~68 suite configs. Executed suites recorded real failures under host contention (e.g. clarity-software 33 failed / 1 passed, toBeVisible timeouts); suites requiring the chrome channel additionally cannot pass on this host (/opt/google/chrome/chrome absent, bundled headless shell only; channel was not changed to obtain passes). Browser coverage is not established.' },
      ],
      commands: [receipts['lint'], receipts['test'], testRun1, receipts['build'], receipts['test-browser']].filter(Boolean).map(toCommand),
      artifactRefs: [],
    },
    {
      id: 'V6.platform-bounds',
      status: 'BLOCKED',
      requiredCases: [
        { id: 'python-native-confinement', status: 'NOT_RUN', evidence: 'HOLD_PLATFORM_BOUND: tests/python-program-backend-v3.test.ts and tests/python-program-integration-v3.test.ts gate on process.arch x64 and skip on this aarch64 host; linux-x64 evidence remains historical only.' },
        { id: 'whole-process-tree-memory', status: 'NOT_RUN', evidence: 'HOLD_PLATFORM_BOUND: only the 128MiB guest WASM linear-memory bound is proved (memoryScope GUEST_WASM_LINEAR, wholeExecutorMemoryLimitBytes null). No aggregate process-tree memory proof on any platform.' },
        { id: 'aggregate-retained-disk-quota', status: 'NOT_RUN', evidence: 'HOLD_PLATFORM_BOUND: no aggregate retained-directory disk quota exercised.' },
        { id: 'hard-host-io-termination', status: 'NOT_RUN', evidence: 'HOLD_PLATFORM_BOUND: noncooperative host-I/O teardown deadline unproved; D05 proves only that such operations stay owned/uncertain.' },
        { id: 'windows-installed-desktop', status: 'NOT_RUN', evidence: 'Unsupported on this linux-arm64 target; linux evidence never certifies Windows.' },
      ],
      commands: [],
      artifactRefs: ['docs/implementation/v6/M12/requirements.json'],
    },
  ],
  changedFiles,
  dependencyContracts: lock.publicContracts,
  flags: [
    { key: 'tools.jsReadProgramV1', enabled: false },
    { key: 'tools.durableReplayExperimentV1', enabled: false },
    { key: 'tools.pythonKernelV1', enabled: false },
  ],
  remainingGates: [
    'All three M12 flags remain false. Production admission requires independent review and explicit tested backend/operator configuration.',
    'linux-arm64 cannot certify the recorded linux-x64 Python confinement proof; python-program-backend/integration suites skip here (HOLD_PLATFORM_BOUND).',
    'No combined 128 MiB whole-executor/process-tree bound, aggregate retained-disk quota or hard host-I/O teardown deadline is established on any platform.',
    'Actual Windows and installed-desktop proof is unavailable on this target.',
    'Offline fixed-fixture token/byte/quality measurements exclude provider framing, billing and live model behavior. No live evaluation endpoint was invoked.',
    'Historical linux-x64 evidence at docs/implementation/v3/ is preserved and controller-validated; it is not relabeled as proof for this merged tree.',
  ],
  reviewerApproval: false,
};
writeFileSync(`${v6}/M12-verification.json`, JSON.stringify(evidence, null, 2) + '\n');
console.log('wrote verification docs; bundleStatus would be computed by validator, not stored');
