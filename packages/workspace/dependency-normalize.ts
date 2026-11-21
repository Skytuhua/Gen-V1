import {createRequire} from 'node:module';
const semver = createRequire(import.meta.url)('semver') as {
  valid:(v:string)=>string|null; gte:(a:string,b:string)=>boolean; gt:(a:string,b:string)=>boolean;
  lt:(a:string,b:string)=>boolean; lte:(a:string,b:string)=>boolean; compare:(a:string,b:string)=>number;
  satisfies:(v:string,range:string)=>boolean;
};
import type {DependencyFinding, DependencyOccurrence, DependencyRemoteAlert, DependencySeverity} from '../contracts/dependency-check.ts';
import type {OsvScanResult} from './dependency-osv.ts';

/**
 * Pure normalizer for advisory evidence (plan r1 §Normalize): groups advisories by
 * id/alias intersection within one occurrence, filters withdrawn records, accepts
 * `fixed` endpoints only from applicable affected intervals, and derives a lowest
 * publishable upgrade candidate — never "latest".
 */

interface OsvAffectedPackage {ecosystem?: string; name?: string}
interface OsvRangeEvent {introduced?: string; fixed?: string; last_affected?: string; limit?: string}
interface OsvRange {type?: string; events?: OsvRangeEvent[]}
interface OsvAffected {package?: OsvAffectedPackage; ranges?: OsvRange[]; versions?: string[]}
export interface OsvRecord {
  id?: string;
  aliases?: string[];
  withdrawn?: string;
  affected?: OsvAffected[];
  severity?: {type?: string; score?: string}[];
  database_specific?: {severity?: string};
}

const OSV_ECOSYSTEM: Record<string, string> = {npm: 'npm', pypi: 'PyPI', 'crates.io': 'crates.io', go: 'Go'};
const GH_SEVERITY: Record<string, DependencySeverity> = {critical: 'critical', high: 'high', moderate: 'medium', medium: 'medium', low: 'low'};
const RANK: Record<DependencySeverity, number> = {unknown: 0, low: 1, medium: 2, high: 3, critical: 4};

/** Minimal CVSS v3.x base-score evaluator for base-metric vectors only. */
export function cvss31BaseScore(vector: string): number | null {
  const m = /^CVSS:3\.[01]\/(.+)$/.exec(vector.trim());
  if (!m) return null;
  const parts = Object.fromEntries(m[1].split('/').map(p => p.split(':')));
  const V = {AV: {N: .85, A: .62, L: .55, P: .2}, AC: {L: .77, H: .44}, UI: {N: .85, R: .62}, S: {U: 'U', C: 'C'}, C: {H: .56, L: .22, N: 0}, I: {H: .56, L: .22, N: 0}, A: {H: .56, L: .22, N: 0}};
  const PRu = {N: .85, L: .62, H: .27}, PRc = {N: .85, L: .68, H: .5};
  const get = <T extends object>(map: T, key: string | undefined) => key !== undefined && key in map ? map[key as keyof T] as number : undefined;
  const av = get(V.AV, parts.AV), ac = get(V.AC, parts.AC), ui = get(V.UI, parts.UI), scope = parts.S;
  const pr = scope === 'C' ? get(PRc, parts.PR) : get(PRu, parts.PR);
  const c = get(V.C, parts.C), i = get(V.I, parts.I), a = get(V.A, parts.A);
  if ([av, ac, ui, pr, c, i, a].some(v => v === undefined) || (scope !== 'U' && scope !== 'C')) return null;
  const isc = 1 - (1 - c!) * (1 - i!) * (1 - a!);
  const impact = scope === 'U' ? 6.42 * isc : 7.52 * (isc - 0.029) - 3.25 * Math.pow(isc - 0.02, 15);
  const exploit = 8.22 * av! * ac! * pr! * ui!;
  if (impact <= 0) return 0;
  const base = scope === 'U' ? impact + exploit : 1.08 * (impact + exploit);
  return Math.min(Math.ceil(base * 10) / 10, 10);
}

const scoreSeverity = (score: number): DependencySeverity => score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low';

function recordSeverity(rec: OsvRecord): {severity: DependencySeverity; source?: string} {
  const named = rec.database_specific?.severity?.toLowerCase();
  if (named && GH_SEVERITY[named]) return {severity: GH_SEVERITY[named], source: `database_specific ${named.toUpperCase()}`};
  for (const entry of rec.severity ?? []) {
    if (entry.type === 'CVSS_V3' && typeof entry.score === 'string') {
      const base = cvss31BaseScore(entry.score);
      if (base !== null) return {severity: scoreSeverity(base), source: `CVSS_V3 ${base}`};
    }
    if ((entry.type === 'CVSS_V4' || entry.type === 'CVSS_V2') && typeof entry.score === 'string' && entry.score.startsWith('CVSS:')) {
      return {severity: 'unknown', source: `${entry.type} (unsupported)`};
    }
  }
  return {severity: 'unknown'};
}

/** Whether `version` is inside one of this record's applicable affected intervals for the package. Fixes are collected for every package-matching entry, whether or not the installed version is inside. */
function affectedState(rec: OsvRecord, ecosystem: string, name: string, version: string): {matched: boolean; affected: boolean; indeterminate: boolean; fixes: string[]} {
  const fixes: string[] = [];
  let matched = false, affected = false, indeterminate = false;
  const inInterval = (lower: string | null, upper: string | null, inclusive: boolean): boolean | 'unknown' => {
    const lo = lower === '0' ? '0.0.0' : lower;
    if (!semver.valid(version) || (lo !== null && !semver.valid(lo)) || (upper !== null && !semver.valid(upper))) return 'unknown';
    if (lo !== null && !semver.gte(version, lo)) return false;
    if (upper === null) return true;
    return inclusive ? semver.lte(version, upper) : semver.lt(version, upper);
  };
  for (const entry of rec.affected ?? []) {
    if (entry.package?.name !== name) continue;
    const eco = entry.package?.ecosystem;
    if (eco !== undefined && eco !== OSV_ECOSYSTEM[ecosystem]) continue;
    matched = true;
    if (Array.isArray(entry.versions) && entry.versions.includes(version)) affected = true;
    for (const range of entry.ranges ?? []) {
      if (range.type !== 'SEMVER' && range.type !== 'ECOSYSTEM') {indeterminate = true; continue;}
      const events = range.events ?? [];
      if (!events.length) {indeterminate = true; continue;}
      let start: string | null = null;
      for (const ev of events) {
        if (ev.introduced !== undefined) {
          if (start !== null) {
            const hit = inInterval(start, null, true);
            if (hit === true) affected = true; else if (hit === 'unknown') indeterminate = true;
          }
          start = ev.introduced; continue;
        }
        if (start === null) {indeterminate = true; continue;}
        if (ev.fixed !== undefined) {
          const hit = inInterval(start, ev.fixed, false);
          if (hit === true) affected = true; else if (hit === 'unknown') indeterminate = true;
          if (semver.valid(ev.fixed)) fixes.push(ev.fixed);
        } else if (ev.last_affected !== undefined) {
          const hit = inInterval(start, ev.last_affected, true);
          if (hit === true) affected = true; else if (hit === 'unknown') indeterminate = true;
        } else if (ev.limit !== undefined) {
          const hit = inInterval(start, ev.limit, false);
          if (hit === true) affected = true; else if (hit === 'unknown') indeterminate = true;
        } else {
          indeterminate = true; continue;
        }
        start = null;
      }
      if (start !== null) {
        const hit = inInterval(start, null, true);
        if (hit === true) affected = true; else if (hit === 'unknown') indeterminate = true;
      }
    }
  }
  return {matched, affected, indeterminate, fixes};
}

/** Whether `candidate` sits inside any affected interval for the package across `records` (installed-affecting or not — a known range is a known range). */
function insideAnyRange(records: OsvRecord[], ecosystem: string, name: string, candidate: string): boolean | 'unknown' {
  let unknown = false;
  for (const rec of records) {
    if (rec.withdrawn) continue;
    const state = affectedState(rec, ecosystem, name, candidate);
    if (state.affected) return true;
    if (state.indeterminate) unknown = true;
  }
  return unknown ? 'unknown' : false;
}

interface AdvisoryGroup {ids: string[]; records: OsvRecord[]}
function groupByAlias(records: OsvRecord[]): AdvisoryGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {const p = parent.get(x); return p === undefined ? (parent.set(x, x), x) : p === x ? x : find(p);};
  const union = (a: string, b: string) => {parent.set(find(a), find(b));};
  for (const rec of records) if (rec.id) {for (const alias of rec.aliases ?? []) union(rec.id, alias);}
  const groups = new Map<string, AdvisoryGroup>();
  for (const rec of records) {
    if (!rec.id) continue;
    const root = find(rec.id);
    const group = groups.get(root) ?? {ids: [], records: []};
    if (!group.ids.includes(rec.id)) group.ids.push(rec.id);
    for (const alias of rec.aliases ?? []) if (!group.ids.includes(alias)) group.ids.push(alias);
    group.records.push(rec);
    groups.set(root, group);
  }
  return [...groups.values()].sort((a, b) => a.ids[0].localeCompare(b.ids[0]));
}

export interface NormalizedScan {
  findings: DependencyFinding[];
  coverage: string[];
}

/**
 * Build per-occurrence findings from a completed/partial OSV scan. An occurrence with
 * no advisory refs produces no finding (clean is decided by scan status + coverage,
 * not by this function inventing absence).
 */
export function normalizeFindings(occurrences: readonly DependencyOccurrence[], scan: Pick<OsvScanResult, 'outcomes' | 'details'>): NormalizedScan {
  const coverage: string[] = [];
  const findings: DependencyFinding[] = [];
  for (const outcome of scan.outcomes) {
    const occ = occurrences[outcome.index];
    if (!occ) continue;
    if (outcome.indeterminate) coverage.push(`occurrence-${occ.occurrenceId}: query-indeterminate`);
    const records: OsvRecord[] = [];
    for (const ref of outcome.vulns) {
      const detail = scan.details[ref.id] as OsvRecord | undefined;
      if (!detail) {coverage.push(`occurrence-${occ.occurrenceId}: detail-missing-${ref.id}`); continue;}
      records.push(detail);
    }
    // Package-matching records supply known ranges/fixes; installed-affecting ones form findings.
    const pkgRecords: OsvRecord[] = [];
    const installedAffecting: OsvRecord[] = [];
    for (const rec of records) {
      if (rec.withdrawn) {coverage.push(`advisory-${rec.id}: withdrawn`); continue;}
      const state = affectedState(rec, occ.ecosystem, occ.name, occ.installedVersion);
      if (state.matched) pkgRecords.push(rec);
      if (state.affected) installedAffecting.push(rec);
      if (state.indeterminate && !state.affected) coverage.push(`occurrence-${occ.occurrenceId}: range-indeterminate`);
    }
    if (!installedAffecting.length) continue;
    for (const group of groupByAlias(installedAffecting)) {
      const fixes = new Set<string>();
      let indeterminate = false;
      for (const rec of pkgRecords) {
        const state = affectedState(rec, occ.ecosystem, occ.name, occ.installedVersion);
        for (const fix of state.fixes) if (semver.valid(fix) && semver.valid(occ.installedVersion) && semver.gt(fix, occ.installedVersion)) fixes.add(fix);
        if (state.indeterminate) indeterminate = true;
      }
      const sortedFixes = [...fixes].sort(semver.compare);
      let candidate: string | null = null;
      for (const fix of sortedFixes) {
        const inside = insideAnyRange(pkgRecords, occ.ecosystem, occ.name, fix);
        if (inside === false) {candidate = fix; break;}
        if (inside === 'unknown') break;
      }
      if (indeterminate && candidate === null) coverage.push(`occurrence-${occ.occurrenceId}: range-indeterminate`);
      let best: {severity: DependencySeverity; source?: string} = {severity: 'unknown'};
      for (const rec of group.records) {
        const s = recordSeverity(rec);
        if (RANK[s.severity] > RANK[best.severity]) best = s;
      }
      findings.push({
        occurrence: occ,
        advisoryIds: group.ids.slice(0, 64),
        severity: best.severity,
        severitySource: best.source,
        fixedVersions: sortedFixes.slice(0, 16),
        upgradeCandidate: candidate,
        candidateEligible: candidate !== null,
      });
    }
  }
  return {findings, coverage};
}

/** Remote alert plus the evidence fields kept internally for correlation. */
export interface RemoteAlertEvidence extends DependencyRemoteAlert {
  vulnerableRange?: string;
}

/**
 * Correlate GitHub repository alerts with local occurrences; only sets
 * matchedOccurrence when identity, advisory-alias and installed-version evidence
 * all agree. Unmatched alerts stay separate and never count as local findings.
 */
export function matchRemoteAlerts(alerts: readonly RemoteAlertEvidence[], occurrences: readonly DependencyOccurrence[], findings: readonly DependencyFinding[]): DependencyRemoteAlert[] {
  const rangeSatisfies = (range: string | undefined, version: string): boolean => {
    if (!range || !semver.valid(version)) return false;
    try {return semver.satisfies(version, range.replaceAll(',', ' ').trim());} catch {return false;}
  };
  return alerts.map(({vulnerableRange: _range, ...contract}) => {
    const matched = findings.some(finding =>
      finding.occurrence.name === contract.package &&
      contract.advisoryIds.some(id => finding.advisoryIds.includes(id)) &&
      (contract.manifestPath === undefined || contract.manifestPath === finding.occurrence.lockPath) &&
      rangeSatisfies(_range, finding.occurrence.installedVersion),
    ) || occurrences.some(occ =>
      occ.name === contract.package &&
      contract.manifestPath !== undefined && contract.manifestPath === occ.lockPath &&
      rangeSatisfies(_range, occ.installedVersion),
    );
    return {...contract, matchedOccurrence: matched};
  });
}
