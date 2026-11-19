import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import { packageScreeningV1Schema, sha256HexSchema, type PackageScreeningV1 } from '../contracts/execution-profile.ts';

/** Advisory package screening preflight. It matches an exact
 * package/version/digest against a named advisory database snapshot. The four
 * observable states stay distinct: KNOWN_BAD, NO_KNOWN_MATCH, UNAVAILABLE and
 * a stale-cache recheck. A clean lookup is never safe and never grants trust;
 * risk advice is ADVISORY only and cannot authorize activation. Source or
 * secrets are never uploaded to a scanner — queries carry identity only. */

export interface PackageIdentity { name: string; version: string; digest: string }
export interface AdvisoryQueryResult {
  status: 'MATCH' | 'NO_MATCH' | 'UNAVAILABLE';
  /** Advisory identifiers for an exact match; never package source. */
  advisoryIds?: readonly string[];
  /** Snapshot timestamp of the database that answered. */
  asOf?: string;
}
export interface AdvisoryDatabase {
  readonly database: string;
  query(identity: Readonly<PackageIdentity>): Promise<AdvisoryQueryResult>;
}
export interface ScreeningRecordCache {
  get(key: string): PackageScreeningV1 | undefined;
  put(key: string, record: PackageScreeningV1): void;
}
export interface OperatorException { actor: string; reason: string; recordedAt?: string }
export interface ScreenPackageOptions {
  cache?: ScreeningRecordCache;
  /** Cached query older than this is stale and must be re-checked. */
  maxCacheAgeMs?: number;
  now?: () => number;
  exception?: OperatorException;
}
export interface ScreeningComputation {
  record: PackageScreeningV1;
  cacheHit: boolean;
  staleCache: boolean;
  /** Present only when the operator recorded a documented exception. */
  exception?: OperatorException;
}

const DEFAULT_MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;
const cacheKey = (identity: PackageIdentity) => `${identity.name}@${identity.version}#${identity.digest}`;

function validateIdentity(identity: PackageIdentity): PackageIdentity {
  if (!identity || typeof identity.name !== 'string' || !identity.name || identity.name.length > 214) {
    throw new HarnessError('INVALID_INPUT', 'Package screening requires an exact package name.');
  }
  if (typeof identity.version !== 'string' || !identity.version || identity.version.length > 100) {
    throw new HarnessError('INVALID_INPUT', 'Package screening requires an exact package version.');
  }
  return { name: identity.name, version: identity.version, digest: sha256HexSchema.parse(identity.digest) };
}

/** Run (or reuse a fresh cached) advisory check. UNAVAILABLE and stale cache
 * stay distinct from a clean lookup; KNOWN_BAD is exact-match only. */
export async function screenPackage(identity: PackageIdentity, advisory: AdvisoryDatabase, options: ScreenPackageOptions = {}): Promise<ScreeningComputation> {
  const pkg = validateIdentity(identity);
  const now = options.now ?? Date.now;
  const maxAge = options.maxCacheAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS;
  // A caller-supplied unbounded TTL must not keep a clean advisory result
  // reusable indefinitely after the advisory database becomes unavailable.
  if (!Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > DEFAULT_MAX_CACHE_AGE_MS) {
    throw new HarnessError('INVALID_INPUT', 'Package screening cache lifetime must be a finite integer between 0 and 24 hours.');
  }
  const key = cacheKey(pkg);
  const cached = options.cache?.get(key);
  let staleCache = false;
  let previousCacheAgeMs = 0;
  if (cached) {
    const parsed = packageScreeningV1Schema.parse(cached);
    const age = now() - Date.parse(parsed.checkedAt);
    const validAge = Number.isSafeInteger(age) && age >= 0;
    // Fresh query time is not proof that the advisory database snapshot is fresh.
    const snapshotAge = now() - Date.parse(parsed.advisory.asOf);
    const freshSnapshot = Number.isSafeInteger(snapshotAge) && snapshotAge >= 0 &&
      snapshotAge <= DEFAULT_MAX_CACHE_AGE_MS;
    const sameIdentity = parsed.pkg.name === pkg.name && parsed.pkg.version === pkg.version &&
      parsed.pkg.digest === pkg.digest && parsed.advisory.database === advisory.database;
    // Cached screening facts cannot carry an operator's earlier authority.
    // Unavailable results are rechecked and use only this request's exception.
    const reusableDecision = parsed.status === 'NO_KNOWN_MATCH' && parsed.decision === 'ALLOW' ||
      parsed.status === 'KNOWN_BAD' && parsed.decision === 'DENY';
    if (sameIdentity && reusableDecision && parsed.cacheAgeMs !== null && validAge && freshSnapshot && maxAge > 0 && age <= maxAge) {
      return { record: { ...parsed, cacheAgeMs: age }, cacheHit: true, staleCache: false };
    }
    staleCache = true;
    if (validAge) previousCacheAgeMs = age;
  }
  let result: AdvisoryQueryResult;
  try { result = await advisory.query(Object.freeze({ ...pkg })); }
  catch { result = { status: 'UNAVAILABLE' }; }
  // Capture the completed query time: its snapshot may advance while awaiting.
  const checkedAt = new Date(now()).toISOString();
  // A returned NO_MATCH without an attested database snapshot cannot
  // borrow the local query timestamp as evidence of a fresh advisory DB.
  if (result.status === 'NO_MATCH' &&
      (typeof result.asOf !== 'string' || !Number.isFinite(Date.parse(result.asOf)))) {
    throw new HarnessError('INVALID_INPUT', 'A clean advisory result requires an explicit, valid database snapshot time.');
  }
  const asOf = typeof result.asOf === 'string' ? result.asOf : checkedAt;
  const snapshotAge = Date.parse(checkedAt) - Date.parse(asOf);
  const freshSnapshot = Number.isSafeInteger(snapshotAge) && snapshotAge >= 0 &&
    snapshotAge <= DEFAULT_MAX_CACHE_AGE_MS;
  let status: PackageScreeningV1['status'];
  let decision: PackageScreeningV1['decision'];
  let reason: string;
  if (result.status === 'MATCH') {
    status = 'KNOWN_BAD'; decision = 'DENY';
    reason = `Exact advisory match on ${advisory.database}: ${(result.advisoryIds ?? []).join(', ') || 'unidentified'}.`;
  } else if (result.status === 'NO_MATCH' && freshSnapshot) {
    status = 'NO_KNOWN_MATCH'; decision = 'ALLOW';
    reason = `No exact advisory match in ${advisory.database} as of ${asOf}. A clean lookup is not evidence of safety and does not grant trust.`;
  } else {
    status = 'UNAVAILABLE'; decision = options.exception ? 'OPERATOR_EXCEPTION' : 'DENY';
    reason = options.exception
      ? `Advisory database ${advisory.database} was unavailable or stale; the operator recorded a documented exception.`
      : `Advisory database ${advisory.database} was unavailable or stale; untrusted activation stays blocked.`;
  }
  if (options.exception && status !== 'NO_KNOWN_MATCH') {
    // An operator exception is recorded separately and never converts a
    // KNOWN_BAD result into anything but a denial.
    if (status === 'KNOWN_BAD') { decision = 'DENY'; reason = `Exact advisory match on ${advisory.database}; operator exceptions cannot override a known-bad package.`; }
  }
  const record = packageScreeningV1Schema.parse({
    version: 1, screeningId: `screen-${randomUUID()}`,
    pkg: { name: pkg.name, version: pkg.version, digest: pkg.digest },
    source: { kind: 'registry', locator: advisory.database },
    advisory: { database: advisory.database, asOf },
    status, decision, reason, checkedAt,
    cacheAgeMs: previousCacheAgeMs,
  });
  options.cache?.put(key, record);
  const exception = options.exception && decision === 'OPERATOR_EXCEPTION'
    ? { ...options.exception, recordedAt: options.exception.recordedAt ?? checkedAt }
    : undefined;
  return { record, cacheHit: false, staleCache, exception };
}

/** What a consumer may do with a screening record. Screening is an input to a
 * separate trust decision — it can block or stay neutral, never authorize. */
export function screeningGate(record: PackageScreeningV1): 'BLOCK' | 'NEUTRAL' | 'EXCEPTION_RECORDED' {
  const parsed = packageScreeningV1Schema.parse(record);
  if (parsed.status === 'KNOWN_BAD' || (parsed.status === 'UNAVAILABLE' && parsed.decision === 'DENY')) return 'BLOCK';
  if (parsed.decision === 'OPERATOR_EXCEPTION') return 'EXCEPTION_RECORDED';
  return 'NEUTRAL'; // NO_KNOWN_MATCH: no objection, and no trust granted.
}

export interface ScreeningAdvisory {
  label: 'Advisory';
  classifier: string;
  model: string;
  version: string;
  uncertainty: 'low' | 'medium' | 'high';
  rationale: string;
  cannotAuthorize: true;
}

/** Deterministic advisory note attached to a screening outcome. It explains,
 * it never decides: KNOWN_BAD stays denied and clean lookups stay neutral. */
export function screeningAdvisory(record: PackageScreeningV1): ScreeningAdvisory {
  const parsed = packageScreeningV1Schema.parse(record);
  const uncertainty = parsed.status === 'UNAVAILABLE' ? 'high' : parsed.status === 'KNOWN_BAD' ? 'low' : 'medium';
  return {
    label: 'Advisory', classifier: 'package-screening-advisory',
    model: 'deterministic-v1', version: '1.0.0', uncertainty,
    rationale: parsed.reason, cannotAuthorize: true,
  };
}
