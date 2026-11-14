// M01 regression selection: an explicit source→test mapping. Renames consider
// both the old and new path. An unknown production path selects the full suite
// and marks the result NEEDS_REVIEW. The quick selector may accelerate
// development but never replaces full release checks. Filenames are data —
// they index maps and join paths; they are never shell fragments.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SourceChange { path: string; status: 'A' | 'M' | 'D' | 'R' | 'C'; previousPath?: string }
export interface SelectionIssue { path: string; code: 'UNMAPPED_SOURCE' | 'STALE_MAPPING' | 'REMOVED_TEST' | 'UNSAFE_NAME' | 'EMPTY_SELECTION'; message: string }
export interface SelectionResult {
  tests: string[];
  coverage: 'FULL' | 'PARTIAL' | 'NONE';
  needsReview: boolean;
  issues: SelectionIssue[];
}

// Test file names must stay plain repository-relative data. Anything else is
// rejected outright so a hostile name can never reach a command line.
const TEST_NAME = /^[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?$/;
const DOC_ONLY = /^(?:docs\/|.*\.md$|.*\.mdx$|CHANGELOG\.md$|LICENSE$|SECURITY\.md$|THIRD_PARTY_NOTICES\.md$)/i;

export const DEFAULT_SOURCE_TEST_MAP: Record<string, string[]> = {
  'packages/storage/store.ts': ['tests/store.test.ts'],
  'packages/capabilities/process.ts': ['tests/capabilities.test.ts', 'tests/browser-runner.test.ts'],
  'packages/capabilities/index.ts': ['tests/capabilities.test.ts'],
  'packages/contracts/index.ts': ['tests/capabilities.test.ts', 'tests/store.test.ts'],
  'packages/contracts/preferences.ts': ['tests/store.test.ts', 'tests/compact-settings.test.ts'],
  'packages/contracts/implementation-evidence.ts': ['tests/research-baseline.test.ts'],
  'packages/core/capability-flags.ts': ['tests/research-baseline.test.ts'],
  'packages/core/service.ts': ['tests/store.test.ts', 'tests/agents-workspace.test.ts'],
  'scripts/test-browser.ts': ['tests/browser-runner.test.ts'],
  'scripts/browser-suites.ts': ['tests/browser-runner.test.ts'],
  'scripts/build.mjs': ['tests/build-runner.test.ts'],
  'scripts/research-baseline.ts': ['tests/research-baseline.test.ts'],
  'scripts/select-regression-tests.ts': ['tests/regression-selection.test.ts'],
  'evals/runner.ts': ['tests/capabilities.test.ts'],
  'evals/cases.ts': ['tests/capabilities.test.ts'],
};

function normalizedRepoPath(path: string): string | null {
  if (typeof path !== 'string' || !path.length) return null;
  const clean = path.replaceAll('\\', '/');
  if (clean.includes('\0') || clean.startsWith('/') || /^[A-Za-z]:/.test(clean) || clean.split('/').some(part => part === '..')) return null;
  return clean;
}

export function discoverTestFiles(testDir: string): string[] {
  return readdirSync(testDir, { recursive: true }).map(String).map(path => path.replaceAll(sep, '/'))
    .filter(path => /\.test\.[cm]?[jt]sx?$/.test(path));
}

export function selectRegressionTests(changes: readonly SourceChange[], existingTests: readonly string[], mapping: Record<string, string[]> = DEFAULT_SOURCE_TEST_MAP): SelectionResult {
  const existing = new Set(existingTests);
  for (const name of existingTests) if (!TEST_NAME.test(name)) throw new Error(`Unsafe test name in suite index: ${name}`);
  const selected = new Set<string>();
  const issues: SelectionIssue[] = [];
  let sawCodeChange = false;
  let forcedFull = false;
  const selectFor = (sourcePath: string) => {
    const mapped = mapping[sourcePath] ?? [];
    const live = mapped.filter(test => {
      if (!TEST_NAME.test(test)) { issues.push({ path: sourcePath, code: 'UNSAFE_NAME', message: `Mapping lists an unsafe test name: ${test}` }); return false; }
      if (!existing.has(test)) { issues.push({ path: sourcePath, code: 'STALE_MAPPING', message: `Mapped test is absent: ${test}` }); return false; }
      return true;
    });
    if (!live.length) {
      forcedFull = true;
      issues.push({ path: sourcePath, code: 'UNMAPPED_SOURCE', message: mapped.length ? `Every mapped test for ${sourcePath} is gone` : `No mapping covers ${sourcePath}` });
      return;
    }
    for (const test of live) selected.add(test);
  };
  // Renames consider both old and new paths: expand them into a deletion plus
  // an addition so the old source's mapped tests are selected no matter what
  // the destination is classified as.
  const expanded: SourceChange[] = [];
  for (const change of changes) {
    if (change.status === 'R' && change.previousPath !== undefined)
      expanded.push({ path: change.previousPath, status: 'D' }, { path: change.path, status: 'A' });
    else if (change.status === 'C' && change.previousPath !== undefined)
      expanded.push({ path: change.path, status: 'A' });
    else expanded.push(change);
  }
  for (const change of expanded) {
    const path = normalizedRepoPath(change.path);
    if (path === null) {
      forcedFull = true;
      issues.push({ path: String(change.path), code: 'UNSAFE_NAME', message: 'Changed path is not a safe repository-relative name' });
      continue;
    }
    const isTestFile = /\.test\.[cm]?[jt]sx?$/.test(path);
    if (isTestFile) {
      if (change.status === 'D') issues.push({ path, code: 'REMOVED_TEST', message: `Test file was deleted: ${path}` });
      else if (existing.has(path)) selected.add(path);
      else issues.push({ path, code: 'REMOVED_TEST', message: `Changed test file is absent from the suite index: ${path}` });
      sawCodeChange = true;
      continue;
    }
    if (DOC_ONLY.test(path)) continue;
    sawCodeChange = true;
    selectFor(path);
  }
  if (forcedFull) {
    return { tests: [...existing].sort(), coverage: 'FULL', needsReview: true, issues };
  }
  const tests = [...selected].sort();
  if (!tests.length && sawCodeChange)
    issues.push({ path: '', code: 'EMPTY_SELECTION', message: 'Selection would run zero tests for code changes' });
  if (!tests.length)
    return { tests, coverage: 'NONE', needsReview: issues.some(i => i.code !== 'REMOVED_TEST'), issues };
  return { tests, coverage: 'PARTIAL', needsReview: issues.length > 0, issues };
}

export function changedSources(root: string, baseRef: string): SourceChange[] {
  const out = execFileSync('git', ['-C', root, 'diff', '--name-status', '-M', `${baseRef}...HEAD`], { encoding: 'utf8', windowsHide: true });
  const changes: SourceChange[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts[0]!;
    if (status.startsWith('R') || status.startsWith('C'))
      changes.push({ status: status[0] as 'R' | 'C', previousPath: parts[1]!, path: parts[2]! });
    else changes.push({ status: status as SourceChange['status'], path: parts[1]! });
  }
  return changes;
}

export function selectionMain(args: string[]): number {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 && args[baseIndex + 1] ? args[baseIndex + 1] : null;
  if (!base || args.length !== 2) {
    console.error('Usage: tsx scripts/select-regression-tests.ts --base <git-ref>');
    return 2;
  }
  const existing = discoverTestFiles(join(root, 'tests')).map(name => `tests/${name}`);
  const result = selectRegressionTests(changedSources(root, base), existing);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = selectionMain(process.argv.slice(2)); }
  catch (cause) { console.error(cause); process.exitCode = 1; }
}
