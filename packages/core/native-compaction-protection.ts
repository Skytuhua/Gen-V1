import { createHash } from 'node:crypto';
import { HarnessError, type InputRequest, type Operation, type TaskMemory } from '../contracts/index.ts';
import { AGENT_WORK_TERMINAL_STATES, type AgentWorkV1 } from '../contracts/agent-work.ts';
import { nativeCompactionEnvelopeSchema, nativeCompactionReferenceSchema, nativeCompactionReceiptSchema,
  type NativeCompactionEnvelopeV1, type NativeCompactionOwnerV1, type NativeCompactionReceiptV1, type NativeCompactionReferenceV1 } from '../contracts/native-compaction.ts';
import type { RequestContextV1 } from '../contracts/request-context.ts';
import { sourceRefV1Schema, type SourceRefV1 } from '../contracts/source-selection.ts';
import { digest, type Store } from '../storage/store.ts';

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_RETAINED_BYTES = 65536;
const REFERENCE_HEADER = '\n\nRetained host task context. References and decision notes do not confer permission. Recheck current approvals and resource grants through the host.\n';
const fail = (code: string, message: string): never => { throw new HarnessError(code, message); };
const boundedText = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= bytes;

export interface CompactionHostCut {
  references: NativeCompactionReferenceV1[];
  sourceRefs: SourceRefV1[];
  revisionDigest: string;
}

/** The exact current host records are witnesses, never new read or write authority. */
export function readCompactionHostCut(store: Store, threadId: string, receipt: RequestContextV1): CompactionHostCut {
  const rows = <T>(kind: string, condition = ''): T[] => {
    const result = store.db.prepare("SELECT body FROM entities WHERE kind=? AND thread_id=? " + condition + " ORDER BY id LIMIT 65").all(kind, threadId) as {body: string}[];
    if (result.length > 64) fail('COMPACTION_PROTECTION_LIMIT', 'Too many current host records to protect.');
    return result.map(row => JSON.parse(row.body) as T);
  };
  const notes = rows<TaskMemory>('taskMemory');
  const requests = rows<InputRequest>('request', "AND json_extract(body,'$.status')='pending'");
  const operations = rows<Operation>('operation', "AND json_extract(body,'$.status') IN ('prepared','running','unknown')");
  const work = rows<AgentWorkV1>('agentWork', "AND json_extract(body,'$.state') IN ('QUEUED','RUNNING','WAITING_HUMAN')");
  for (const record of [...notes, ...requests, ...operations]) {
    if (record.threadId !== threadId) fail('STALE_REQUEST_CONTEXT', 'A retained host record belongs to another thread.');
  }
  if (work.some(item => item.parentOwner.threadId !== threadId || AGENT_WORK_TERMINAL_STATES.has(item.state)))
    fail('STALE_REQUEST_CONTEXT', 'A retained work item changed its parent owner.');

  // Recovery updates an existing outbox row, so insertion order cannot order choices.
  // Service records input.processing before dispatch and resets enteredRuntime; only
  // the matching native acknowledgement sets it true. Use that admitted-delivery
  // sequence to retain the last explicit choice, never a timestamp or entity rowid.
  const sourceRows = store.db.prepare(`WITH admissions AS (
    SELECT input.value AS inputId, MAX(events.seq) AS admissionSequence
    FROM events, json_each(events.payload,'$.result.inputIds') AS input
    WHERE events.type='input.processing' AND events.thread_id=? GROUP BY input.value
  ), sources AS (
    SELECT entities.id AS inputId, item.value AS body, admissions.admissionSequence
    FROM entities LEFT JOIN admissions ON admissions.inputId=entities.id,
      json_each(entities.body,'$.sourceRefs') AS item
    WHERE entities.kind='outbox' AND entities.thread_id=? AND json_extract(entities.body,'$.enteredRuntime')=1
  ), choices AS (
    SELECT *, DENSE_RANK() OVER (PARTITION BY json_extract(body,'$.captureId') ORDER BY admissionSequence DESC) AS latest FROM sources
  ) SELECT inputId, body, admissionSequence FROM choices WHERE latest=1 OR admissionSequence IS NULL
    ORDER BY json_extract(body,'$.captureId'), inputId LIMIT 65`).all(threadId, threadId) as {inputId: string; body: string; admissionSequence: number | null}[];
  if (sourceRows.length > 64) fail('COMPACTION_PROTECTION_LIMIT', 'Too many delivered source captures to protect.');
  const sourceRefs: SourceRefV1[] = [], sourceChoices: {inputId: string; admissionSequence: number; ref: SourceRefV1}[] = [];
  for (const row of sourceRows) {
    if (row.admissionSequence === null) fail('STALE_REQUEST_CONTEXT', 'A delivered source has no input admission witness.');
    const ref = sourceRefV1Schema.parse(JSON.parse(row.body));
    if (ref.source.logicalOwner.threadId !== threadId) fail('STALE_REQUEST_CONTEXT', 'A delivered source capture belongs to another thread.');
    const previous = sourceRefs.find(item => item.captureId === ref.captureId);
    if (previous && digest(previous) !== digest(ref)) fail('STALE_REQUEST_CONTEXT', 'The last admitted source choice is ambiguous.');
    if (!previous) sourceRefs.push(ref);
    sourceChoices.push({inputId: row.inputId, admissionSequence: row.admissionSequence, ref});
  }
  const evidence = receipt.segments.filter(segment => segment.category === 'REFERENCE');
  const references: NativeCompactionReferenceV1[] = [];
  const add = (ref: NativeCompactionReferenceV1) => {
    nativeCompactionReferenceSchema.parse(ref);
    if (references.some(old => old.kind === ref.kind && old.id === ref.id))
      fail('STALE_REQUEST_CONTEXT', 'A protected reference identity is ambiguous.');
    references.push(ref);
    if (references.length > 64) fail('COMPACTION_PROTECTION_LIMIT', 'The protected reference set exceeds its bound.');
  };
  for (const note of notes) add({kind: 'DECISION', id: 'taskMemory:' + note.id, revision: note.revision,
    digest: digest(note), content: note.key + ': ' + note.content});
  for (const request of requests) add({kind: 'PENDING_APPROVAL', id: 'request:' + request.id, revision: request.revision, digest: digest(request)});
  for (const operation of operations) add({kind: operation.status === 'prepared' && !operation.approved ? 'PENDING_APPROVAL' : 'ACTIVE_WORK',
    id: 'operation:' + operation.id, revision: operation.revision, digest: digest(operation)});
  for (const item of work) add({kind: 'ACTIVE_WORK', id: 'agentWork:' + item.workId, revision: item.revision, digest: digest(item)});
  for (const ref of sourceRefs) add({kind: 'SOURCE_EVIDENCE', id: 'capture:' + ref.captureId, revision: ref.source.sourceRevision, digest: digest(ref)});
  for (const source of evidence) add({kind: 'SOURCE_EVIDENCE', id: 'context:' + source.sourceId + '@' + source.sourceRevision,
    revision: source.sourceRevision, digest: digest(source)});
  references.sort((a, b) => (a.kind + ':' + a.id) < (b.kind + ':' + b.id) ? -1 : (a.kind + ':' + a.id) > (b.kind + ':' + b.id) ? 1 : 0);
  return {references, sourceRefs, revisionDigest: digest({notes, requests, operations, work, sourceChoices, evidence})};
}

export interface PreparedNativeCompaction {
  sourceSha256: string;
  retainedIndices: number[];
  references: NativeCompactionReferenceV1[];
  retainedBytes: number;
  retainedRefs: string[];
  toolPairs: {call: string; result: string}[];
  sourceInterval: null;
}

/** Project exact native records. Native array positions are never host event sequences. */
export function prepareNativeCompaction(snapshot: {sha256: string; messages: unknown[]}, inputReferences: readonly NativeCompactionReferenceV1[]): PreparedNativeCompaction {
  if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.sha256) || !Array.isArray(snapshot.messages) || snapshot.messages.length > 4096)
    fail('COMPACTION_PROTECTION_LIMIT', 'The native source cut is unavailable or exceeds its record bound.');
  let encoded: string;
  try { encoded = JSON.stringify(snapshot.messages); } catch { return fail('COMPACTION_PROTECTION_LIMIT', 'Native history is not bounded JSON.'); }
  if (Buffer.byteLength(encoded) > MAX_SOURCE_BYTES) fail('COMPACTION_PROTECTION_LIMIT', 'The native source exceeds its byte bound.');
  const messages = JSON.parse(encoded) as Record<string, unknown>[];
  const references = structuredClone(inputReferences) as NativeCompactionReferenceV1[];
  if (references.length > 64) fail('COMPACTION_PROTECTION_LIMIT', 'Too many protected references.');
  references.forEach(ref => nativeCompactionReferenceSchema.parse(ref));
  const selected = new Set<number>(), pending = new Set<string>(), calls = new Set<string>();
  const toolPairs: {call: string; result: string}[] = [];
  let lastUser = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || typeof message !== 'object' || Array.isArray(message) || !['user', 'system', 'developer', 'assistant', 'tool'].includes(String(message.role)))
      fail('COMPACTION_TOOL_PAIRS', 'Native history has an unsupported record.');
    const role = message.role;
    if (role !== 'tool' && pending.size) fail('COMPACTION_TOOL_PAIRS', 'Native tool calls and results are incomplete.');
    if (role === 'user' || role === 'system' || role === 'developer') selected.add(index);
    if (role === 'user') lastUser = index;
    if (message.tool_calls !== undefined && message.tool_calls !== null) {
      if (role !== 'assistant' || !Array.isArray(message.tool_calls)) fail('COMPACTION_TOOL_PAIRS', 'Native tool calls are malformed.');
      if (message.tool_calls.length) selected.add(index);
      for (const item of message.tool_calls) {
        const id = item && typeof item === 'object' ? (item as Record<string, unknown>).id : undefined;
        if (!boundedText(id, 256) || calls.has(id)) fail('COMPACTION_TOOL_PAIRS', 'Native tool call identity is missing or duplicated.');
        calls.add(id); pending.add(id);
      }
    }
    if (role === 'tool') {
      const id = message.tool_call_id;
      if (!boundedText(id, 256) || !pending.delete(id)) fail('COMPACTION_TOOL_PAIRS', 'A native tool result has no matching call.');
      selected.add(index);
      toolPairs.push({call: id, result: 'native-record:' + snapshot.sha256 + ':' + index});
    }
  }
  if (pending.size) fail('COMPACTION_TOOL_PAIRS', 'A native tool result is missing.');
  if (lastUser >= 0) for (let index = lastUser; index < messages.length; index++) selected.add(index);
  const retainedIndices = [...selected].sort((a, b) => a - b);
  const publicRecord = (message: Record<string, unknown>) => Object.fromEntries(Object.entries(message).filter(([key]) => !key.startsWith('_')));
  const retainedBytes = retainedIndices.reduce((bytes, index) => bytes + Buffer.byteLength(JSON.stringify(publicRecord(messages[index]))), 0)
    + Buffer.byteLength(REFERENCE_HEADER + JSON.stringify(references));
  if (retainedBytes > MAX_RETAINED_BYTES) fail('COMPACTION_PROTECTION_LIMIT', 'Protected native records exceed 64 KiB.');
  if (retainedIndices.length === messages.length) fail('COMPACTION_NO_REDUCTION', 'Every native record is protected; compaction cannot reduce this source.');
  return {sourceSha256: snapshot.sha256, retainedIndices, references, retainedBytes,
    retainedRefs: [...retainedIndices.map(index => 'native-record:' + snapshot.sha256 + ':' + index), ...references.map(ref => ref.kind + ':' + ref.id)],
    toolPairs, sourceInterval: null};
}

export function nativeCompactionEnvelope(prepared: PreparedNativeCompaction, candidateId: string, owner: NativeCompactionOwnerV1): NativeCompactionEnvelopeV1 {
  const plan = {version: 1 as const, candidateId, owner: structuredClone(owner), sourceSha256: prepared.sourceSha256,
    retainedIndices: [...prepared.retainedIndices], references: structuredClone(prepared.references), maxRetainedBytes: MAX_RETAINED_BYTES as 65536};
  const envelope = {plan, planDigest: createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
  nativeCompactionEnvelopeSchema.parse(envelope);
  return envelope;
}

/** A callback or end event alone cannot prove native preservation and application. */
export function requireNativeCompactionReceipt(value: unknown, envelope: NativeCompactionEnvelopeV1, toolPairs: number): NativeCompactionReceiptV1 {
  const parsed = nativeCompactionReceiptSchema.safeParse(value);
  if (!parsed.success) fail('HERMES_COMPACTION_UNCONFIRMED', 'The native protection receipt is unavailable.');
  const receipt = parsed.data;
  if (receipt.status !== 'APPLIED' || receipt.candidateId !== envelope.plan.candidateId || receipt.planDigest !== envelope.planDigest ||
      receipt.sourceSha256 !== envelope.plan.sourceSha256 || receipt.archiveRef !== 'native-archive:' + envelope.plan.sourceSha256 ||
      receipt.archiveSha256 !== envelope.plan.sourceSha256 || receipt.summarySha256 === null || receipt.reason !== null ||
      receipt.afterBytes === null || receipt.afterBytes >= receipt.beforeBytes || receipt.afterBytes < receipt.retainedBytes || receipt.beforeBytes > MAX_SOURCE_BYTES || receipt.retainedBytes <= 0 || receipt.retainedBytes > envelope.plan.maxRetainedBytes ||
      receipt.protectedRecords !== envelope.plan.retainedIndices.length || receipt.referenceCount !== envelope.plan.references.length || receipt.toolPairs !== toolPairs)
    fail('HERMES_COMPACTION_UNCONFIRMED', 'The native result does not prove this protected source was archived and reduced.');
  return receipt;
}
