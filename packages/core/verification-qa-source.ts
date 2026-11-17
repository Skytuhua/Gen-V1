import {createHash} from 'node:crypto';
import {z} from 'zod';
import {HarnessError, type ResourceGrant} from '../contracts/index.ts';
import {rootRelativePathSchema} from '../contracts/execution-profile.ts';
import {securityFindingV1Schema, type SecurityFindingV1} from '../contracts/verification.ts';
import type {VerificationIntent} from '../contracts/verification-workflow.ts';
import {digest, type Store} from '../storage/store.ts';
import {readBoundFile, withResourceGrant} from './file-access.ts';
import {assertVerificationSourceRoot, sourceDigestSync} from './project-verification.ts';
import {SecurityFindingLedger} from './verification-gate.ts';

export const QA_SOURCE_CAPTURE_BYTES = 1024 * 1024;
export const QA_SOURCE_RESULT_BYTES = 16 * 1024;
export const qaSourceRequestSchema = z.strictObject({path: rootRelativePathSchema, byteOffset: z.number().int().min(0).max(QA_SOURCE_CAPTURE_BYTES).optional(), maxBytes: z.number().int().min(1).max(QA_SOURCE_RESULT_BYTES).optional()});
export const qaFindingProposalSchema = z.strictObject({
  findingId: securityFindingV1Schema.shape.findingId, path: rootRelativePathSchema, line: securityFindingV1Schema.shape.source.shape.line,
  observation: securityFindingV1Schema.shape.observation, impact: securityFindingV1Schema.shape.impact, reproduction: securityFindingV1Schema.shape.reproduction,
});
export const qaObservationArgsSchema = z.strictObject({finding: qaFindingProposalSchema.optional()});
const denied = (code: string, message: string) => new HarnessError(code, message);
export function boundedQaResult<T>(value: T, trim: () => boolean): T {
  while (Buffer.byteLength(JSON.stringify(value)) > QA_SOURCE_RESULT_BYTES) if (!trim()) throw denied('RESOURCE_LIMIT', 'QA context exceeds its bounded result contract.');
  return value;
}

function sourceFacts(bytes: Buffer) {
  if (bytes.byteLength > QA_SOURCE_CAPTURE_BYTES) throw denied('RESOURCE_LIMIT', 'QA source capture exceeds one MiB.');
  let text: string;
  try {text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);} catch {throw denied('INVALID_INPUT', 'QA source must contain valid UTF-8 text.');}
  if (text.includes('\0')) throw denied('INVALID_INPUT', 'QA source must contain text rather than binary data.');
  const lineCount = text ? text.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(text) ? 1 : 0) : 0;
  return {blobSha: createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex'), lineCount};
}

/** Pure byte projection. It grants no source authority and performs no I/O. */
export function qaSourceView(bytes: Buffer, raw: unknown) {
  const request = qaSourceRequestSchema.parse(raw), facts = sourceFacts(bytes), start = request.byteOffset ?? 0;
  if (start > bytes.byteLength || start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) throw denied('INVALID_INPUT', 'Choose a source offset at a UTF-8 character boundary.');
  const boundary = (end: number) => {while (end > start && end < bytes.byteLength && (bytes[end]! & 0xc0) === 0x80) end--; return end;};
  let end = boundary(Math.min(bytes.byteLength, start + (request.maxBytes ?? QA_SOURCE_RESULT_BYTES)));
  const value = () => ({evidenceQuality: 'ADVISORY' as const, path: request.path, ...facts, text: bytes.subarray(start, end).toString('utf8'), byteOffset: start, byteLength: end - start, totalBytes: bytes.byteLength, omittedBytes: bytes.byteLength - (end - start), nextByteOffset: end < bytes.byteLength ? end : null});
  let view = value(), encoded = Buffer.byteLength(JSON.stringify(view));
  while (encoded > QA_SOURCE_RESULT_BYTES && end > start) {end = boundary(Math.max(start, end - (encoded - QA_SOURCE_RESULT_BYTES))); view = value(); encoded = Buffer.byteLength(JSON.stringify(view));}
  if (encoded > QA_SOURCE_RESULT_BYTES || end === start && start < bytes.byteLength) throw denied('RESOURCE_LIMIT', 'This source range cannot fit one complete character within its result bound.');
  return view;
}

/** Model proposals have no source digest, scope, status or evidence authority. */
export function qaFindingSource(raw: unknown, bytes: Buffer) {
  const proposal = qaFindingProposalSchema.parse(raw), facts = sourceFacts(bytes);
  if (proposal.line !== null && proposal.line > facts.lineCount) throw denied('INVALID_INPUT', 'The finding line is outside the captured source text.');
  const {path, line, ...claims} = proposal;
  return {...claims, source: {path, line, blobSha: facts.blobSha}};
}

interface SourceScope {store: Store; operationId: string; intent: VerificationIntent; signal: AbortSignal; assertCurrent: () => void}
async function withSource<T>(scope: SourceScope, path: string, action: (bytes: Buffer) => T): Promise<T> {
  const {store, intent, signal} = scope, root = intent.recipe.workspaceIdentity;
  if (!intent.qa || ![...intent.sourceFiles, ...intent.dependencyFiles].includes(path)) throw denied('QA_SCOPE_CHANGED', 'QA may inspect only the exact approved source and dependency inputs.');
  const fence = () => {
    if (signal.aborted) throw denied('CANCELLED_RUN', 'QA source access was cancelled.');
    scope.assertCurrent(); assertVerificationSourceRoot(store, intent.owner.threadId, root.canonicalPath);
    if (digest({codeDigest: sourceDigestSync(root.canonicalPath, intent.sourceFiles), dependencyDigest: sourceDigestSync(root.canonicalPath, intent.dependencyFiles)}) !== digest(intent.sourceCut)) throw denied('BLOCKED_SOURCE_DRIFT', 'QA source changed after its exact approval.');
  };
  fence();
  // This transient read scope is derived from the already consumed operation.
  // It is not persisted or exposed as a model grant, and never permits writes.
  const grant: ResourceGrant = {id: `qa-source:${scope.operationId}`, threadId: intent.owner.threadId, kind: 'project', path: root.canonicalPath, label: 'Approved QA source', writable: false, createdAt: intent.recipe.createdAt, identity: {dev: root.dev, ino: root.ino}};
  return withResourceGrant(grant, store.dataDir, path, false, signal, async stable => {
    fence(); const bytes = await readBoundFile(stable, QA_SOURCE_CAPTURE_BYTES); fence();
    return action(bytes);
  });
}
export async function readQaSource(scope: SourceScope, raw: unknown) {
  const request = qaSourceRequestSchema.parse(raw);
  return withSource(scope, request.path, bytes => qaSourceView(bytes, request));
}
export async function recordQaFinding(scope: SourceScope, raw: unknown): Promise<SecurityFindingV1> {
  const proposal = qaFindingProposalSchema.parse(raw), {intent, store, operationId} = scope;
  return withSource(scope, proposal.path, bytes => {
    const finding = qaFindingSource(proposal, bytes); scope.assertCurrent();
    return new SecurityFindingLedger(store).record({version: 1, ...finding, status: 'OPEN', evidenceQuality: 'ADVISORY',
      authorizedScope: `Read-only local source review under operation ${operationId}, recipe ${intent.recipe.recipeId}. No target testing or modification is authorized.`,
      provenance: {owner: intent.owner, executionId: intent.executionId, ...intent.sourceCut}, createdAt: new Date().toISOString()}, intent.owner.threadId);
  });
}
