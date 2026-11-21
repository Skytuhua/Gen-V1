import {createHash, randomUUID} from 'node:crypto';
import {HarnessError, type Operation} from '../contracts/index.ts';
import type {Store} from '../storage/store.ts';
import {capabilityEnabled} from '../core/capability-flags.ts';
import type {HostOperationExecutor} from '../core/service.ts';
import {
 dependencyScanResultSchema,
 type DependencyCoverageItem,
 type DependencyFinding,
 type DependencyOccurrence,
 type DependencyScanResult,
} from '../contracts/dependency-check.ts';
import {inventoryDependencies} from './dependency-inventory.ts';
import {queryOsv, osvTransport, type OsvTransport} from './dependency-osv.ts';
import {matchRemoteAlerts, normalizeFindings, type RemoteAlertEvidence} from './dependency-normalize.ts';

export const DEPENDENCY_SCAN_KIND = 'integration.dependency.scan';
export const DEPENDENCY_SCAN_RESULT = 'dependencyScan';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const dependencyScopeKey = (owner: unknown) => sha256(JSON.stringify(owner));
const RESULT_PAGE = 100;

export interface DependencyScanBinding {
 root: string;
 /** Serialized workspace owner scope (workspaceOwnerScope output). */
 owner: {projectId: string; threadId: string | null; workingCopyId: string | null; binding: unknown};
}
export interface DependencyScanDeps {
 /** Resolve the sealed scan inputs for a prepared operation: binding root + owner scope. */
 inventory?: typeof inventoryDependencies;
 transport?: OsvTransport;
 /** Optional GitHub source; absent or throwing records unavailable, never fails the local check. */
 dependabotAlerts?: (projectId: string, threadId?: string) => Promise<RemoteAlertEvidence[]>;
 now?: () => string;
}

interface ScanArgs {
 version: 1;
 owner: {projectId: string; threadId: string | null};
 scopeKey: string;
 sources: {github: boolean};
 basis: {inputDigest: string; coverage: DependencyCoverageItem[]; eligibleTupleCount: number; truncated: boolean; githubOrigin?: {owner: string; repo: string}};
 root: string;
 occurrences: DependencyOccurrence[];
 capturedAt: string;
}

export class DependencyScanService {
 constructor(private readonly store: Store, private readonly deps: DependencyScanDeps = {}) {}

 private assertEnabled(): void {
  if (!capabilityEnabled('workspace.dependencyCheckV1')) throw new HarnessError('CAPABILITY_DENIED', 'Dependency check is disabled.');
 }

 capability(githubOrigin?: {owner: string; repo: string} | null) {
  if (!capabilityEnabled('workspace.dependencyCheckV1')) return {available: false as const};
  return {available: true as const, sources: {osv: true as const, github: this.deps.dependabotAlerts !== undefined && githubOrigin != null}};
 }

 /** Read-only local enumeration; builds the approval-sealed operation record. */
 async prepare(input: {projectId: string; threadId: string; binding: DependencyScanBinding; sources: {github?: boolean}; githubOrigin?: {owner: string; repo: string}}): Promise<Operation> {
  this.assertEnabled();
  const scope = input.binding.owner, scopeKey = dependencyScopeKey(scope);
  const inventory = this.deps.inventory ?? inventoryDependencies;
  const snapshot = await inventory(input.binding.root, {scopeKey});
  const basis = {
   inputDigest: snapshot.inputDigest,
   coverage: snapshot.coverage.slice(0, 256),
   eligibleTupleCount: snapshot.occurrences.length,
   truncated: snapshot.coverage.some(item => item.status === 'excluded'),
   ...(input.sources.github && input.githubOrigin ? {githubOrigin: input.githubOrigin} : {}),
  };
  const args: ScanArgs = {
   version: 1,
   owner: {projectId: input.projectId, threadId: input.threadId},
   scopeKey,
   sources: {github: input.sources.github === true && input.githubOrigin != null},
   basis,
   root: input.binding.root,
   occurrences: snapshot.occurrences,
   capturedAt: snapshot.capturedAt,
  };
  const total = snapshot.occurrences.length;
  const githubNote = args.sources.github ? ' and the repository Dependabot alerts' : '';
  return {
   id: randomUUID(), threadId: input.threadId, revision: 1, kind: DEPENDENCY_SCAN_KIND,
   args: args as unknown as Record<string, unknown>, resourceIds: [], preconditions: {inputDigest: snapshot.inputDigest},
   description: `Check ${total} pinned ${total === 1 ? 'dependency' : 'dependencies'} from this working copy against the public OSV advisory database${githubNote}. Only package name, ecosystem and version tuples leave this machine.`,
   status: 'prepared', approved: false, createdAt: this.deps.now?.() ?? new Date().toISOString(),
  } as Operation;
 }

 /** Dispatch-side execution: revalidate flag/owner/basis, query, normalize, store. */
 readonly execute: HostOperationExecutor = async (operation, context) => {
  this.assertEnabled();
  if (operation.kind !== DEPENDENCY_SCAN_KIND) throw new HarnessError('UNKNOWN_OPERATION', 'Not a dependency scan operation');
  const args = operation.args as unknown as ScanArgs;
  if (args.version !== 1 || typeof args.scopeKey !== 'string' || typeof args.root !== 'string' || !Array.isArray(args.occurrences))
   throw new HarnessError('INVALID_OPERATION', 'Malformed dependency scan arguments');
  const stored = () => {
   const op = this.store.get<Operation>('operation', operation.id);
   if (!op || op.threadId !== operation.threadId || op.kind !== DEPENDENCY_SCAN_KIND || op.revision !== operation.revision || op.status !== 'running' || !op.approved || createHash('sha256').update(JSON.stringify(op.args)).digest('hex') !== sha256(JSON.stringify(args)))
    throw new HarnessError('STALE_REVISION', 'The approved dependency check changed or was cancelled');
   return op;
  };
  const assertCurrent = () => {
   if (context.signal.aborted) throw new HarnessError('CANCELLED', 'Dependency check cancelled');
   const owner = context.owner as {projectId?: string | null; threadId?: string | null} | undefined;
   if (owner && (owner.projectId !== args.owner.projectId || owner.threadId !== args.owner.threadId))
    throw new HarnessError('AUTHORITY_DENIED', 'The dependency check owner changed');
   stored();
  };
  const finish = async (result: Omit<DependencyScanResult, 'scanId'> & {scanId: string}) => {
   assertCurrent();
   const parsed = dependencyScanResultSchema.parse(result);
   const existing = this.store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, args.scopeKey);
   if (existing && existing.checkedAt >= parsed.checkedAt && existing.scanId !== parsed.scanId) return parsed; // late result rejected
   this.store.internal('dependencyScan.accepted', operation.threadId, () => this.store.put(DEPENDENCY_SCAN_RESULT, args.scopeKey, operation.threadId, parsed));
   return parsed;
  };

  assertCurrent();
  const inventory = this.deps.inventory ?? inventoryDependencies;
  const snapshot = await inventory(args.root, {scopeKey: args.scopeKey});
  if (snapshot.inputDigest !== operation.preconditions.inputDigest)
   throw new HarnessError('STALE_REVISION', 'Lockfiles changed since this check was approved; run it again');

  assertCurrent();
  const transport = this.deps.transport ?? osvTransport;
  const scan = await queryOsv(args.occurrences, {signal: context.signal, transport});
  const normalized = normalizeFindings(args.occurrences, scan);
  const coverage = [...args.basis.coverage];
  for (const note of [...(scan.coverage ?? []), ...normalized.coverage]) {
   const relPath = args.occurrences.find(occ => note.includes(occ.occurrenceId))?.lockPath;
   if (relPath) coverage.push({relativePath: relPath, format: 'unknown', status: 'excluded', reason: note.slice(0, 64)});
  }

  let remoteAlerts: DependencyScanResult['remoteAlerts'] = [], remoteAlertState: DependencyScanResult['remoteAlertState'] = 'not_requested';
  if (args.sources.github && this.deps.dependabotAlerts) {
   remoteAlertState = 'unavailable';
   try {
    const alerts = await this.deps.dependabotAlerts(args.owner.projectId, args.owner.threadId ?? undefined);
    remoteAlerts = matchRemoteAlerts(alerts, args.occurrences, normalized.findings);
    remoteAlertState = 'available';
   } catch { /* optional source failure is visible but never invalidates the local check */ }
  }
  assertCurrent();
  const severities: Record<string, number> = {critical: 0, high: 1, medium: 2, low: 3, unknown: 4};
  const findings: DependencyFinding[] = [...normalized.findings].sort((a, b) =>
   (severities[a.severity] ?? 9) - (severities[b.severity] ?? 9)
   || a.occurrence.name.localeCompare(b.occurrence.name)
   || a.occurrence.installedVersion.localeCompare(b.occurrence.installedVersion)
   || a.occurrence.lockPath.localeCompare(b.occurrence.lockPath)
   || (a.advisoryIds[0] ?? '').localeCompare(b.advisoryIds[0] ?? '')).slice(0, 500);
  const status = scan.status === 'complete' ? 'complete' : scan.status === 'partial' ? 'partial' : scan.status;
  return finish({
   scanId: operation.id, status, checkedAt: this.deps.now?.() ?? new Date().toISOString(),
   scopeKey: args.scopeKey, inputDigest: operation.preconditions.inputDigest!, fresh: true,
   coverage: coverage.slice(0, 256), queriedCount: scan.outcomes.length,
   findings, remoteAlerts, remoteAlertState,
  });
 };

 /** Same-scope bounded read for the route and the dependency_check_read tool. */
 read(scope: {projectId: string; threadId: string | null; workingCopyId: string | null; binding: unknown}, input: {scanId?: string; cursor?: string} = {}): DependencyScanResult {
  const key = dependencyScopeKey(scope);
  const result = this.store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, key);
  if (!result || (input.scanId !== undefined && result.scanId !== input.scanId))
   throw new HarnessError('STALE_REVISION', 'No current dependency check result for this scope; run a new check');
  const start = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10);
  if (!Number.isInteger(start) || start < 0) throw new HarnessError('INVALID_INPUT', 'Invalid result cursor');
  const page = result.findings.slice(start, start + RESULT_PAGE);
  return {...result, findings: page, nextCursor: start + RESULT_PAGE < result.findings.length ? String(start + RESULT_PAGE) : undefined};
 }

 /** Mark the stored result stale (called when a new prepare observes a different basis). */
 markStale(scope: {projectId: string; threadId: string | null; workingCopyId: string | null; binding: unknown}, inputDigest: string): void {
  const key = dependencyScopeKey(scope), result = this.store.get<DependencyScanResult>(DEPENDENCY_SCAN_RESULT, key);
  if (result && result.inputDigest !== inputDigest && result.fresh)
   this.store.internal('dependencyScan.stale', scope.threadId, () => this.store.put(DEPENDENCY_SCAN_RESULT, key, scope.threadId, {...result, fresh: false, status: 'stale'}));
 }
}
