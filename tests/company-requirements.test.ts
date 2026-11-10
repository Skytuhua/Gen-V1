import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCompanyRequirements, parseCompanyRequirements, preserveCompanyAssessments } from '../scripts/company-requirements.ts';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(root, 'docs/company/requirements.md');
const backlogPath = resolve(root, 'docs/company/feature-backlog.json');
const scriptPath = resolve(root, 'scripts/company-requirements.ts');
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const source = readFileSync(sourcePath, 'utf8');
const sourceHash = '7ee0b8ee083ce9e91963e3ec5272f266a44802c7b64626f911b1771b379640bf';
const firstRow = source.split(/\r?\n/).find(line => line.startsWith('| **MGR-01 '))!;
const lastRow = source.split(/\r?\n/).find(line => line.startsWith('| **EVAL-09 '))!;

describe('company requirement source custody and traceability', () => {
  it('preserves the pinned full source and imports all 221 requirements in 27 areas', () => {
    expect(createHash('sha256').update(readFileSync(sourcePath)).digest('hex')).toBe(sourceHash);
    const catalog = parseCompanyRequirements(source);
    expect(catalog.version).toBe(1);
    expect(catalog.sourceSHA256).toBe(sourceHash);
    expect(catalog.baseline).toEqual({
      reviewedGen: '9f23537334f2a1dc6c3bbe00d0444f8e86b57e28',
      currentService: 'bcb9ee7c6196243b2647e917a1ccb7b1d0793770',
    });
    expect(catalog.counts).toEqual({ total: 221, areas: 27, P0: 102, P1: 100, P2: 19 });
    expect(catalog.areas).toHaveLength(27);
    expect(catalog.requirements).toHaveLength(221);
    expect(new Set(catalog.requirements.map(row => row.id)).size).toBe(221);
    expect(catalog.requirements[0].id).toBe('MGR-01');
    expect(catalog.requirements.at(-1)!.id).toBe('EVAL-09');
  });

  it('retains every complete behavior, acceptance proof and actual UTF-8 source line', () => {
    const catalog = parseCompanyRequirements(source);
    const lines = source.split(/\r?\n/);
    for (const requirement of catalog.requirements) {
      const fields = lines[requirement.sourceLine - 1].split('|').slice(1, -1).map(field => field.trim());
      expect(fields[0]).toBe(`**${requirement.id} ${requirement.title}**`);
      expect(requirement.requiredBehavior).toBe(fields[2]);
      expect(requirement.acceptanceProof).toBe(fields[3]);
      expect(requirement.acceptanceProof.length).toBeGreaterThan(20);
      expect(requirement.implementationStatus).toBe('unassessed');
      expect(requirement.activationStatus).toBe('disabled');
      expect(requirement.evidence).toEqual([]);
      expect(requirement.remainingGates).toEqual([]);
    }
    expect(catalog.requirements.find(row => row.id === 'ORG-02')!.baseline).toBe('not_established');
    expect(catalog.requirements[0].owners).toEqual(['G', 'C']);
  });

  it.each([
    ['duplicate ID', () => source.replace('| **MGR-02 ', '| **MGR-01 ')],
    ['missing requirement', () => source.replace(firstRow, '')],
    ['truncated catalog', () => source.slice(0, source.indexOf(lastRow))],
    ['truncated table row', () => source.replace(firstRow, firstRow.slice(0, -20))],
    ['missing acceptance proof', () => source.replace(firstRow, firstRow.split('|').slice(0, -2).join('|') + '| |')],
    ['invalid priority', () => source.replace(firstRow, firstRow.replace('P0 /', 'P9 /'))],
    ['unknown owner', () => source.replace(firstRow, firstRow.replace('G+C', 'G+X'))],
    ['duplicate owner', () => source.replace(firstRow, firstRow.replace('G+C', 'G+G'))],
    ['invalid baseline', () => source.replace(firstRow, firstRow.replace('/ extend', '/ complete'))],
    ['missing sequential ID', () => source.replace('| **MGR-08 ', '| **MGR-09 ')],
    ['wrong priority totals', () => source.replace(firstRow, firstRow.replace('P0 /', 'P1 /'))],
    ['wrong area', () => source.replace('(MGR)', '(OTHER)')],
  ])('rejects %s instead of silently dropping source requirements', (_name, change) => {
    expect(() => parseCompanyRequirements(change())).toThrow(/requirement|catalog|metadata|area|table|acceptance|priority|owner|baseline/i);
  });
});

describe('company requirement assessment fidelity', () => {
  it('checks source fields while allowing separately validated explicit assessments', () => {
    const catalog = parseCompanyRequirements(source);
    const requirement = catalog.requirements[0];
    requirement.implementationStatus = 'partial';
    requirement.activationStatus = 'blocked';
    requirement.evidence = [{ kind: 'test', reference: 'pnpm exec vitest run tests/company-requirements.test.ts', scope: 'local catalog fixture only' }];
    requirement.remainingGates = ['Live company acceptance remains unverified.'];
    expect(() => checkCompanyRequirements(source, catalog)).not.toThrow();
    expect(preserveCompanyAssessments(parseCompanyRequirements(source), catalog).requirements[0]).toEqual(requirement);
    expect(() => checkCompanyRequirements(source, { ...catalog, sourceSHA256: '0'.repeat(64) })).toThrow(/source|digest|fidelity/i);
    const changed = structuredClone(catalog);
    changed.requirements[0].acceptanceProof = 'Fabricated acceptance';
    expect(() => checkCompanyRequirements(source, changed)).toThrow(/fidelity|source|acceptance/i);
  });

  it.each([
    { implementationStatus: 'complete' },
    { implementationStatus: ['partial'] },
    { activationStatus: 'ready' },
    { activationStatus: ['enabled'] },
    { evidence: ['tests passed'] },
    { evidence: [{ kind: 'test', reference: '', scope: 'fixture' }] },
    { evidence: [{ kind: ['test'], reference: 'test', scope: 'fixture' }] },
    { evidence: [{ kind: 'test', reference: 'test', scope: 'fixture', passed: true }] },
    { remainingGates: [false] },
  ])('rejects malformed assessment metadata %j', changes => {
    const catalog = parseCompanyRequirements(source);
    Object.assign(catalog.requirements[0], changes);
    expect(() => checkCompanyRequirements(source, catalog)).toThrow(/assessment|evidence|status|gate/i);
  });

  it('does not transfer assessment claims across a changed source digest', () => {
    const catalog = parseCompanyRequirements(source);
    catalog.sourceSHA256 = '0'.repeat(64);
    expect(() => preserveCompanyAssessments(parseCompanyRequirements(source), catalog)).toThrow(/source|digest/i);
  });
});

describe('company requirements CLI', () => {
  it('checks the stored catalog without writing source or assessment data, from any cwd', () => {
    const beforeSource = readFileSync(sourcePath);
    const beforeCatalog = readFileSync(backlogPath);
    const result = spawnSync(process.execPath, ['--import', tsxLoader, scriptPath, '--check'], { cwd: tmpdir(), encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/221 requirements.*27 areas/i);
    expect(readFileSync(sourcePath)).toEqual(beforeSource);
    expect(readFileSync(backlogPath)).toEqual(beforeCatalog);
    expect(() => checkCompanyRequirements(source, JSON.parse(beforeCatalog.toString('utf8')))).not.toThrow();
  });

  it('requires one explicit --check or --write mode', () => {
    const before = readFileSync(backlogPath);
    for (const args of [[], ['--check', '--write'], ['--unknown']]) {
      const result = spawnSync(process.execPath, ['--import', tsxLoader, scriptPath, ...args], { cwd: root, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/usage|--check|--write/i);
    }
    expect(readFileSync(backlogPath)).toEqual(before);
  });
});
