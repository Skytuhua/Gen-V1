import { describe, expect, it } from 'vitest';
import { changedSources, discoverTestFiles, selectRegressionTests, type SourceChange } from '../scripts/select-regression-tests.ts';
import { dirname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));

const existing = [
  'tests/store.test.ts',
  'tests/capabilities.test.ts',
  'tests/browser-runner.test.ts',
  'tests/build-runner.test.ts',
  'tests/research-baseline.test.ts',
  'tests/regression-selection.test.ts',
];
const map = {
  'packages/storage/store.ts': ['tests/store.test.ts'],
  'scripts/test-browser.ts': ['tests/browser-runner.test.ts'],
  'packages/capabilities/process.ts': ['tests/capabilities.test.ts', 'tests/browser-runner.test.ts'],
  'scripts/research-baseline.ts': ['tests/research-baseline.test.ts'],
  'packages/core/old-module.ts': ['tests/store.test.ts'],
  'packages/core/new-module.ts': ['tests/capabilities.test.ts'],
};

const select = (changes: SourceChange[]) => selectRegressionTests(changes, existing, map);

describe('regression test selection', () => {
  it('selects the mapped tests for a modified source file', () => {
    const result = select([{ path: 'packages/storage/store.ts', status: 'M' }]);
    expect(result.tests).toEqual(['tests/store.test.ts']);
    expect(result.coverage).toBe('PARTIAL');
    expect(result.needsReview).toBe(false);
  });

  it('considers both old and new paths for renames', () => {
    const result = select([{ path: 'packages/core/new-module.ts', previousPath: 'packages/core/old-module.ts', status: 'R' }]);
    expect(result.tests.sort()).toEqual(['tests/capabilities.test.ts', 'tests/store.test.ts']);
    expect(result.coverage).toBe('PARTIAL');
  });

  it('preserves the exact names of renamed files containing Unicode or spaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'gen-regression-selection-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    try {
      git('init');
      git('config', 'core.quotePath', 'true');
      git('config', 'commit.gpgSign', 'false');
      const before = 'old café.ts';
      const after = 'new résumé.ts';
      writeFileSync(join(root, before), 'export const value = 42;\n');
      git('add', '--', before);
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Before');
      renameSync(join(root, before), join(root, after));
      git('add', '-A');
      git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'After');
      expect(changedSources(root, 'HEAD~1')).toEqual([{ status: 'R', previousPath: before, path: after }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compares revisions even when a tracked filename matches the revision range', () => {
    const root = mkdtempSync(join(tmpdir(), 'gen-regression-selection-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
    const commit = (message: string) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', message);
    try {
      git('init', '-q');
      writeFileSync(join(root, 'README.md'), 'Initial.');
      git('add', 'README.md'); commit('Before');
      git('branch', 'fixture-base');
      const name = 'fixture-base...HEAD';
      writeFileSync(join(root, name), 'Tracked file with the same spelling as the comparison range.');
      git('add', '--', name); commit('After');
      expect(changedSources(root, 'fixture-base')).toEqual([{ status: 'A', path: name }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the old path coverage when a source is renamed into docs or a test path', () => {
    const toDocs = select([{ path: 'docs/old-module.md', previousPath: 'packages/core/old-module.ts', status: 'R' }]);
    expect(toDocs.tests).toEqual(['tests/store.test.ts']);
    expect(toDocs.coverage).toBe('PARTIAL');
    const toTest = select([{ path: 'tests/new-module.test.ts', previousPath: 'packages/core/old-module.ts', status: 'R' }]);
    expect(toTest.tests).toContain('tests/store.test.ts');
  });

  it('treats a test-to-test rename as a rename, not a removal', () => {
    const result = selectRegressionTests([{ path: 'tests/renamed.test.ts', previousPath: 'tests/old-name.test.ts', status: 'R' }], [...existing, 'tests/renamed.test.ts'], map);
    expect(result.tests).toEqual(['tests/renamed.test.ts']);
    expect(result.issues.filter(i => i.code === 'REMOVED_TEST')).toEqual([]);
  });

  it('still flags a test renamed away to a non-test path', () => {
    const result = select([{ path: 'docs/renamed.md', previousPath: 'tests/old-name.test.ts', status: 'R' }]);
    expect(result.issues.map(i => i.code)).toContain('REMOVED_TEST');
  });

  it('still selects mapped tests for a deleted source file', () => {
    const result = select([{ path: 'packages/storage/store.ts', status: 'D' }]);
    expect(result.tests).toEqual(['tests/store.test.ts']);
  });

  it('selects the full suite and marks NEEDS_REVIEW for an unmapped production path', () => {
    const result = select([{ path: 'packages/core/unmapped-feature.ts', status: 'A' }]);
    expect(result.coverage).toBe('FULL');
    expect(result.needsReview).toBe(true);
    expect(result.tests).toEqual([...existing].sort());
    expect(result.issues.map(i => i.code)).toContain('UNMAPPED_SOURCE');
  });

  it('falls back to the full suite when every mapped test was removed', () => {
    const stale = { 'packages/core/thing.ts': ['tests/gone-1.test.ts', 'tests/gone-2.test.ts'] };
    const result = selectRegressionTests([{ path: 'packages/core/thing.ts', status: 'M' }], existing, stale);
    expect(result.coverage).toBe('FULL');
    expect(result.needsReview).toBe(true);
    expect(result.issues.filter(i => i.code === 'STALE_MAPPING')).toHaveLength(2);
    expect(result.issues.map(i => i.code)).toContain('UNMAPPED_SOURCE');
  });

  it('treats malicious shell-like filenames as data, never shell fragments', () => {
    const hostile = [
      { path: 'packages/core/x;rm -rf /.ts', status: 'M' as const },
      { path: 'packages/core/$(whoami).ts', status: 'A' as const },
      { path: 'packages/core/`id`.ts', status: 'M' as const },
    ];
    const result = select(hostile);
    // The names only index the mapping; they never interpolate into commands.
    expect(result.coverage).toBe('FULL');
    expect(result.issues.map(i => i.code)).toContain('UNMAPPED_SOURCE');
    expect(result.tests.every(test => test.startsWith('tests/'))).toBe(true);
  });

  it('rejects traversal and absolute changed paths as unsafe', () => {
    const result = select([{ path: '../outside.ts', status: 'M' }, { path: 'C:\\Windows\\x.ts', status: 'M' }]);
    expect(result.coverage).toBe('FULL');
    expect(result.issues.filter(i => i.code === 'UNSAFE_NAME')).toHaveLength(2);
  });

  it('records an explicit empty result rather than silently selecting zero tests', () => {
    const docs = select([{ path: 'docs/architecture.md', status: 'M' }, { path: 'README.md', status: 'M' }]);
    expect(docs.tests).toEqual([]);
    expect(docs.coverage).toBe('NONE');
    const removedOnly = select([{ path: 'tests/store.test.ts', status: 'D' }]);
    expect(removedOnly.tests).toEqual([]);
    expect(removedOnly.issues.map(i => i.code)).toContain('REMOVED_TEST');
    const noTestsAfterRemoval = selectRegressionTests(
      [{ path: 'tests/only.test.ts', status: 'D' }], ['tests/only.test.ts'], map);
    expect(noTestsAfterRemoval.coverage).toBe('NONE');
    expect(noTestsAfterRemoval.issues.map(i => i.code)).toContain('REMOVED_TEST');
  });

  it('selects a changed test file itself when it still exists', () => {
    const result = select([{ path: 'tests/store.test.ts', status: 'M' }]);
    expect(result.tests).toEqual(['tests/store.test.ts']);
    expect(result.coverage).toBe('PARTIAL');
  });

  it('discovers the real suite inventory', () => {
    const found = discoverTestFiles(testsDir);
    expect(found.length).toBeGreaterThan(200);
    expect(readdirSync(join(testsDir, 'e2e')).length).toBeGreaterThan(0);
    expect(found).toContain('research-baseline.test.ts');
    expect(found).toContain('regression-selection.test.ts');
    expect(found.every(name => /^[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?$/.test(name))).toBe(true);
  });
});

it('indexes actual nested tests without treating a fixture directory as a test', () => {
  const folder = mkdtempSync(join(tmpdir(), 'regression-test-index-'));
  try {
    const nested = join(folder, 'fixture.test.ts');
    mkdirSync(nested);
    writeFileSync(join(nested, 'nested.test.ts'), '');
    writeFileSync(join(folder, 'root.test.ts'), '');
    expect(discoverTestFiles(folder).sort()).toEqual(['fixture.test.ts/nested.test.ts', 'root.test.ts']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
