import {createHash} from 'node:crypto';
import {readdir, lstat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseDocument} from 'yaml';
import {
  dependencyInventorySnapshotSchema,
  type DependencyCoverageItem,
  type DependencyFormat,
  type DependencyInventorySnapshot,
  type DependencyOccurrence,
} from '../contracts/dependency-check.ts';

/**
 * Local dependency inventory for the vulnerability check (plan r1 §2).
 * Read-only bounded enumeration of the bound working copy: every candidate file is
 * identified by name, read with byte caps, and hashed; occurrences carry only exact
 * registry pins. No installs, no manifest ranges, no network — ever.
 */

export const INVENTORY_LIMITS = {
  maxDirectoryEntries: 10_000,
  maxCandidateFiles: 24,
  maxFileBytes: 4 * 1024 * 1024,
  maxCumulativeBytes: 24 * 1024 * 1024,
  maxOccurrences: 5_000,
} as const;

const PRUNE = new Set(['.git', 'node_modules']);
/** scannable format per filename; known-but-unsupported formats get 'unsupported' coverage. */
const CANDIDATES: Record<string, DependencyFormat> = {
  'package-lock.json': 'npm-lock-v2',
  'pnpm-lock.yaml': 'pnpm-lock-v9',
  'npm-shrinkwrap.json': 'npm-lock-v2',
  'yarn.lock': 'yarn-lock-v1',
  'poetry.lock': 'poetry-lock',
  'uv.lock': 'uv-lock',
  'requirements.txt': 'requirements-txt',
  'Cargo.lock': 'cargo-lock',
  'go.sum': 'go-sum',
  'package.json': 'unknown', // manifests: hashed for the digest, never a version source
};
const REGISTRY_DEFAULT = 'https://registry.npmjs.org';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const occurrenceId = (lockPath: string, importerPath: string | undefined, name: string, version: string) =>
  sha256(`${lockPath}\0${importerPath ?? ''}\0${name}\0${version}`).slice(0, 32);

interface Candidate { relativePath: string; absolutePath: string; format: DependencyFormat }
interface FileRead { bytes: Buffer; digest: string }

async function enumerate(root: string, limits: InventoryLimits): Promise<{candidates: Candidate[]; coverage: DependencyCoverageItem[]; truncated: boolean; entriesSeen: number}> {
  const candidates: Candidate[] = [], coverage: DependencyCoverageItem[] = [];
  let entries = 0, truncated = false;
  const queue = ['.'];
  while (queue.length) {
    const dir = queue.shift()!;
    let listing;
    try { listing = await readdir(join(root, dir), {withFileTypes: true}); }
    catch { continue; }
    listing.sort((a, b) => a.name < b.name ? -1 : 1);
    for (const entry of listing) {
      if (++entries > limits.maxDirectoryEntries) { truncated = true; break; }
      const rel = dir === '.' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isSymbolicLink()) { coverage.push({relativePath: rel, format: 'unknown', status: 'excluded', reason: 'symlink'}); continue; }
      if (entry.isDirectory()) {
        if (PRUNE.has(entry.name)) { coverage.push({relativePath: rel, format: 'unknown', status: 'excluded', reason: 'pruned-dir'}); continue; }
        queue.push(rel); continue;
      }
      if (!entry.isFile()) continue;
      const format = CANDIDATES[entry.name];
      if (!format) continue;
      if (entry.name === 'package.json') continue; // manifests: digested via importer reads, not enumerated as candidates
      if (candidates.length >= limits.maxCandidateFiles) {
        coverage.push({relativePath: rel, format, status: 'excluded', reason: 'candidate-cap'});
        truncated = true; continue;
      }
      candidates.push({relativePath: rel, absolutePath: join(root, rel), format});
    }
    if (truncated) break;
  }
  return {candidates, coverage, truncated, entriesSeen: entries};
}

async function readCandidate(c: Candidate, budget: {remaining: number}, limits: InventoryLimits, coverage: DependencyCoverageItem[]): Promise<FileRead | null> {
  let stat;
  try { stat = await lstat(c.absolutePath); }
  catch { coverage.push({relativePath: c.relativePath, format: c.format, status: 'unreadable', reason: 'stat-failed'}); return null; }
  if (stat.isSymbolicLink() || !stat.isFile()) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'excluded', reason: 'not-regular-file'}); return null; }
  if (stat.size > limits.maxFileBytes) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'oversized', reason: 'file-cap'}); return null; }
  if (stat.size > budget.remaining) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'oversized', reason: 'cumulative-cap'}); return null; }
  try {
    const bytes = await readFile(c.absolutePath);
    budget.remaining -= bytes.length;
    return {bytes, digest: sha256(bytes)};
  } catch {
    coverage.push({relativePath: c.relativePath, format: c.format, status: 'unreadable', reason: 'read-failed'});
    return null;
  }
}

/** True only when every npm/lock indicator agrees the public registry. Unknown/custom config = not public. */
function publicRegistry(registryConfig: {npmrc?: string; pnpmWorkspace?: string}): boolean {
  const texts = [registryConfig.npmrc, registryConfig.pnpmWorkspace].filter((t): t is string => Boolean(t));
  for (const text of texts) for (const line of text.split('\n')) {
    const match = line.trim().match(/^registry\s*[:=]\s*(\S+)/);
    if (match && match[1] !== REGISTRY_DEFAULT && match[1] !== 'https://registry.npmjs.org/') return false;
  }
  return true;
}

function npmVersionLock(version: number | string | undefined): DependencyFormat | null {
  if (version === 2 || version === '2') return 'npm-lock-v2';
  if (version === 3 || version === '3') return 'npm-lock-v3';
  return null;
}

function npmNameFromPath(path: string): string | null {
  const i = path.lastIndexOf('node_modules/');
  return i < 0 ? null : path.slice(i + 'node_modules/'.length);
}

interface OccurrenceSink { occurrences: DependencyOccurrence[]; overflow: boolean }
function push(sink: OccurrenceSink, occ: DependencyOccurrence, limits: InventoryLimits) {
  if (sink.occurrences.length >= limits.maxOccurrences) { sink.overflow = true; return; }
  sink.occurrences.push(occ);
}

function parseNpmLock(rel: string, json: any, manifestNames: Set<string> | null, sink: OccurrenceSink, limits: InventoryLimits): {ok: boolean; privateRegistry: boolean} {
  const start = sink.occurrences.length;
  const packages = json?.packages;
  if (typeof packages !== 'object' || packages === null) return {ok: false, privateRegistry: false};
  let privateRegistry = false;
  const direct = new Set(manifestNames ?? []);
  for (const [path, entry] of Object.entries(packages)) {
    if (!path || typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (e.link === true) continue;
    const name = npmNameFromPath(path);
    const version = typeof e.version === 'string' ? e.version : null;
    if (!name || !version) continue;
    const resolved = typeof e.resolved === 'string' ? e.resolved : '';
    if (!resolved) continue; // workspace project entry, not a registry pin
    if (!resolved.startsWith(REGISTRY_DEFAULT + '/')) { privateRegistry = true; continue; }
    push(sink, {
      occurrenceId: occurrenceId(rel, undefined, name, version),
      ecosystem: 'npm',
      name, installedVersion: version,
      directness: direct.size ? (direct.has(name) ? 'direct' : 'transitive') : 'unknown',
      lockPath: rel,
    }, limits);
  }
  // A single non-default resolution taints the file: never submit partially private pins.
  if (privateRegistry) sink.occurrences.length = start;
  return {ok: true, privateRegistry};
}

function stripPnpmPeerSuffix(key: string): {name: string; version: string} | null {
  const base = key.split('(')[0]; // peer context suffix
  const at = base.lastIndexOf('@');
  if (at <= 0) return null;
  const name = base.slice(0, at), version = base.slice(at + 1);
  return name && version ? {name, version} : null;
}

function parsePnpmLock(rel: string, doc: ReturnType<typeof parseDocument>, sink: OccurrenceSink, limits: InventoryLimits): {ok: boolean; privateRegistry: boolean} {
  const start = sink.occurrences.length;
  const root = doc.toJS() as any;
  if (root?.lockfileVersion !== 9 && String(root?.lockfileVersion) !== '9.0') return {ok: false, privateRegistry: false};
  let privateRegistry = false;
  const importers = root.importers && typeof root.importers === 'object' ? root.importers : {};
  const directByImporter = new Map<string, {specifier: string; version: string}[]>();
  for (const [importerPath, imp] of Object.entries<any>(importers)) {
    const list: {specifier: string; version: string}[] = [];
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
      const deps = imp?.[section];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, record] of Object.entries<any>(deps)) {
        const version = typeof record?.version === 'string' ? record.version : null;
        const specifier = typeof record?.specifier === 'string' ? record.specifier : '';
        if (!version) continue;
        if (specifier.startsWith('link:') || specifier.startsWith('file:') || specifier.startsWith('workspace:')) continue;
        list.push({specifier, version});
        const clean = stripPnpmPeerSuffix(`${name}@${version}`);
        if (!clean) continue;
        push(sink, {
          occurrenceId: occurrenceId(rel, importerPath, name, clean.version),
          ecosystem: 'npm', name, installedVersion: clean.version,
          directness: 'direct', lockPath: rel, importerPath,
        }, limits);
      }
    }
    directByImporter.set(importerPath, list);
  }
  const packages = root.packages && typeof root.packages === 'object' ? root.packages : {};
  const directIds = new Set<string>();
  for (const list of directByImporter.values()) for (const d of list) directIds.add(d.version.split('(')[0]);
  for (const [key, entry] of Object.entries<any>(packages)) {
    const parsed = stripPnpmPeerSuffix(key);
    if (!parsed) continue;
    const resolution = entry?.resolution;
    const integrity = typeof resolution?.integrity === 'string' ? resolution.integrity : '';
    const tarball = typeof resolution?.tarball === 'string' ? resolution.tarball : '';
    if (tarball && !tarball.startsWith(REGISTRY_DEFAULT)) privateRegistry = true;
    if (resolution?.type && resolution.type !== 'registry') { privateRegistry = true; continue; }
    if (!integrity && !tarball) continue; // no registry provenance
    const id = occurrenceId(rel, undefined, parsed.name, parsed.version);
    if (sink.occurrences.some(o => o.occurrenceId === id)) continue;
    push(sink, {
      occurrenceId: id, ecosystem: 'npm', name: parsed.name, installedVersion: parsed.version,
      directness: directIds.has(parsed.version) ? 'direct' : 'transitive',
      lockPath: rel,
    }, limits);
  }
  if (privateRegistry) sink.occurrences.length = start;
  return {ok: true, privateRegistry};
}

async function readJson(path: string): Promise<any | null> {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function manifestDirectNames(root: string, lockDir: string): Promise<Set<string> | null> {
  const manifest = await readJson(join(root, lockDir === '.' ? 'package.json' : `${lockDir}/package.json`));
  if (!manifest || typeof manifest !== 'object') return null;
  const names = new Set<string>();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const deps = manifest[section];
    if (deps && typeof deps === 'object') for (const n of Object.keys(deps)) names.add(n);
  }
  return names;
}

export type InventoryLimits = Record<keyof typeof INVENTORY_LIMITS, number>;
export interface DependencyInventoryOptions {limits?: Partial<InventoryLimits>; scopeKey?: string; capturedAt?: string}

/**
 * Enumerate the bound root and produce a sealed inventory snapshot. Purely local:
 * reads only regular files inside `root`, follows nothing, and queries nothing.
 */
export async function inventoryDependencies(root: string, options: DependencyInventoryOptions = {}): Promise<DependencyInventorySnapshot> {
  const limits = {...INVENTORY_LIMITS, ...options.limits};
  const {candidates, coverage} = await enumerate(root, limits);
  const budget = {remaining: limits.maxCumulativeBytes};
  const sink: OccurrenceSink = {occurrences: [], overflow: false};
  const inputParts: string[] = [];

  const npmrc = await readFile(join(root, '.npmrc'), 'utf8').catch(() => undefined);
  const pnpmWorkspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => undefined);
  const isPublicRegistry = publicRegistry({npmrc, pnpmWorkspace});

  for (const c of candidates) {
    const file = await readCandidate(c, budget, limits, coverage);
    if (!file) continue;
    inputParts.push(`${c.relativePath}:${file.digest}`);
    if (!isPublicRegistry) {
      coverage.push({relativePath: c.relativePath, format: c.format, status: 'private_registry', reason: 'custom-registry-config'});
      continue;
    }
    if (c.format === 'npm-lock-v2') {
      let json: any = null;
      try { json = JSON.parse(file.bytes.toString('utf8')); } catch { /* below */ }
      const format = npmVersionLock(json?.lockfileVersion);
      if (!json || !format) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'unreadable', reason: 'invalid-lock-json'}); continue; }
      const dir = c.relativePath.includes('/') ? c.relativePath.split('/').slice(0, -1).join('/') : '.';
      const manifestNames = await manifestDirectNames(root, dir);
      const manifest = await readFile(join(root, dir === '.' ? 'package.json' : `${dir}/package.json`), 'utf8').catch(() => null);
      if (manifest) inputParts.push(`${dir === '.' ? 'package.json' : dir + '/package.json'}:${sha256(manifest)}`);
      const {ok, privateRegistry} = parseNpmLock(c.relativePath, json, manifestNames, sink, limits);
      if (!ok) { coverage.push({relativePath: c.relativePath, format, status: 'unreadable', reason: 'invalid-packages-map'}); continue; }
      if (privateRegistry) { coverage.push({relativePath: c.relativePath, format, status: 'private_registry', reason: 'non-default-resolved'}); continue; }
      coverage.push({relativePath: c.relativePath, format, status: 'scanned'});
    } else if (c.format === 'pnpm-lock-v9') {
      let doc;
      try { doc = parseDocument(file.bytes.toString('utf8'), {uniqueKeys: true, logLevel: 'silent'}); }
      catch { coverage.push({relativePath: c.relativePath, format: c.format, status: 'unreadable', reason: 'invalid-yaml'}); continue; }
      if (doc.errors.length) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'unreadable', reason: 'invalid-yaml'}); continue; }
      const {ok, privateRegistry} = parsePnpmLock(c.relativePath, doc, sink, limits);
      if (!ok) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'unsupported', reason: 'unsupported-lockfile-version'}); continue; }
      if (privateRegistry) { coverage.push({relativePath: c.relativePath, format: c.format, status: 'private_registry', reason: 'non-default-resolution'}); continue; }
      coverage.push({relativePath: c.relativePath, format: c.format, status: 'scanned'});
    } else {
      coverage.push({relativePath: c.relativePath, format: c.format, status: 'unsupported', reason: 'recognized-unsupported-format'});
    }
  }
  if (sink.overflow) coverage.push({relativePath: '.', format: 'unknown', status: 'excluded', reason: 'occurrence-cap'});
  inputParts.sort();
  const snapshot = {
    scopeKey: options.scopeKey ?? 'local',
    inputDigest: sha256(inputParts.join('\n')),
    coverage,
    occurrences: sink.occurrences,
    capturedAt: options.capturedAt ?? new Date().toISOString(),
  };
  return dependencyInventorySnapshotSchema.parse(snapshot);
}

export const _internals = {parseNpmLock, parsePnpmLock, stripPnpmPeerSuffix, npmNameFromPath, publicRegistry};
