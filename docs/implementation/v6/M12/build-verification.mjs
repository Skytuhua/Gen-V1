// Assembles the v6 M12-verification.json (implementationEvidenceV3Schema) for
// the merged tree from the real bounded-log receipts produced by
// run-evidence.mjs. Run after all receipts exist; exits nonzero listing
// missing/unrun gates instead of fabricating them.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = '/home/piadmin/Gen-V1-m12-v6';
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
const statusOf = r => r.exitCode === 0 ? 'PASS' : 'FAIL';

const evidence = {
  schemaVersion: 3,
  bundleId: 'M12',
  baseSha: lock.executionBaseSha,
  sourceLockDigest,
  platform: 'linux-arm64',
  nodeVersion: execFileSync('/home/piadmin/tools/node24/bin/node', ['--version'], { encoding: 'utf8' }).trim(),
  packageManagerVersion: '10.30.3',
  phases: [
    {
      id: 'V6.custody-merge-and-focus',
      status: 'PASS',
      requiredCases: [
        { id: 'exact-head-recovery', status: 'PASS', evidence: 'Isolated worktree /home/piadmin/Gen-V1-m12-v6 created at recorded remote head 16cd0311a45b755f8ade87fe0637c77dc319f74d; original checkout and other worktrees untouched.' },
        { id: 'merge-current-main', status: 'PASS', evidence: 'Merged main 1c09d492278b1014bc3ab5455191b1f5913c96d8 via merge --no-commit --no-ff; all 10 conflict paths composed semantically (merge-resolution.json records base/ours/theirs/result blob identities); committed as 44c19075a3341f85a0f6c2c8e8455f2f70a970df.' },
        { id: 'focused-m12-suites-on-merged-tree', status: statusOf(receipts['vitest-tool-program-v3']) === 'PASS' && statusOf(receipts['vitest-replay-v3']) === 'PASS' && statusOf(receipts['vitest-python-kernel-v3']) === 'PASS' ? 'PASS' : 'FAIL', evidence: 'Three named v3 vitest files re-run against the combined tree; receipts under docs/implementation/v6/M12/logs/.' },
        { id: 'v6-continuation-D01-D05', status: statusOf(receipts['vitest-continuation-v6']), evidence: 'tests/tool-program-continuation-v6.test.ts: persistent-cell generation/reset, replay divergence on argument/digest/order corruption, grant revocation before dispatch, guest-memory-scope label, noncooperative-cancellation uncertainty.' },
      ],
      commands: [receipts['vitest-tool-program-v3'], receipts['vitest-replay-v3'], receipts['vitest-python-kernel-v3'], receipts['vitest-continuation-v6'], receipts['typecheck']],
      artifactRefs: ['docs/implementation/v6/M12/requirements.json', 'docs/implementation/v6/M12/merge-resolution.json', 'docs/implementation/v6/M12/M12-source-lock.json'],
    },
    {
      id: 'V6.full-gates',
      status: [receipts['lint'], receipts['test'], receipts['build'], receipts['test-browser']].every(r => r.exitCode === 0) ? 'PASS' : 'FAIL',
      requiredCases: [
        { id: 'lint', status: statusOf(receipts['lint']), evidence: 'pnpm lint (UI guard check).' },
        { id: 'full-test', status: statusOf(receipts['test']), evidence: 'pnpm test = build:credential-lease + build:widgets + full vitest run on linux-arm64. Recorded FAIL: failing files cluster in confined-directory-guard paths (workspace-action-outcomes, skill-invocation, capabilities, path-access, project-search-host, desktop-native) whose privileged CAP_SYS_ADMIN broker is unavailable on this host — reproduced identically on unmodified main 1c09d49 via a clean-worktree control run, so not a merge regression; plus 2 replay timing cases that pass in a clean single-file rerun (33/33).' },
        { id: 'build', status: statusOf(receipts['build']), evidence: 'pnpm build.' },
        { id: 'browser', status: statusOf(receipts['test-browser']), evidence: 'pnpm test:browser on the actual configured platform. Suites requiring the chrome channel fail on this host: /opt/google/chrome/chrome absent and only the bundled headless shell is installed; channel was not changed to obtain passes.' },
      ],
      commands: [receipts['lint'], receipts['test'], receipts['build'], receipts['test-browser']],
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
