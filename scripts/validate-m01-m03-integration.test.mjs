import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const runner = 'scripts/validate-m01-m03-integration.mjs';
const runnerBytes = readFileSync(new URL('./validate-m01-m03-integration.mjs', import.meta.url));
const manifestPath = 'docs/implementation/v3/audits/2026-11-17/heads.json';
const repository = 'skytuhua-org/Gen-V1';

function fixture(t, wrongTree = false) {
  const temp = mkdtempSync(join(tmpdir(), 'm01-m03-audit-')), root = join(temp, 'repo');
  t.after(() => rmSync(temp, { recursive: true, force: true, maxRetries: 3 }));
  const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
  mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Audit fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  function commit(message) { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); }
  put(join(root, '.gitattributes'), '* -text\n');
  put(join(root, 'package.json'), '{"type":"module","packageManager":"pnpm@10.30.3"}');
  put(join(root, 'scripts/browser-suites.ts'), 'export const rootBrowserSpecs = ["a.spec.ts"];');
  put(join(root, 'scripts/research-baseline.ts'), `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { join, resolve } from 'node:path';
    export const resolvePackageManager = () => ({file:process.execPath,prefix:['fixture-pnpm']});
    export async function runRecordedCommand(file, [pnpm, task], { cwd }) {
      const fault = process.env.FIXTURE_FAULT;
      let exitCode = 0;
      if (task === 'exec') {
        const assertions = [{status: 'passed'}];
        const unit = {success:true, testResults:[{name:resolve(cwd,'tests/a.test.ts'),status:'passed',assertionResults:assertions}]};
        writeFileSync(join(process.env.RUNNER_TEMP,'m01-m03-1-1','targeted-tests.json'), JSON.stringify(unit));
        if (fault === 'unit-exit') exitCode = 7;
      }
      if (task === 'test:browser') {
        const dir = join(cwd, 'test-results/browser/new/root');
        mkdirSync(dir,{recursive:true});
        writeFileSync(join(dir,'results.json'), JSON.stringify({errors:[],stats:{expected:1,unexpected:fault==='browser-report'?1:0,flaky:0,skipped:0},suites:[{file:'a.spec.ts'}]}));
      }
      return {stdout:task==='--version'?'10.30.3':'', stderr:'', termination:'NONE', exitCode, argv:[file,pnpm,task]};
    }
    export const statusFromObservation = o => o.exitCode === 0 ? 'PASS' : 'FAIL';
    export const writeCommandEvidence = (o, dir, name, status) => ({...o,name,status});
  `);
  const baseSha = commit('base');
  put(join(root, 'tests/a.test.ts'), 'export {};\n');
  const repair = commit('repair'), tree = git('rev-parse', 'HEAD^{tree}');
  put(join(root, 'package.json'), '{"type":"module","packageManager":"pnpm@10.30.3","scripts":{"later-control-input":"changed"}}');
  put(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  put(join(root, runner), runnerBytes);
  put(join(root, 'scripts/validate-m01-m03-integration.test.mjs'), '');
  put(join(root, manifestPath), JSON.stringify({ schemaVersion: 1, repository, baseSha, auditAncestorSha: baseSha,
    expectedTreeSha: wrongTree ? git('rev-parse', baseSha + '^{tree}') : tree, heads: [{ pr: 1, sha: repair }],
    tests: ['tests/a.test.ts'], browserSuite: 'root', releaseApproved: false }));
  const validationSha = commit('control checkout has the merged repair plus unrelated install input');
  const evidence = join(temp, 'm01-m03-1-1'), output = join(temp, 'outputs');
  const env = { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', GITHUB_REPOSITORY: repository,
    VALIDATION_SHA: validationSha, RUNNER_TEMP: temp, GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_OUTPUT: output };
  const invoke = (args, extra) => {
    const result = spawnSync(process.execPath, args, { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.ifError(result.error);
    return result;
  };
  const assemble = () => invoke([runner, 'assemble']);
  const validate = fault => invoke([join(evidence, 'validate-m01-m03-integration.mjs'), 'validate'],
    { INTEGRATED_HEAD: readFileSync(output, 'utf8').trim().split('=')[1], FIXTURE_FAULT: fault });
  const receipt = name => JSON.parse(readFileSync(join(evidence, name + '.json')));
  return { assemble, validate, git, receipt, tree, validationSha, root };
}

test('a later control checkout cannot add merged main inputs to the original snapshot', t => {
  const f = fixture(t), result = f.assemble();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.git('rev-parse', 'HEAD^{tree}'), f.tree);
  assert.equal(f.git('ls-files', 'pnpm-workspace.yaml'), '');
  assert.equal(JSON.parse(readFileSync(join(f.root, 'package.json'))).scripts, undefined);
  assert.equal(f.receipt('assembly').status, 'ASSEMBLED');
  const run = f.validate('');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(f.receipt('validation').status, 'PASS');
  assert.equal(f.receipt('validation').releaseApproved, false);
});

test('a tree mismatch blocks setup; a changed HEAD blocks command execution', t => {
  const wrong = fixture(t, true);
  assert.equal(wrong.assemble().status, 1);
  assert.match(wrong.receipt('assembly').issues[0].message, /Expected tree/);
  const changed = fixture(t);
  assert.equal(changed.assemble().status, 0);
  changed.git('checkout', '--detach', changed.validationSha);
  assert.equal(changed.validate('').status, 1);
  assert.match(changed.receipt('validation').issues[0].message, /HEAD changed/);
  assert.deepEqual(changed.receipt('validation').commands, []);
});

test('a failed unit command with a green report still fails and runs the browser', t => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  assert.equal(f.validate('unit-exit').status, 1);
  const receipt = f.receipt('validation');
  assert.equal(receipt.commands.at(-1).name, '40-root-browser');
  assert.equal(receipt.status, 'FAIL');
});

test('a zero browser exit cannot override a failed Playwright report', t => {
  const f = fixture(t);
  assert.equal(f.assemble().status, 0);
  assert.equal(f.validate('browser-report').status, 1);
  assert.equal(f.receipt('validation').browserReport.stats.unexpected, 1);
  assert.equal(f.receipt('validation').status, 'FAIL');
});
