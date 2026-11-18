// Validation only: combine immutable repair heads in an ephemeral Actions checkout.
// No remote ref is written. Failures remain failures, including expected regressions.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = realpathSync(process.cwd());
const manifestPath = 'docs/implementation/v3/audits/2026-11-17/heads.json';
const runnerPath = 'scripts/validate-m01-m03-integration.mjs';
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const sha256 = value => createHash('sha256').update(value).digest('hex');
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function gitBytes(...args) {
  return execFileSync('git', ['-C', root, ...args], {
    windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const git = (...args) => gitBytes(...args).toString('utf8').trim();
const mode = process.argv[2], validationSha = process.env.VALIDATION_SHA;
requireValue(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'Windows',
  'Run only in an ephemeral Windows GitHub Actions checkout.');
requireValue(process.env.GITHUB_REPOSITORY === 'skytuhua-org/Gen-V1', 'Unexpected repository.');
requireValue(isSha(validationSha) && ['assemble', 'validate'].includes(mode), 'Missing validation revision or phase.');
const evidence = join(realpathSync(process.env.RUNNER_TEMP), 'm01-m03-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
if (mode === 'assemble') mkdirSync(evidence);
const originalRunner = readFileSync(process.argv[1]);
const receipt = {
  format: 'M01M03.IntegrationValidation.v1', releaseApproved: false, status: 'BLOCKED',
  startedAt: new Date().toISOString(), endedAt: null,
  workflowSha: process.env.GITHUB_WORKFLOW_SHA, eventSha: process.env.GITHUB_SHA, validationSha,
  workflowRunId: process.env.GITHUB_RUN_ID, workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  runnerDigest: sha256(originalRunner), manifestDigest: null, source: null,
  commands: [], tests: [], issues: [],
};
let manifest, integratedHead, generatedConfig, generatedConfigBytes;
try {
  requireValue(originalRunner.equals(gitBytes('show', validationSha + ':' + runnerPath)), 'Validation runner changed.');
  requireValue(git('status', '--porcelain', '--untracked-files=no') === '', 'Tracked checkout must start clean.');
  const manifestBytes = gitBytes('show', validationSha + ':' + manifestPath);
  if (mode === 'assemble') {
    requireValue(git('rev-parse', 'HEAD') === validationSha, 'Unexpected validation checkout.');
    writeFileSync(join(evidence, 'heads.json'), manifestBytes, { flag: 'wx' });
    writeFileSync(join(evidence, 'validate-m01-m03-integration.mjs'), originalRunner, { flag: 'wx' });
    writeFileSync(join(evidence, 'validate-m01-m03-integration.test.mjs'),
      gitBytes('show', validationSha + ':scripts/validate-m01-m03-integration.test.mjs'), { flag: 'wx' });
  }
  receipt.manifestDigest = sha256(manifestBytes);
  manifest = JSON.parse(manifestBytes);
  requireValue(manifest.schemaVersion === 1 && manifest.repository === process.env.GITHUB_REPOSITORY
    && manifest.releaseApproved === false && manifest.browserSuite === 'root', 'Unsupported validation manifest.');
  requireValue([manifest.baseSha, manifest.auditAncestorSha, manifest.expectedTreeSha].every(isSha), 'Invalid immutable source pins.');
  requireValue(Array.isArray(manifest.heads) && manifest.heads.length > 0 && manifest.heads.length <= 80, 'Invalid repair head count.');
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
  if (mode === 'assemble') {
    for (const sha of new Set([manifest.auditAncestorSha, manifest.baseSha, ...manifest.heads.map(head => head.sha)])) {
      try { git('cat-file', '-e', sha + '^{commit}'); }
      catch { git('fetch', '--no-tags', 'origin', sha); }
    }
    git('merge-base', '--is-ancestor', manifest.auditAncestorSha, manifest.baseSha);
    for (const head of manifest.heads) {
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
  }
  integratedHead = git('rev-parse', 'HEAD');
  requireValue(mode === 'assemble' || integratedHead === process.env.INTEGRATED_HEAD, 'Integrated HEAD changed after assembly.');
  const treeSha = git('rev-parse', 'HEAD^{tree}');
  requireValue(treeSha === manifest.expectedTreeSha, 'Expected tree ' + manifest.expectedTreeSha + ', assembled ' + treeSha);
  requireValue(git('status', '--porcelain', '--untracked-files=no') === '', 'Integrated checkout is dirty.');
  git('ls-files', '--error-unmatch', '--', ...manifest.tests);
  for (const path of manifest.tests) {
    const absolute = realpathSync(join(root, path)), inside = relative(root, absolute);
    requireValue(statSync(absolute).isFile() && !isAbsolute(inside) && !inside.startsWith('..'), 'Test escapes checkout: ' + path);
  }
  receipt.source = { baseSha: manifest.baseSha, auditAncestorSha: manifest.auditAncestorSha,
    heads: manifest.heads, integratedHead, treeSha };
  console.log('M01_M03_SOURCE=' + JSON.stringify(receipt.source));
  if (mode === 'assemble') {
    writeFileSync(join(evidence, 'integrated.diff'), gitBytes('diff', '--binary', '--full-index', manifest.baseSha, 'HEAD'), { flag: 'wx' });
    appendFileSync(process.env.GITHUB_OUTPUT, 'integrated_head=' + integratedHead + '\n');
  } else await validate();
} catch (error) {
  receipt.issues.push({ phase: mode, message: String(error), stderr: String(error?.stderr ?? '').slice(0, 8000) });
} finally {
  if (integratedHead) {
    try {
      requireValue(git('rev-parse', 'HEAD') === integratedHead
        && git('status', '--porcelain', '--untracked-files=no') === '', 'Integrated source changed during validation.');
      if (generatedConfig) requireValue(readFileSync(generatedConfig, 'utf8') === generatedConfigBytes, 'Test selection changed.');
    } catch (error) { receipt.issues.push({ phase: 'source-custody', message: String(error) }); }
  }
  receipt.endedAt = new Date().toISOString();
  if (mode === 'assemble') {
    if (receipt.source && !receipt.issues.length) receipt.status = 'ASSEMBLED';
  } else if (receipt.commands.some(command => command.status === 'FAIL') || receipt.testReport?.success === false
    || receipt.tests.some(test => test.status === 'failed' || test.failed > 0)
    || receipt.browserReport?.stats?.unexpected > 0 || receipt.browserReport?.stats?.flaky > 0 || receipt.browserReport?.errors > 0) {
    receipt.status = 'FAIL';
  } else if (receipt.issues.length === 0 && receipt.commands.length === 7
    && receipt.commands.every(command => command.status === 'PASS' && command.exitCode === 0 && command.termination === 'NONE')) {
    receipt.status = 'PASS';
  }
  writeFileSync(join(evidence, mode === 'assemble' ? 'assembly.json' : 'validation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log('M01_M03_VALIDATION=' + JSON.stringify(receipt));
  process.exitCode = receipt.status === (mode === 'assemble' ? 'ASSEMBLED' : 'PASS') ? 0 : 1;
}

async function validate() {
  const { resolvePackageManager, runRecordedCommand, statusFromObservation, writeCommandEvidence } =
    await import(pathToFileURL(join(root, 'scripts/research-baseline.ts')).href);
  // pnpm/action-setup installs the exact pinned version before this phase.
  // Corepack can exist next to Node but cannot download its cache with network
  // disabled; prefer the installed JavaScript entry rather than a .cmd shim.
  const pm = process.env.PNPM_HOME ? (() => {
    requireValue(isAbsolute(process.env.PNPM_HOME), 'PNPM_HOME must be an absolute toolchain path.');
    const packageRoot = realpathSync(join(process.env.PNPM_HOME, '..'));
    const entry = realpathSync(join(packageRoot, 'pnpm', 'bin', 'pnpm.cjs'));
    const within = relative(packageRoot, entry);
    requireValue(within && !isAbsolute(within) && !within.startsWith('..') && statSync(entry).isFile(),
      'Installed pnpm entry escapes its toolchain root.');
    return { file: process.execPath, prefix: [entry] };
  })() : resolvePackageManager(root);
  const run = async (name, args, timeoutMs = 15 * 60_000) => {
    console.log('M01_M03_COMMAND_START=' + JSON.stringify({ name, argv: [pm.file, ...pm.prefix, ...args] }));
    const observation = await runRecordedCommand(pm.file, [...pm.prefix, ...args],
      { cwd: root, timeoutMs, outputLimit: 4 * 1024 * 1024, environment: {
        COREPACK_ENABLE_NETWORK: '0', CI: 'true', HARNESS_HERMES_PYTHON: process.env.HARNESS_HERMES_PYTHON,
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.longpaths', GIT_CONFIG_VALUE_0: 'true',
      } });
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
    receipt.testReport = { path: reportPath, digest: sha256(reportBytes), success: report.success };
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
  const browserDir = join(root, 'test-results/browser');
  const before = new Set(existsSync(browserDir) ? readdirSync(browserDir) : []);
  await run('40-root-browser', ['test:browser', '--suite', manifest.browserSuite]);
  const runs = readdirSync(browserDir).filter(name => !before.has(name));
  requireValue(runs.length === 1, 'Expected a fresh root browser report.');
  const browserPath = join(browserDir, runs[0], 'root/results.json');
  requireValue(statSync(browserPath).size <= 32 * 1024 * 1024, 'Browser report exceeded its bound.');
  const bytes = readFileSync(browserPath), { errors, stats, suites } = JSON.parse(bytes);
  receipt.browserReport = { path: relative(root, browserPath), digest: sha256(bytes), stats, errors: errors?.length };
  const { rootBrowserSpecs } = await import(pathToFileURL(join(root, 'scripts/browser-suites.ts')).href);
  requireValue(Array.isArray(suites) && suites.length === rootBrowserSpecs.length
    && rootBrowserSpecs.every(file => suites.some(suite => suite.file === file)), 'Incomplete root browser suite.');
  requireValue(Array.isArray(errors) && errors.length === 0 && stats.unexpected === 0 && stats.flaky === 0
    && Number.isSafeInteger(stats.expected) && stats.expected > 0, 'Root browser report has failed, flaky, or missing results.');
}
