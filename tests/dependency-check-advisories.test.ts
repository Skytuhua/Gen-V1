import {describe, it, expect} from 'vitest';
import {queryOsv, type OsvTransport} from '../packages/workspace/dependency-osv.ts';
import {normalizeFindings, matchRemoteAlerts, cvss31BaseScore, type OsvRecord, type RemoteAlertEvidence} from '../packages/workspace/dependency-normalize.ts';
import type {DependencyOccurrence} from '../packages/contracts/dependency-check.ts';

const occ = (name: string, version: string, over: Partial<DependencyOccurrence> = {}): DependencyOccurrence => ({
  occurrenceId: 'o-' + name, ecosystem: 'npm', name, installedVersion: version, directness: 'direct', lockPath: 'package-lock.json', ...over,
});

const vuln = (id: string, over: Partial<OsvRecord> = {}): OsvRecord => ({
  id, affected: [{package: {ecosystem: 'npm', name: 'a'}, ranges: [{type: 'SEMVER', events: [{introduced: '0'}, {fixed: '1.0.1'}]}]}],
  database_specific: {severity: 'HIGH'}, ...over,
});

const okJson = (body: unknown) => ({status: 200, headers: {get: () => null}, text: async () => JSON.stringify(body)});

function transport(replies: Record<string, unknown[] | ((body: unknown, url: string) => unknown)>) {
  const calls: {url: string; body: unknown}[] = [];
  const fn: OsvTransport = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({url, body});
    const key = url;
    const handler = replies[key];
    if (!handler) throw Object.assign(new Error('no reply for ' + key), {status: 500});
    if (typeof handler === 'function') return okJson(handler(body, url));
    const next = Array.isArray(handler) ? (handler.length > 1 ? handler.shift() : handler[0]) : handler;
    if (typeof next === 'function') return okJson(next(body, url));
    return okJson(next);
  };
  return {fn, calls};
}

describe('queryOsv batching and order', () => {
  it('sends exact tuples in one batch and aligns results by index', async () => {
    const {fn, calls} = transport({'https://api.osv.dev/v1/querybatch': [{results: [{vulns: [{id: 'OSV-1', modified: 'm'}]}, {vulns: []}]}], 'https://api.osv.dev/v1/vulns/OSV-1': [vuln('OSV-1')]});
    const scan = await queryOsv([occ('a', '1.0.0'), occ('b', '2.0.0')], {transport: fn});
    expect(calls[0].body).toEqual({queries: [
      {package: {ecosystem: 'npm', name: 'a'}, version: '1.0.0'},
      {package: {ecosystem: 'npm', name: 'b'}, version: '2.0.0'},
    ]});
    expect(scan.status).toBe('complete');
    expect(scan.outcomes[0].vulns[0].id).toBe('OSV-1');
    expect(scan.outcomes[1].vulns).toEqual([]);
    expect(Object.keys(scan.details)).toEqual(['OSV-1']);
  });

  it('dedupes identical tuples and fans the answer back out', async () => {
    const {fn, calls} = transport({'https://api.osv.dev/v1/querybatch': [{results: [{vulns: []}]}]});
    const scan = await queryOsv([occ('a', '1.0.0'), occ('a', '1.0.0', {occurrenceId: 'o2'})], {transport: fn});
    expect(calls).toHaveLength(1);
    expect((calls[0].body as {queries: unknown[]}).queries).toHaveLength(1);
    expect(scan.outcomes).toHaveLength(2);
  });

  it('chunks queries above the batch size', async () => {
    const many = Array.from({length: 150}, (_, i) => occ('p' + i, '1.0.0'));
    const replies: Record<string, unknown[]> = {'https://api.osv.dev/v1/querybatch': [{results: Array(100).fill({vulns: []})}, {results: Array(50).fill({vulns: []})}]};
    const {fn, calls} = transport(replies);
    const scan = await queryOsv(many, {transport: fn});
    expect((calls[0].body as {queries: unknown[]}).queries).toHaveLength(100);
    expect((calls[1].body as {queries: unknown[]}).queries).toHaveLength(50);
    expect(scan.status).toBe('complete');
  });
});

describe('queryOsv pagination and failure handling', () => {
  it('follows per-query page tokens for only the affected query', async () => {
    const replies: Record<string, unknown[] | ((b: unknown) => unknown)> = {
      'https://api.osv.dev/v1/querybatch': [
        {results: [{vulns: [{id: 'OSV-1', modified: 'm'}], next_page_token: 't1'}, {vulns: []}]},
        (b: unknown) => ({results: [{vulns: [{id: 'OSV-2', modified: 'm'}]}], echo: b}),
      ],
      'https://api.osv.dev/v1/vulns/OSV-1': [vuln('OSV-1')],
      'https://api.osv.dev/v1/vulns/OSV-2': [vuln('OSV-2')],
    };
    const {fn, calls} = transport(replies);
    const scan = await queryOsv([occ('a', '1.0.0'), occ('b', '2.0.0')], {transport: fn});
    const page2 = calls.find(c => (c.body as {queries: {page_token?: string}[]}).queries[0].page_token === 't1');
    expect(page2).toBeTruthy();
    expect(scan.outcomes[0].vulns.map(v => v.id).sort()).toEqual(['OSV-1', 'OSV-2']);
  });

  it('treats a malformed slot as indeterminate, never empty', async () => {
    const {fn} = transport({'https://api.osv.dev/v1/querybatch': [{results: [{vulns: 'not-an-array'}, {vulns: []}]}]});
    const scan = await queryOsv([occ('a', '1.0.0'), occ('b', '2.0.0')], {transport: fn});
    expect(scan.status).toBe('partial');
    expect(scan.outcomes[0].indeterminate).toBe(true);
    expect(scan.outcomes[1].indeterminate).toBe(false);
    expect(scan.coverage.join()).toMatch(/malformed-slot/);
  });

  it('marks the whole batch indeterminate on cardinality mismatch', async () => {
    const {fn} = transport({'https://api.osv.dev/v1/querybatch': [{results: [{vulns: []}]}]});
    const scan = await queryOsv([occ('a', '1.0.0'), occ('b', '2.0.0')], {transport: fn});
    expect(scan.status).toBe('unavailable');
    expect(scan.coverage.join()).toMatch(/cardinality-mismatch/);
  });

  it('reports missing detail responses as coverage, not absence', async () => {
    const failing: OsvTransport = async (url) => {
      if (url.includes('/vulns/')) throw new Error('boom');
      return okJson({results: [{vulns: [{id: 'OSV-X', modified: 'm'}]}]});
    };
    const scan = await queryOsv([occ('a', '1.0.0')], {transport: failing});
    expect(scan.status).toBe('partial');
    expect(scan.details['OSV-X']).toBeUndefined();
    expect(scan.coverage.join()).toMatch(/OSV-X/);
    const norm = normalizeFindings([occ('a', '1.0.0')], scan);
    expect(norm.findings).toEqual([]);
    expect(norm.coverage.join()).toMatch(/detail-missing-OSV-X/);
  });

  it('retries once on transient 429 and fails closed on repeated failure', async () => {
    let n = 0;
    const flaky: OsvTransport = async () => {n++; return {status: 429, headers: {get: () => '0'}, text: async () => ''};};
    const scan = await queryOsv([occ('a', '1.0.0')], {transport: flaky});
    expect(n).toBe(2);
    expect(scan.status).toBe('unavailable');
  });

  it('aborts on cancel and surfaces OSV_CANCELLED', async () => {
    const controller = new AbortController();
    const blocking: OsvTransport = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)));
    await expect(queryOsv([occ('a', '1.0.0')], {transport: blocking, signal: (controller.abort(), controller.signal)})).rejects.toMatchObject({code: 'OSV_CANCELLED'});
  });

  it('sends no credentials, project paths, or lockfile bytes', async () => {
    const {fn, calls} = transport({'https://api.osv.dev/v1/querybatch': [{results: [{vulns: []}]}]});
    await queryOsv([occ('@scope/pkg', '9.9.9', {lockPath: 'secret/path/package-lock.json'})], {transport: fn});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.osv.dev/v1/querybatch');
    const sent = JSON.stringify(calls[0].body);
    expect(sent).not.toMatch(/secret|package-lock/);
    expect(sent).toBe('{"queries":[{"package":{"ecosystem":"npm","name":"@scope/pkg"},"version":"9.9.9"}]}');
  });
});

describe('normalizeFindings', () => {
  const scanFor = (records: Record<string, OsvRecord>, ids = Object.keys(records)) => ({
    outcomes: [{index: 0, vulns: ids.map(id => ({id, modified: 'm'})), indeterminate: false}],
    details: records as Record<string, unknown>,
  });

  it('collects fixed endpoints only from applicable intervals', async () => {
    const records = {
      'OSV-1': vuln('OSV-1', {affected: [{package: {ecosystem: 'npm', name: 'a'}, ranges: [{type: 'SEMVER', events: [{introduced: '0'}, {fixed: '1.0.1'}]}]}]}),
      'OSV-2': vuln('OSV-2', {affected: [{package: {ecosystem: 'npm', name: 'a'}, ranges: [{type: 'SEMVER', events: [{introduced: '1.0.1'}, {fixed: '1.0.5'}]}]}]}),
    };
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toHaveLength(1);
    expect(n.findings[0].fixedVersions).toEqual(['1.0.1', '1.0.5']);
    // 1.0.1 is inside OSV-2's range; candidate must clear every known range.
    expect(n.findings[0].upgradeCandidate).toBe('1.0.5');
  });

  it('offers no upgrade when ranges are git-only or unbounded-indeterminate', () => {
    const records = {'OSV-3': vuln('OSV-3', {affected: [{package: {ecosystem: 'npm', name: 'a'}, ranges: [{type: 'GIT', events: [{introduced: 'abc'}]}]}]})};
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toEqual([]); // git-only record can't establish affected state
    const records2 = {'OSV-4': vuln('OSV-4', {affected: [{package: {ecosystem: 'npm', name: 'a'}, ranges: [{type: 'SEMVER', events: [{introduced: '0'}]}]}]})};
    const n2 = normalizeFindings([occ('a', '1.0.0')], scanFor(records2));
    expect(n2.findings[0].upgradeCandidate).toBeNull();
    expect(n2.findings[0].candidateEligible).toBe(false);
  });

  it('ignores withdrawn records for findings but records coverage', () => {
    const records = {'OSV-5': vuln('OSV-5', {withdrawn: '2026-01-01T00:00:00Z'})};
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toEqual([]);
    expect(n.coverage.join()).toMatch(/withdrawn/);
  });

  it('groups advisories sharing an alias into one finding', () => {
    const records = {
      'OSV-6': vuln('OSV-6', {aliases: ['GHSA-x'], database_specific: {severity: 'LOW'}}),
      'GHSA-x': vuln('GHSA-x', {aliases: ['OSV-6'], database_specific: {severity: 'CRITICAL'}}),
    };
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toHaveLength(1);
    expect(n.findings[0].advisoryIds.sort()).toEqual(['GHSA-x', 'OSV-6']);
    expect(n.findings[0].severity).toBe('critical');
  });

  it('uses explicit versions lists to establish affected state', () => {
    const records = {'OSV-7': vuln('OSV-7', {affected: [{package: {ecosystem: 'npm', name: 'a'}, versions: ['1.0.0'], ranges: []}]})};
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toHaveLength(1);
    expect(n.findings[0].upgradeCandidate).toBeNull();
  });

  it('keeps separate groups when advisory ids do not intersect', () => {
    const records = {'OSV-8': vuln('OSV-8'), 'OSV-9': vuln('OSV-9')};
    const n = normalizeFindings([occ('a', '1.0.0')], scanFor(records));
    expect(n.findings).toHaveLength(2);
  });
});

describe('severity derivation', () => {
  it('computes a CVSS v3.1 base score from a vector', () => {
    expect(cvss31BaseScore('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBe(9.8);
    expect(cvss31BaseScore('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N')).toBe(1.8);
    expect(cvss31BaseScore('not-a-vector')).toBeNull();
  });
  it('maps database_specific severity and falls back to CVSS', () => {
    const records = {'OSV-10': vuln('OSV-10', {database_specific: {}, severity: [{type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'}]})};
    const n = normalizeFindings([occ('a', '1.0.0')], {outcomes: [{index: 0, vulns: [{id: 'OSV-10', modified: 'm'}], indeterminate: false}], details: records});
    expect(n.findings[0].severity).toBe('critical');
    expect(n.findings[0].severitySource).toMatch(/CVSS_V3 9.8/);
  });
});

describe('matchRemoteAlerts', () => {
  const alert = (over: Partial<RemoteAlertEvidence> = {}): RemoteAlertEvidence => ({
    package: 'a', manifestPath: 'package-lock.json', advisoryIds: ['GHSA-1'], severity: 'high', firstPatched: '1.0.1',
    vulnerableRange: '>= 1.0.0 < 1.0.1', matchedOccurrence: false, ...over,
  });
  const findingFor = (name: string, version: string, ids: string[]) => ({
    occurrence: occ(name, version), advisoryIds: ids, severity: 'high' as const,
    fixedVersions: ['1.0.1'], upgradeCandidate: '1.0.1', candidateEligible: true,
  });

  it('matches when alias, name, manifest and installed version all agree', () => {
    const [out] = matchRemoteAlerts([alert()], [occ('a', '1.0.0')], [findingFor('a', '1.0.0', ['GHSA-1'])]);
    expect(out.matchedOccurrence).toBe(true);
  });
  it('keeps unmatched alerts separate', () => {
    const [out] = matchRemoteAlerts([alert({package: 'other'})], [occ('a', '1.0.0')], [findingFor('a', '1.0.0', ['GHSA-1'])]);
    expect(out.matchedOccurrence).toBe(false);
  });
  it('requires the installed version inside the vulnerable range', () => {
    const [out] = matchRemoteAlerts([alert()], [occ('a', '9.9.9')], []);
    expect(out.matchedOccurrence).toBe(false);
  });
});
