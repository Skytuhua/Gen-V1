// Validation only: combine immutable repair heads in an ephemeral Actions checkout.
// No remote ref is written. Failures remain failures, including expected regressions.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = realpathSync(process.cwd());
const manifestPath = join(root, 'docs/implementation/v3/audits/2026-11-17/heads.json');
const sha256 = value => createHash('sha256').update(value).digest('hex');
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function git(...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
requireValue(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'Windows',
  'Run only in an ephemeral Windows GitHub Actions checkout.');
requireValue(process.env.GITHUB_REPOSITORY === 'skytuhua-org/Gen-V1', 'Unexpected repository.');
requireValue(git('status', '--porcelain', '--untracked-files=no') === '', 'Tracked checkout must start clean.');
const evidence = join(realpathSync(process.env.RUNNER_TEMP), 'm01-m03-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
mkdirSync(evidence);
const originalRunner = readFileSync(process.argv[1]);
copyFileSync(process.argv[1], join(evidence, 'validate-m01-m03-integration.mjs'));
const receipt = {
  format: 'M01M03.IntegrationValidation.v1', releaseApproved: false, status: 'BLOCKED',
  startedAt: new Date().toISOString(), endedAt: null,
  workflowSha: process.env.GITHUB_SHA, workflowRunId: process.env.GITHUB_RUN_ID,
  runnerDigest: sha256(originalRunner), manifestDigest: null, source: null,
  commands: [], tests: [], issues: [],
};
let manifest, integratedHead, generatedConfig, generatedConfigBytes;
try {
  const manifestBytes = readFileSync(manifestPath);
  copyFileSync(manifestPath, join(evidence, 'heads.json'));
  receipt.manifestDigest = sha256(manifestBytes);
  manifest = JSON.parse(manifestBytes);
  requireValue(manifest.schemaVersion === 1 && manifest.repository === process.env.GITHUB_REPOSITORY
    && manifest.releaseApproved === false && manifest.browserSuite === 'root', 'Unsupported validation manifest.');
  const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  requireValue(isSha(manifest.baseSha) && isSha(manifest.auditAncestorSha), 'Invalid immutable base.');
  requireValue(Array.isArray(manifest.heads) && manifest.heads.length > 0 && manifest.heads.length <= 40, 'Invalid repair head count.');
  const prs = new Set(), shas = new Set();
  for (const head of manifest.heads) {
    requireValue(Number.isSafeInteger(head.pr) && head.pr > 0 && !prs.has(head.pr)
      && isSha(head.sha) && !shas.has(head.sha) && (!head.branchBaseSha || isSha(head.branchBaseSha)), 'Invalid or duplicate repair head.');
    prs.add(head.pr); shas.add(head.sha);
  }
  requireValue(Array.isArray(manifest.tests) && manifest.tests.length > 0 && manifest.tests.length <= 64
    && new Set(manifest.tests).size === manifest.tests.length
    && manifest.tests.every(path => /^tests\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.test\.(?:ts|tsx|mjs|js|cts|mts)$/.test(path)),
  'Declare unique exact top-level Vitest test files.');
  const custodyPaths = ['package.json', 'pnpm-lock.yaml', '.github/actions/setup/action.yml'];
  const installedFrom = Object.fromEntries(custodyPaths.map(path => [path, git('rev-parse', 'HEAD:' + path)]));
  for (const sha of new Set([manifest.auditAncestorSha, manifest.baseSha, ...manifest.heads.map(head => head.sha)]))
    git('fetch', '--no-tags', 'origin', sha);
  git('merge-base', '--is-ancestor', manifest.auditAncestorSha, manifest.baseSha);
  for (const head of manifest.heads) {
    // Earlier reviewed PRs can branch before this audit cut. Their declared base
    // must be the actual common ancestor and already belong to the pinned base.
    const branchBase = head.branchBaseSha ?? manifest.auditAncestorSha;
    git('merge-base', '--is-ancestor', branchBase, manifest.baseSha);
    requireValue(git('merge-base', manifest.auditAncestorSha, head.sha) === branchBase,
      'Repair head does not descend from its declared reviewed base: #' + head.pr);
  }
  git('checkout', '--detach', manifest.baseSha);
  for (const head of manifest.heads) {
    console.log('M01_M03_MERGE=' + JSON.stringify(head));
    git('-c', 'user.name=Gen V1 integration validation', '-c', 'user.email=validation@example.invalid',
      'merge', '--no-ff', '--no-edit', '--no-gpg-sign', head.sha);
  }
  integratedHead = git('rev-parse', 'HEAD');
  requireValue(git('status', '--porcelain', '--untracked-files=no') === '', 'Assembly changed tracked working files.');
  for (const path of custodyPaths)
    requireValue(git('rev-parse', 'HEAD:' + path) === installedFrom[path], 'Installed toolchain inputs changed: ' + path);
  for (const path of manifest.tests) {
    const absolute = realpathSync(join(root, path)), inside = relative(root, absolute);
    requireValue(statSync(absolute).isFile() && !isAbsolute(inside) && !inside.startsWith('..'), 'Test escapes checkout: ' + path);
  }
  receipt.source = { baseSha: manifest.baseSha, auditAncestorSha: manifest.auditAncestorSha,
    heads: manifest.heads, integratedHead, treeSha: git('rev-parse', 'HEAD^{tree}'), installedFrom };
  writeFileSync(join(evidence, 'integrated.diff'), git('diff', '--binary', manifest.baseSha, 'HEAD') + '\n', { flag: 'wx' });
  console.log('M01_M03_SOURCE=' + JSON.stringify(receipt.source));
  const { resolvePackageManager, runRecordedCommand, statusFromObservation, writeCommandEvidence } =
    await import(pathToFileURL(join(root, 'scripts/research-baseline.ts')).href);
  const pm = resolvePackageManager(root);
  const run = async (name, args, timeoutMs = 15 * 60_000) => {
    console.log('M01_M03_COMMAND_START=' + JSON.stringify({ name, argv: [pm.file, ...pm.prefix, ...args] }));
    const observation = await runRecordedCommand(pm.file, [...pm.prefix, ...args],
      { cwd: root, timeoutMs, outputLimit: 4 * 1024 * 1024, environment: { COREPACK_ENABLE_NETWORK: '0', CI: 'true' } });
    const command = await writeCommandEvidence(observation, evidence, name, statusFromObservation(observation));
    receipt.commands.push(command);
    console.log(observation.stdout);
    if (observation.stderr) console.error(observation.stderr);
    console.log('M01_M03_COMMAND_RESULT=' + JSON.stringify(command));
    return observation;
  };
  const version = await run('00-package-manager', ['--version'], 30_000);
  const declared = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager;
  requireValue(statusFromObservation(version) === 'PASS' && 'pnpm@' + version.stdout.trim() === declared,
    'Installed package manager does not match the source pin.');
  for (const task of ['build:credential-lease', 'build:widgets', 'build']) {
    const observation = await run(task.replaceAll(':', '-'), [task]);
    requireValue(statusFromObservation(observation) === 'PASS', 'Required build failed: ' + task);
  }
  await run('20-typecheck', ['typecheck']);
  const reportPath = join(evidence, 'targeted-tests.json');
  generatedConfig = join(evidence, 'vitest.config.mjs');
  generatedConfigBytes = [
    'import base from ' + JSON.stringify(join(root, 'vitest.config.ts').replaceAll('\\', '/')) + ';',
    'export default {...base,root:' + JSON.stringify(root) + ',test:{...base.test,include:' + JSON.stringify(manifest.tests),
    ',passWithNoTests:false,allowOnly:false,maxWorkers:1,reporters:["default","json"],outputFile:{json:' + JSON.stringify(reportPath) + '}}};',
  ].join('\n');
  writeFileSync(generatedConfig, generatedConfigBytes, { flag: 'wx' });
  await run('30-targeted-tests', ['exec', 'vitest', 'run', '--config', generatedConfig]);
  try {
    requireValue(statSync(reportPath).size <= 32 * 1024 * 1024, 'Test report exceeded its bound.');
    const reportBytes = readFileSync(reportPath), report = JSON.parse(reportBytes);
    receipt.testReport = { path: reportPath, digest: sha256(reportBytes) };
    const expected = new Map(manifest.tests.map(path => [realpathSync(join(root, path)), path])), found = new Set();
    requireValue(Array.isArray(report.testResults), 'Missing per-file test results.');
    for (const file of report.testResults) {
      const path = typeof file.name === 'string' && expected.get(realpathSync(file.name));
      requireValue(path && !found.has(path) && Array.isArray(file.assertionResults), 'Unexpected, duplicate, or malformed test result.');
      found.add(path);
      const assertions = file.assertionResults;
      const result = { path, status: file.status, passed: assertions.filter(test => test.status === 'passed').length,
        failed: assertions.filter(test => test.status === 'failed').length,
        unexecuted: assertions.filter(test => !['passed', 'failed'].includes(test.status)).length };
      receipt.tests.push(result);
      console.log('M01_M03_TEST_FILE=' + JSON.stringify(result));
      for (const assertion of assertions.filter(test => test.status === 'failed'))
        console.log('M01_M03_TEST_FAILURE=' + JSON.stringify({ path, name: assertion.fullName,
          messages: (assertion.failureMessages ?? []).map(message => String(message).slice(0, 5000)) }));
    }
    requireValue(found.size === expected.size, 'At least one declared test file did not execute.');
    requireValue(report.success === true && receipt.tests.every(test => test.status === 'passed' && test.passed > 0
      && test.failed === 0 && test.unexecuted === 0), 'Required assertions failed or remain unexecuted.');
  } catch (error) { receipt.issues.push({ phase: 'unit-results', message: String(error) }); }
  // A unit failure does not suppress the independent browser observations.
  await run('40-root-browser', ['test:browser', '--suite', manifest.browserSuite]);
} catch (error) {
  receipt.issues.push({ phase: 'setup-or-execution', message: String(error), stderr: String(error?.stderr ?? '').slice(0, 8000) });
} finally {
  if (integratedHead) {
    try {
      requireValue(git('rev-parse', 'HEAD') === integratedHead
        && git('status', '--porcelain', '--untracked-files=no') === '', 'Integrated source changed during validation.');
      if (generatedConfig) requireValue(readFileSync(generatedConfig, 'utf8') === generatedConfigBytes, 'Test selection changed.');
    } catch (error) { receipt.issues.push({ phase: 'source-custody', message: String(error) }); }
  }
  receipt.endedAt = new Date().toISOString();
  receipt.status = receipt.commands.some(command => command.status === 'FAIL') || receipt.tests.some(test => test.failed > 0) ? 'FAIL'
    : receipt.issues.length === 0 && receipt.commands.length === 7 && receipt.commands.every(command => command.status === 'PASS') ? 'PASS' : 'BLOCKED';
  writeFileSync(join(evidence, 'validation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log('M01_M03_VALIDATION=' + JSON.stringify(receipt));
  process.exitCode = receipt.status === 'PASS' ? 0 : 1;
}
