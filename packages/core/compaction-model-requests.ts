import {z} from 'zod';
import {HarnessError, type Thread} from '../contracts/index.ts';
import {MODEL_REQUEST_OBSERVATION_LIMIT, modelRequestObservationV1Schema, type ModelRequestObservationV1} from '../contracts/model-request.ts';
import {Store, compactionOwnerKey, digest, type CompactionAttemptRecord} from '../storage/store.ts';

const identity = z.string().min(1).max(200);
const context = modelRequestObservationV1Schema.shape.owner.pick({threadId: true, runId: true, epoch: true});
const admission = context.extend({accountId: modelRequestObservationV1Schema.shape.binding.shape.accountId});
const storedObservation = z.strictObject({id: identity.max(240), candidateId: identity, ownerKey: z.string().regex(/^[a-f0-9]{64}$/), ctx: context, value: modelRequestObservationV1Schema});
const unavailable = () => new HarnessError('COMPACTION_USAGE_UNAVAILABLE', 'The retained compaction measurements could not be verified.');
const missing = () => new HarnessError('NOT_FOUND', 'Compaction history unavailable for the selected thread.');
type Row = {row: number; id: string; body: string};

/** A read of retained observations, never a complete bill or proof of provider dispatch. */
export function readCompactionModelRequests(store: Store, threadId: string, candidateId: string, beforeRequestId?: string): ModelRequestObservationV1[] {
  if (!identity.safeParse(threadId).success || !identity.safeParse(candidateId).success || beforeRequestId !== undefined && !identity.safeParse(beforeRequestId).success)
    throw new HarnessError('INVALID_INPUT', 'Compaction usage identifiers must be single nonempty values.');
  // A synchronous snapshot keeps the owner, admission and page on one durable cut.
  store.db.exec('BEGIN'); let open = true;
  try {
    const sequence = store.sequence;
    const threadRow = store.db.prepare("SELECT body FROM entities WHERE kind='thread' AND id=? AND thread_id=id").get(threadId) as {body: string} | undefined;
    const thread = threadRow ? JSON.parse(threadRow.body) as Thread : undefined;
    if (!thread || thread.id !== threadId || !thread.modelId || !thread.sessionPath || store.get('archivedThread', threadId)) throw missing();
    const ownerKey = compactionOwnerKey(thread, thread.modelId, thread.accountId ?? null);
    const attemptRow = store.db.prepare("SELECT body FROM entities WHERE kind='compactionAttempt' AND id=? AND thread_id=?").get(candidateId, threadId) as {body: string} | undefined;
    const attempt = attemptRow ? JSON.parse(attemptRow.body) as CompactionAttemptRecord : undefined, binding = attempt?.metadata?.binding;
    if (!attempt || attempt.id !== candidateId || attempt.threadId !== threadId || attempt.ownerKey !== ownerKey ||
      attempt.metadata?.version !== 1 || attempt.metadata.candidateId !== candidateId || !binding || !attempt.candidate?.binding ||
      binding.modelId !== thread.modelId || binding.accountId !== (thread.accountId ?? null) ||
      binding.workspaceId !== (thread.workspaceId ?? (thread.projectId ? 'project:' + thread.projectId : 'thread:' + thread.id)) ||
      digest(binding) !== digest(attempt.candidate.binding)) throw missing();

    // The run.compact transaction already retained the host-minted context.
    // Generation is a source revision and must never stand in for its epoch.
    const witnesses = store.db.prepare(`SELECT e.seq,e.payload,r.id,r.body FROM events e JOIN receipts r ON json_extract(r.body,'$.eventSeq')=e.seq
      WHERE e.type='run.compact' AND e.thread_id=? AND json_extract(e.payload,'$.result.runId')=? ORDER BY e.seq LIMIT 2`)
      .all(threadId, 'compaction:' + candidateId) as {seq: number; payload: string; id: string; body: string}[];
    if (witnesses.length !== 1) throw unavailable();
    const witness = witnesses[0], event = JSON.parse(witness.payload), receipt = JSON.parse(witness.body), admitted = admission.safeParse(event?.result), receipted = admission.safeParse(receipt?.result);
    if (!admitted.success || !receipted.success || admitted.data.threadId !== threadId || admitted.data.runId !== 'compaction:' + candidateId ||
      admitted.data.accountId !== binding.accountId || !Number.isSafeInteger(thread.epoch) || admitted.data.epoch > thread.epoch ||
      receipt?.commandId !== witness.id || receipt.eventSeq !== witness.seq || digest(receipt.result) !== digest(event.result)) throw unavailable();
    const ctx = context.parse({threadId: admitted.data.threadId, runId: admitted.data.runId, epoch: admitted.data.epoch});
    const checked = (row: Row): ModelRequestObservationV1 => {
      const parsed = storedObservation.safeParse(JSON.parse(row.body));
      if (!parsed.success) throw unavailable();
      const item = parsed.data, value = item.value;
      if (row.id !== item.id || item.id !== 'compactionModelRequest:' + value.requestId || item.candidateId !== candidateId || item.ownerKey !== ownerKey ||
        digest(item.ctx) !== digest(ctx) || value.owner.threadId !== ctx.threadId || value.owner.runId !== ctx.runId || value.owner.epoch !== ctx.epoch ||
        value.binding.modelId !== binding.modelId || value.binding.accountId !== binding.accountId || value.binding.providerId !== binding.modelId.split('/')[0]) throw unavailable();
      return value;
    };
    const where = "kind='compactionModelRequest' AND thread_id=? AND json_extract(body,'$.candidateId')=? AND json_extract(body,'$.ownerKey')=?";
    let before = Number.MAX_SAFE_INTEGER;
    if (beforeRequestId !== undefined) {
      const cursor = store.db.prepare(`SELECT rowid AS row,id,body FROM entities WHERE ${where} AND id=?`).get(threadId, candidateId, ownerKey, 'compactionModelRequest:' + beforeRequestId) as Row | undefined;
      if (!cursor) throw new HarnessError('INVALID_INPUT', 'The usage cursor is not part of this compaction candidate.');
      checked(cursor); before = cursor.row;
    }
    // This is a page cap only. The private history is not clipped to M11's snapshot retention.
    const rows = store.db.prepare(`SELECT rowid AS row,id,body FROM entities WHERE ${where} AND rowid<? ORDER BY rowid DESC LIMIT ?`)
      .all(threadId, candidateId, ownerKey, before, MODEL_REQUEST_OBSERVATION_LIMIT) as Row[];
    const values = rows.map(checked);
    store.db.exec('COMMIT'); open = false;
    if (store.sequence !== sequence) throw unavailable();
    return values;
  } catch (error) {if (open) store.db.exec('ROLLBACK'); throw error;}
}
