import {HarnessError} from '../contracts/index.ts';
import type {DependencyOccurrence} from '../contracts/dependency-check.ts';

/**
 * Bounded OSV adapter (plan r1 §OSV): fixed-host HTTPS only, no redirects, no
 * credentials, no project data beyond {ecosystem, name, version} tuples.
 * Transport is injected so tests never touch the network.
 */

export const OSV_LIMITS = {
  queriesPerBatch: 100,
  maxConcurrent: 4,
  maxTotalBytes: 16 * 1024 * 1024,
  scanDeadlineMs: 30_000,
  /** Additional page/detail requests allowed after the initial query batches. */
  maxFollowups: 100,
  maxRetryAfterMs: 5_000,
  maxVulnIdLength: 128,
} as const;

const OSV_ORIGIN = 'https://api.osv.dev';
const QUERY_BATCH = OSV_ORIGIN + '/v1/querybatch';
const VULN_DETAIL = OSV_ORIGIN + '/v1/vulns/';
const ECOSYSTEM_MAP: Record<string, string> = {npm: 'npm', pypi: 'PyPI', 'crates.io': 'crates.io', go: 'Go'};

export interface OsvTransportResponse {status: number; headers: {get(name: string): string | null}; text(): Promise<string>}
export type OsvTransport = (url: string, init: {method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal: AbortSignal}) => Promise<OsvTransportResponse>;

/** Production transport: global fetch with redirects refused and no credentials. */
export const osvTransport: OsvTransport = async (url, init) => {
  const response = await fetch(url, {method: init.method, headers: init.headers, body: init.body, signal: init.signal, redirect: 'error', credentials: 'omit'});
  return {status: response.status, headers: response.headers, text: () => response.text()};
};

export interface OsvVulnRef {id: string; modified: string}
export interface OsvQueryOutcome {index: number; vulns: OsvVulnRef[]; indeterminate: boolean}
export interface OsvScanResult {
  status: 'complete' | 'partial' | 'unavailable';
  /** Per input query index, in input order. */
  outcomes: OsvQueryOutcome[];
  /** Distinct advisory detail records by id (raw provider JSON, schema-checked by the normalizer). */
  details: Record<string, unknown>;
  coverage: string[];
}

interface OsvQuery {package: {ecosystem: string; name: string}; version: string; page_token?: string}

const transient = (error: unknown) => !(error instanceof HarnessError);
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {clearTimeout(timer); reject(signal.reason);}, {once: true});
});

async function call(transport: OsvTransport, url: string, init: {method: 'GET' | 'POST'; body?: string}, signal: AbortSignal, budget: {bytes: number}): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (signal.aborted) throw new HarnessError('OSV_CANCELLED', 'Dependency check was cancelled.');
      const response = await Promise.race([
        transport(url, {method: init.method, headers: {Accept: 'application/json', 'Content-Type': 'application/json'}, body: init.body, signal}),
        new Promise<never>((_res, rej) => signal.addEventListener('abort', () => rej(new HarnessError('OSV_CANCELLED', 'Dependency check was cancelled.')), {once: true})),
      ]);
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (attempt === 0 && Number.isFinite(retryAfter) && retryAfter * 1000 <= OSV_LIMITS.maxRetryAfterMs) {
          await sleep(retryAfter * 1000, signal);
          continue;
        }
        if (attempt === 0) {lastError = new HarnessError('OSV_UNAVAILABLE', `OSV returned ${response.status}.`); continue;}
        throw new HarnessError('OSV_UNAVAILABLE', `OSV returned ${response.status}.`);
      }
      if (!response.status || response.status < 200 || response.status >= 300) throw new HarnessError('OSV_UNAVAILABLE', `OSV returned ${response.status}.`);
      const text = await response.text();
      budget.bytes += text.length;
      if (budget.bytes > OSV_LIMITS.maxTotalBytes) throw new HarnessError('OSV_RESPONSE_LIMIT', 'OSV response exceeded the scan budget.');
      try {return JSON.parse(text) as Record<string, unknown>;} catch {throw new HarnessError('OSV_RESPONSE_INVALID', 'OSV returned unreadable JSON.');}
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof HarnessError && error.code !== 'OSV_UNAVAILABLE') throw error;
      lastError = error;
      if (attempt === 0 && transient(error)) {await sleep(250, signal).catch(() => {throw signal.reason ?? error;}); continue;}
      throw error;
    }
  }
  throw lastError;
}

function parseVulnRefs(raw: unknown): {vulns: OsvVulnRef[]; nextPageToken?: string} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  const vulns: OsvVulnRef[] = [];
  if (entry.vulns !== undefined) {
    if (!Array.isArray(entry.vulns)) return null;
    for (const item of entry.vulns) {
      if (typeof item !== 'object' || item === null) return null;
      const {id, modified} = item as Record<string, unknown>;
      if (typeof id !== 'string' || id.length === 0 || id.length > OSV_LIMITS.maxVulnIdLength || typeof modified !== 'string') return null;
      vulns.push({id, modified});
    }
  }
  const token = entry.next_page_token;
  if (token !== undefined && typeof token !== 'string') return null;
  return {vulns, nextPageToken: token || undefined};
}

/** Bound concurrency fan-out over async jobs. */
async function pooled<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(limit, jobs.length)}, async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  }));
  return results;
}

/**
 * Query OSV for eligible distinct tuples, then fetch each distinct advisory detail once.
 * Never interprets a malformed or omitted reply slot as empty; partial coverage is
 * reported through `status` and `coverage` notes.
 */
export async function queryOsv(
  occurrences: readonly DependencyOccurrence[],
  options: {signal?: AbortSignal; deadlineMs?: number; transport?: OsvTransport} = {},
): Promise<OsvScanResult> {
  const transport = options.transport ?? osvTransport;
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(options.deadlineMs ?? OSV_LIMITS.scanDeadlineMs)]);
  const coverage: string[] = [];
  const budget = {bytes: 0};
  let followups = OSV_LIMITS.maxFollowups;

  // Distinct public tuples, first-occurrence index preserved.
  const queries: {tuple: OsvQuery; indexes: number[]}[] = [];
  const seen = new Map<string, number>();
  for (const [index, occ] of occurrences.entries()) {
    const ecosystem = ECOSYSTEM_MAP[occ.ecosystem];
    if (!ecosystem) continue;
    const key = `${occ.ecosystem}\0${occ.name}\0${occ.installedVersion}`;
    const existing = seen.get(key);
    if (existing !== undefined) queries[existing].indexes.push(index);
    else {
      seen.set(key, queries.length);
      queries.push({tuple: {package: {ecosystem, name: occ.name}, version: occ.installedVersion}, indexes: [index]});
    }
  }
  if (!queries.length) return {status: 'complete', outcomes: [], details: {}, coverage};

  // Initial batches preserve query order; each slot must answer or be indeterminate.
  const slotResults = new Map<number, OsvVulnRef[]>();
  const pages: {queryIndex: number; token: string}[] = [];
  const batches = Math.ceil(queries.length / OSV_LIMITS.queriesPerBatch);
  for (let batch = 0; batch < batches; batch++) {
    const slice = queries.slice(batch * OSV_LIMITS.queriesPerBatch, (batch + 1) * OSV_LIMITS.queriesPerBatch);
    try {
      const body = JSON.stringify({queries: slice.map(q => q.tuple)});
      const reply = await call(transport, QUERY_BATCH, {method: 'POST', body}, signal, budget);
      const results = reply.results;
      if (!Array.isArray(results) || results.length !== slice.length) {
        for (let i = 0; i < slice.length; i++) slotResults.set(batch * OSV_LIMITS.queriesPerBatch + i, []);
        coverage.push(`osv-batch-${batch}: cardinality-mismatch`);
        continue;
      }
      for (const [i, raw] of results.entries()) {
        const parsed = parseVulnRefs(raw);
        if (!parsed) {
          slotResults.set(batch * OSV_LIMITS.queriesPerBatch + i, []);
          coverage.push(`osv-query-${batch * OSV_LIMITS.queriesPerBatch + i}: malformed-slot`);
          continue;
        }
        slotResults.set(batch * OSV_LIMITS.queriesPerBatch + i, parsed.vulns);
        if (parsed.nextPageToken) pages.push({queryIndex: batch * OSV_LIMITS.queriesPerBatch + i, token: parsed.nextPageToken});
      }
    } catch (error) {
      if (signal.aborted) throw new HarnessError('OSV_CANCELLED', 'Dependency check was cancelled.');
      for (let i = 0; i < slice.length; i++) slotResults.set(batch * OSV_LIMITS.queriesPerBatch + i, []);
      coverage.push(`osv-batch-${batch}: ${error instanceof HarnessError ? error.code : 'request-failed'}`);
    }
  }

  // Follow per-query pagination and fetch distinct details, bounded and pooled.
  const details: Record<string, unknown> = {};
  const detailIds = new Set<string>();
  for (const refs of slotResults.values()) for (const ref of refs) detailIds.add(ref.id);
  const jobs: (() => Promise<void>)[] = [];
  let truncated = false;
  for (const page of pages) {
    jobs.push(async () => {
      let token: string | undefined = page.token;
      while (token) {
        if (followups-- <= 0) {truncated = true; coverage.push(`osv-query-${page.queryIndex}: page-cap`); return;}
        const body = JSON.stringify({queries: [{...queries[page.queryIndex].tuple, page_token: token}]});
        try {
          const reply = await call(transport, QUERY_BATCH, {method: 'POST', body}, signal, budget);
          const results = Array.isArray(reply.results) ? reply.results : [];
          const parsed = results.length === 1 ? parseVulnRefs(results[0]) : null;
          if (!parsed) {coverage.push(`osv-query-${page.queryIndex}: malformed-page`); return;}
          slotResults.get(page.queryIndex)!.push(...parsed.vulns);
          for (const ref of parsed.vulns) detailIds.add(ref.id);
          token = parsed.nextPageToken;
        } catch (error) {
          if (signal.aborted) return;
          coverage.push(`osv-query-${page.queryIndex}: page-${error instanceof HarnessError ? error.code : 'failed'}`);
          return;
        }
      }
    });
  }
  for (const id of detailIds) {
    jobs.push(async () => {
      if (followups-- <= 0) {truncated = true; coverage.push(`osv-detail-${id}: detail-cap`); return;}
      try {
        const doc = await call(transport, VULN_DETAIL + encodeURIComponent(id), {method: 'GET'}, signal, budget);
        details[id] = doc;
      } catch (error) {
        if (!signal.aborted) coverage.push(`osv-detail-${id}: ${error instanceof HarnessError ? error.code : 'failed'}`);
      }
    });
  }
  try {
    await pooled(jobs, OSV_LIMITS.maxConcurrent);
  } catch (error) {
    if (signal.aborted) throw new HarnessError('OSV_CANCELLED', 'Dependency check was cancelled.');
    throw error;
  }

  // Re-emit per input occurrence index, in input order.
  const outcomes: OsvQueryOutcome[] = queries.flatMap((q, qi) =>
    q.indexes.map(index => ({index, vulns: slotResults.get(qi) ?? [], indeterminate: coverage.some(n => n.includes(`query-${qi}`) || n.includes(`batch-${Math.floor(qi / OSV_LIMITS.queriesPerBatch)}:`))})),
  ).sort((a, b) => a.index - b.index);
  const anySlot = outcomes.some(o => !o.indeterminate);
  const status = truncated || coverage.length ? (anySlot ? 'partial' : 'unavailable') : 'complete';
  return {status, outcomes, details, coverage};
}
