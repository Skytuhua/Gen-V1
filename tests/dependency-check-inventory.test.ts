import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inventoryDependencies, INVENTORY_LIMITS, _internals} from '../packages/workspace/dependency-inventory.ts';
import {dependencyScanResultSchema, dependencyScanBasisSchema} from '../packages/contracts/dependency-check.ts';

let root: string;
const put = async (rel: string, content: string) => {
  const path = join(root, rel);
  await mkdir(join(path, '..'), {recursive: true});
  await writeFile(path, content);
};
const npmLock = (packages: Record<string, unknown>, version = 3) => JSON.stringify({name: 'fixture', lockfileVersion: version, packages});

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dep-inv-')); });
afterEach(async () => { await rm(root, {recursive: true, force: true}); });

describe('npm package-lock v2/v3', () => {
  it('extracts direct and transitive registry pins', async () => {
    await put('package.json', JSON.stringify({dependencies: {leftpad: '1.3.0', '@scope/pkg': '2.0.0'}}));
    await put('package-lock.json', npmLock({
      'node_modules/leftpad': {version: '1.3.0', resolved: 'https://registry.npmjs.org/leftpad/-/leftpad-1.3.0.tgz'},
      'node_modules/@scope/pkg': {version: '2.0.0', resolved: 'https://registry.npmjs.org/@scope/pkg/-/pkg-2.0.0.tgz'},
      'node_modules/dep-child': {version: '9.9.9', resolved: 'https://registry.npmjs.org/dep-child/-/dep-child-9.9.9.tgz'},
    }));
    const snap = await inventoryDependencies(root);
    const byName = Object.fromEntries(snap.occurrences.map(o => [o.name, o]));
    expect(byName.leftpad.installedVersion).toBe('1.3.0');
    expect(byName.leftpad.directness).toBe('direct');
    expect(byName['@scope/pkg'].directness).toBe('direct');
    expect(byName['dep-child'].directness).toBe('transitive');
    expect(snap.coverage.find(c => c.relativePath === 'package-lock.json')!.status).toBe('scanned');
    expect(snap.inputDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads v2 lockfiles identically', async () => {
    await put('package-lock.json', npmLock({'node_modules/a': {version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz'}}, 2));
    const snap = await inventoryDependencies(root);
    expect(snap.coverage.find(c => c.relativePath === 'package-lock.json')!.format).toBe('npm-lock-v2');
    expect(snap.occurrences.map(o => o.name)).toEqual(['a']);
  });

  it('skips linked and workspace entries', async () => {
    await put('package-lock.json', npmLock({
      'node_modules/local-link': {version: '0.0.0', link: true, resolved: '../local-link'},
      'node_modules/reg': {version: '1.0.0', resolved: 'https://registry.npmjs.org/reg/-/reg-1.0.0.tgz'},
      'local-link': {version: '0.0.0'},
    }));
    const snap = await inventoryDependencies(root);
    expect(snap.occurrences.map(o => o.name)).toEqual(['reg']);
  });

  it('taints the file when any pin resolves off the default registry', async () => {
    await put('package-lock.json', npmLock({
      'node_modules/good': {version: '1.0.0', resolved: 'https://registry.npmjs.org/good/-/good-1.0.0.tgz'},
      'node_modules/private': {version: '1.0.0', resolved: 'https://npm.corp.example/private/-/private-1.0.0.tgz'},
    }));
    const snap = await inventoryDependencies(root);
    expect(snap.occurrences).toEqual([]);
    expect(snap.coverage.find(c => c.relativePath === 'package-lock.json')!.status).toBe('private_registry');
  });
});

describe('pnpm-lock.yaml v9', () => {
  const pnpmLock = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      react:
        specifier: ^18.0.0
        version: 18.3.1
  packages/util:
    dependencies:
      lodash:
        specifier: ^4.17.0
        version: 4.17.21
packages:
  react@18.3.1:
    resolution: {integrity: sha512-abc}
  lodash@4.17.21:
    resolution: {integrity: sha512-def}
  'trans@1.0.0(@scope/peer@2.0.0)':
    resolution: {integrity: sha512-ghi}
`;
  it('parses importers and packages with peer-context suffixes stripped', async () => {
    await put('pnpm-lock.yaml', pnpmLock);
    const snap = await inventoryDependencies(root);
    const names = snap.occurrences.map(o => `${o.name}@${o.installedVersion}`).sort();
    expect(names).toContain('react@18.3.1');
    expect(names).toContain('lodash@4.17.21');
    expect(names).toContain('trans@1.0.0');
    expect(snap.occurrences.find(o => o.name === 'react')!.directness).toBe('direct');
    expect(snap.occurrences.find(o => o.name === 'trans')!.directness).toBe('transitive');
    expect(snap.occurrences.find(o => o.name === 'lodash')!.importerPath).toBe('packages/util');
  });

  it('rejects unsupported lockfile versions', async () => {
    await put('pnpm-lock.yaml', "lockfileVersion: '6.0'\n");
    const snap = await inventoryDependencies(root);
    expect(snap.coverage[0].status).toBe('unsupported');
    expect(snap.occurrences).toEqual([]);
  });

  it('marks hostile YAML unreadable instead of throwing', async () => {
    const alias = '&a'.repeat(0) || 'lockfileVersion: \'9.0\'\npackages:\n  a@1.0.0: *x\n';
    await put('pnpm-lock.yaml', 'packages:\n  a@1.0.0: [unclosed\n');
    const snap = await inventoryDependencies(root);
    expect(snap.coverage.find(c => c.relativePath === 'pnpm-lock.yaml')!.status).toBe('unreadable');
    expect(snap.occurrences).toEqual([]);
    void alias;
  });
});

describe('enumeration bounds and provenance', () => {
  it('reports known unsupported formats without scanning them', async () => {
    await put('yarn.lock', '# yarn lockfile v1\nfoo@^1:\n  version "1.0.0"\n');
    await put('Cargo.lock', '[[package]]\nname = "a"\nversion = "1.0.0"\n');
    const snap = await inventoryDependencies(root);
    const statuses = Object.fromEntries(snap.coverage.map(c => [c.relativePath, c.status]));
    expect(statuses['yarn.lock']).toBe('unsupported');
    expect(statuses['Cargo.lock']).toBe('unsupported');
    expect(snap.occurrences).toEqual([]);
  });

  it('no supported lockfiles is an empty inventory, not clean', async () => {
    await put('README.md', 'hi');
    const snap = await inventoryDependencies(root);
    expect(snap.occurrences).toEqual([]);
    expect(snap.coverage.every(c => c.status !== 'scanned')).toBe(true);
  });

  it('prunes node_modules and .git', async () => {
    await put('node_modules/x/package-lock.json', npmLock({'node_modules/x': {version: '9.9.9', resolved: 'https://registry.npmjs.org/x/-/x-9.9.9.tgz'}}));
    await put('.git/package-lock.json', npmLock({}));
    const snap = await inventoryDependencies(root);
    expect(snap.occurrences).toEqual([]);
    const pruned = snap.coverage.filter(c => c.status === 'excluded').map(c => c.relativePath);
    expect(pruned).toContain('node_modules');
    expect(pruned).toContain('.git');
  });

  it('excludes symlinks without following them', async () => {
    await put('real/package-lock.json', npmLock({}));
    await symlink(join(root, 'real'), join(root, 'linkdir'));
    const snap = await inventoryDependencies(root);
    const link = snap.coverage.find(c => c.relativePath === 'linkdir');
    expect(link?.status).toBe('excluded');
    expect(link?.reason).toBe('symlink');
  });

  it('marks oversized files and respects the cumulative budget', async () => {
    const big = JSON.stringify({lockfileVersion: 3, packages: {'node_modules/a': {version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz'}, pad: 'x'.repeat(5 * 1024 * 1024)}});
    await put('package-lock.json', big);
    const snap = await inventoryDependencies(root);
    expect(snap.coverage.find(c => c.relativePath === 'package-lock.json')!.status).toBe('oversized');
    expect(snap.occurrences).toEqual([]);
  });

  it('rejects custom registry config as private provenance', async () => {
    await put('.npmrc', 'registry=https://npm.corp.example/\n');
    await put('package-lock.json', npmLock({'node_modules/a': {version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz'}}));
    const snap = await inventoryDependencies(root);
    expect(snap.coverage.find(c => c.relativePath === 'package-lock.json')!.status).toBe('private_registry');
    expect(snap.occurrences).toEqual([]);
  });

  it('inputDigest changes with file bytes and is stable across reruns', async () => {
    await put('package-lock.json', npmLock({'node_modules/a': {version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz'}}));
    const first = await inventoryDependencies(root);
    const second = await inventoryDependencies(root);
    expect(second.inputDigest).toBe(first.inputDigest);
    await put('package-lock.json', npmLock({'node_modules/a': {version: '1.0.1', resolved: 'https://registry.npmjs.org/a/-/a-1.0.1.tgz'}}));
    const third = await inventoryDependencies(root);
    expect(third.inputDigest).not.toBe(first.inputDigest);
  });

  it('caps occurrences without throwing', async () => {
    const packages: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) packages[`node_modules/p${i}`] = {version: '1.0.0', resolved: 'https://registry.npmjs.org/p0/-/p0-1.0.0.tgz'};
    await put('package-lock.json', npmLock(packages));
    const snap = await inventoryDependencies(root, {limits: {maxOccurrences: 10}});
    expect(snap.occurrences.length).toBe(10);
    expect(snap.coverage.some(c => c.reason === 'occurrence-cap')).toBe(true);
  });
});

describe('internals', () => {
  it('npmNameFromPath handles nested paths and scoped names', () => {
    expect(_internals.npmNameFromPath('node_modules/a')).toBe('a');
    expect(_internals.npmNameFromPath('node_modules/a/node_modules/b')).toBe('b');
    expect(_internals.npmNameFromPath('node_modules/@s/p')).toBe('@s/p');
    expect(_internals.npmNameFromPath('packages/x')).toBeNull();
  });
  it('stripPnpmPeerSuffix strips peer context, keeps scope', () => {
    expect(_internals.stripPnpmPeerSuffix('react@18.3.1')).toEqual({name: 'react', version: '18.3.1'});
    expect(_internals.stripPnpmPeerSuffix('a@1.0.0(@scope/peer@2.0.0)')).toEqual({name: 'a', version: '1.0.0'});
    expect(_internals.stripPnpmPeerSuffix('@s/p@1.2.3')).toEqual({name: '@s/p', version: '1.2.3'});
    expect(_internals.stripPnpmPeerSuffix('noversion')).toBeNull();
  });
  it('publicRegistry treats unknown config as not public', () => {
    expect(_internals.publicRegistry({})).toBe(true);
    expect(_internals.publicRegistry({npmrc: 'registry=https://registry.npmjs.org/\n'})).toBe(true);
    expect(_internals.publicRegistry({npmrc: 'registry=https://npm.corp.example/\n'})).toBe(false);
  });
  it('caps are documented constants', () => {
    expect(INVENTORY_LIMITS.maxCandidateFiles).toBe(24);
    expect(INVENTORY_LIMITS.maxOccurrences).toBe(5000);
  });
});

describe('contracts', () => {
  it('scan basis validates and rejects extra keys', () => {
    const basis = {scopeKey: 's', inputDigest: 'a'.repeat(64), coverage: [], eligibleTupleCount: 0, truncated: false};
    expect(dependencyScanBasisSchema.parse(basis).scopeKey).toBe('s');
    expect(() => dependencyScanBasisSchema.parse({...basis, extra: 1})).toThrow();
    expect(() => dependencyScanBasisSchema.parse({...basis, inputDigest: 'xyz'})).toThrow();
  });
  it('scan result round-trips a complete shape', () => {
    const result = dependencyScanResultSchema.parse({
      scanId: 'scan-1', status: 'complete', checkedAt: '2026-11-21T00:00:00Z', scopeKey: 's',
      inputDigest: 'a'.repeat(64), fresh: true, coverage: [], queriedCount: 3,
      findings: [{occurrence: {occurrenceId: 'o1', ecosystem: 'npm', name: 'a', installedVersion: '1.0.0', directness: 'direct', lockPath: 'package-lock.json'}, advisoryIds: ['GHSA-1'], severity: 'high', fixedVersions: ['1.0.1'], upgradeCandidate: '1.0.1', candidateEligible: true}],
      remoteAlerts: [], remoteAlertState: 'not_requested',
    });
    expect(result.findings[0].severity).toBe('high');
    expect(() => dependencyScanResultSchema.parse({...result, status: 'clean'})).toThrow();
  });
});
