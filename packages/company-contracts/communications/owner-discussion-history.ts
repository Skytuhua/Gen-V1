import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import recordsSchema from './reads-candidate.1/records.schema.json';
import discussionSchema from './owner-discussion-candidate.1/discussion.schema.json';
import schema from './owner-discussion-history-candidate.1/history.schema.json';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson} from './json.ts';
import {CommunicationReadError, snapshotReadContext, validateReadOutput, type ReadContext, type ReadConversation} from './reads.ts';
import {OwnerDiscussionValidationError, validateOwnerDiscussionReadBack, type OwnerDiscussionCommand, type OwnerDiscussionReadBack, type OwnerDiscussionReceipt} from './owner-discussion.ts';

export const OWNER_DISCUSSION_HISTORY_PIN = Object.freeze({
  contract: 'maritime-owner-discussion-history', version: '1.0.0-candidate.1',
  backendCheckpoint: 'd824991f24b5fd31805f90e528cefb1e05a126ae',
  manifestSHA256: '59cecb824713b945f54f20d0cee595ff5300fc6542754c9c99228e8cf512c323',
  schemaSHA256: 'ee7a862e0a4acb4c4f4a752762b8ddebf054da4d6d19d720ee82f39b19fcb93a',
  examplesSHA256: 'b1c5d64082aac470f20cd75482d86a9ba85f0fbf04c46a779b427b7f9c3daa12',
  outputOnly: true, executable: false, maximumRawBytes: 262144, maximumItems: 50, maximumCursorChars: 4096,
});

export interface OwnerDiscussionHistoryRequest {
  readonly project_id: string; readonly limit: number; readonly cursor: string | null;
}
export interface OwnerDiscussionHistoryPage {
  readonly schema_version: 1; readonly projection_type: 'owner_discussion_history';
  readonly company_id: string; readonly scope: Readonly<{kind: 'project'; id: string}>;
  readonly watermark_head: ReadConversation | null; readonly items: readonly OwnerDiscussionReadBack[];
  readonly requested_limit: number; readonly order: 'conversation_sequence_descending';
  readonly observed_at_utc_epoch_ms: number;
  readonly snapshot: Readonly<{kind: 'append_only_room_cut'; id: string; incarnation: string; access_digest: string;
    issued_at_utc_epoch_ms: number; expires_at_utc_epoch_ms: number;
    watermark_message_ref: OwnerDiscussionReceipt['message_ref'] | null}>;
  readonly range: Readonly<{start_sequence: number | null; end_sequence: number | null; next_sequence: number | null}>;
  readonly has_more: boolean; readonly next_cursor: string | null;
  readonly coverage: Readonly<{status: 'partial' | 'complete_for_cut'; truncation: 'none' | 'item_limit' | 'byte_limit'; total_count: null}>;
  readonly limits: Readonly<{max_items: 50; max_response_utf8_bytes: 262144; max_cursor_chars: 4096}>;
  readonly observation: Readonly<{source: 'stored_record'; evidence_scope: 'stored_record'; live_verified: false}>;
  readonly digest: string;
}
/** Retained query data only; possession of this value or its cursor grants no authority. */
export interface OwnerDiscussionHistoryContinuation {
  readonly context: ReadContext; readonly requestedLimit: number;
  readonly snapshot: OwnerDiscussionHistoryPage['snapshot']; readonly watermarkHead: ReadConversation;
  readonly nextSequence: number; readonly nextCursor: string; readonly seenMessageIds: readonly string[];
}
export interface OwnerDiscussionHistoryResult {
  readonly page: OwnerDiscussionHistoryPage; readonly continuation: OwnerDiscussionHistoryContinuation | null;
}
type ValidationCode = CommunicationContractError['code'] | CommunicationReadError['code'] | OwnerDiscussionValidationError['code'] |
  'limit_mismatch' | 'cursor_mismatch' | 'continuation_mismatch' | 'snapshot_mismatch' | 'range_mismatch' | 'coverage_mismatch';
export class OwnerDiscussionHistoryValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'OwnerDiscussionHistoryValidationError';}
}
function fail(code: ValidationCode): never {throw new OwnerDiscussionHistoryValidationError(code);}
function boundedError(error: unknown): never {
  if (error instanceof OwnerDiscussionHistoryValidationError) throw error;
  if (error instanceof CommunicationContractError || error instanceof CommunicationReadError || error instanceof OwnerDiscussionValidationError) return fail(error.code);
  return fail('validation_failed');
}
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(recordsSchema as AnySchemaObject);
ajv.addSchema(discussionSchema as AnySchemaObject);
ajv.addSchema(schema as AnySchemaObject);
const pageShape = ajv.getSchema(`${schema.$id}#/$defs/HistoryPage`)!;
const requestShape = ajv.getSchema(`${schema.$id}#/$defs/Request`)!;
const snapshotShape = ajv.getSchema(`${schema.$id}#/$defs/HistoryPage/properties/snapshot`)!;
const headShape = ajv.getSchema(`${discussionSchema.$id}#/$defs/Conversation`)!;
const uuidShape = ajv.getSchema(`${recordsSchema.$id}#/$defs/Uuid`)!;
const canonicalText = (value: unknown) => new TextDecoder().decode(canonicalBytes(value));
const equal = (left: unknown, right: unknown) => canonicalText(left) === canonicalText(right);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}
function projectContext(expected: ReadContext): ReadContext {
  try {
    const context = snapshotReadContext(expected);
    if (context.scope.kind !== 'project' || !/^[a-z][a-z0-9-]{0,62}$/.test(context.scope.id) || context.scope.id === 'company-ops') fail('read_context');
    freeze(context); return context;
  } catch {return fail('read_context');}
}
function limitValue(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OWNER_DISCUSSION_HISTORY_PIN.maximumItems) fail('read_context');
}
function cursorValue(cursor: string | null): void {
  if (cursor === null) return;
  if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > OWNER_DISCUSSION_HISTORY_PIN.maximumCursorChars || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail('cursor_mismatch');
  // Check only canonical base64url spelling and unused trailing bits. Never decode
  // a payload, inspect cursor claims, or verify the server's signature here.
  const remainder = cursor.length % 4, last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(cursor.at(-1)!);
  if (remainder === 1 || (remainder === 2 && last % 16 !== 0) || (remainder === 3 && last % 4 !== 0)) fail('cursor_mismatch');
}
function checkScope(value: {company_id: string; scope: ReadContext['scope']}, context: ReadContext): void {
  if (value.company_id !== context.company_id) fail('company_mismatch');
  if (!equal(value.scope, context.scope)) fail('scope_mismatch');
}
function stored(observation: unknown): void {
  if (!equal(observation, {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false})) fail('observation_mismatch');
}
function cutSnapshot(snapshot: OwnerDiscussionHistoryPage['snapshot'], context: ReadContext, present: boolean): void {
  if (!snapshotShape(snapshot)) fail('fields');
  const duration = snapshot.expires_at_utc_epoch_ms - snapshot.issued_at_utc_epoch_ms;
  if (duration <= 0 || duration > 900000) fail('snapshot_mismatch');
  const anchor = snapshot.watermark_message_ref;
  if (present) {
    if (anchor === null || anchor.revision !== 1) fail('reference_mismatch');
    checkScope(anchor, context);
  } else if (anchor !== null) fail('reference_mismatch');
}
function headSnapshot(head: ReadConversation, context: ReadContext): void {
  if (!headShape(head)) fail('fields');
  checkScope(head, context); stored(head.observation);
}
function requestSnapshot(request: OwnerDiscussionHistoryRequest, context: ReadContext): OwnerDiscussionHistoryRequest {
  const retained = decodeBoundedJson(canonicalBytes(request), 32768);
  if (!requestShape(retained)) fail('fields');
  const value = retained as unknown as OwnerDiscussionHistoryRequest;
  if (value.project_id !== context.scope.id) fail('scope_mismatch');
  cursorValue(value.cursor); freeze(value); return value;
}
/** Capture the independently permitted URL project and normalized fixed query synchronously. */
export function normalizeOwnerDiscussionHistoryRequest(expected: ReadContext, limit = 20, cursor: string | null = null): OwnerDiscussionHistoryRequest {
  try {
    const context = projectContext(expected); limitValue(limit); cursorValue(cursor);
    return Object.freeze({project_id: context.scope.id, limit, cursor});
  } catch (error) {return boundedError(error);}
}
/** Closed immutable local state, captured before credentials. No wire cap applies to
 * growing seen IDs: a traversal deliberately uses O(total IDs) retained memory and
 * O(total IDs) copying for each explicit page; it has no cache or implicit fetch. */
export function captureOwnerDiscussionHistoryContinuation(value: OwnerDiscussionHistoryContinuation, expected: ReadContext): OwnerDiscussionHistoryContinuation {
  try {
    const context = projectContext(expected);
    // canonicalBytes rejects accessors, exotic prototypes, non-JSON values and
    // unsafe integers. The subsequent standard clone has no wire-response cap.
    const retained = JSON.parse(canonicalText(value)) as OwnerDiscussionHistoryContinuation;
    const keys = ['context', 'requestedLimit', 'snapshot', 'watermarkHead', 'nextSequence', 'nextCursor', 'seenMessageIds'];
    if (!retained || typeof retained !== 'object' || Array.isArray(retained) || Object.keys(retained).length !== keys.length || !keys.every(key => Object.hasOwn(retained, key))) fail('continuation_mismatch');
    if (!equal(projectContext(retained.context), context)) fail('read_context');
    limitValue(retained.requestedLimit); cursorValue(retained.nextCursor);
    if (retained.nextCursor === null) fail('cursor_mismatch');
    headSnapshot(retained.watermarkHead, context); cutSnapshot(retained.snapshot, context, true);
    const sequence = retained.nextSequence, seen = retained.seenMessageIds;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= retained.watermarkHead.revision || !Array.isArray(seen) || seen.length !== retained.watermarkHead.revision - sequence) fail('continuation_mismatch');
    const ids = new Set<string>();
    for (const id of seen) {if (!uuidShape(id) || ids.has(id)) fail('duplicate_item'); ids.add(id);}
    if (seen[0] !== retained.snapshot.watermark_message_ref!.id) fail('reference_mismatch');
    freeze(retained); return retained;
  } catch (error) {return boundedError(error);}
}
async function digest(page: OwnerDiscussionHistoryPage): Promise<string> {
  const preimage = Object.fromEntries(Object.entries(page).filter(([key]) => key !== 'digest'));
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(preimage));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Validate one explicit immutable-cut page. Clock, current authorization, HMAC,
 * private claims and journals remain server-owned; returned data grants no access. */
export async function validateOwnerDiscussionHistory(raw: Uint8Array, expected: ReadContext, request: OwnerDiscussionHistoryRequest, previous?: OwnerDiscussionHistoryContinuation): Promise<OwnerDiscussionHistoryResult> {
  try {
    // Every caller-owned input is copied before the first asynchronous digest.
    const context = projectContext(expected), retainedRequest = requestSnapshot(request, context);
    const prior = previous === undefined ? undefined : captureOwnerDiscussionHistoryContinuation(previous, context);
    if (retainedRequest.cursor === null) {if (prior !== undefined) fail('continuation_mismatch');}
    else {
      if (prior === undefined) fail('continuation_mismatch');
      if (retainedRequest.cursor !== prior.nextCursor) fail('cursor_mismatch');
      if (retainedRequest.limit !== prior.requestedLimit) fail('limit_mismatch');
    }
    const value = decodeBoundedJson(raw, 262144);
    if (!pageShape(value)) fail('fields');
    const page = value as unknown as OwnerDiscussionHistoryPage;
    freeze(page); checkScope(page, context);
    if (page.requested_limit !== retainedRequest.limit || page.items.length > retainedRequest.limit) fail('limit_mismatch');
    stored(page.observation); cutSnapshot(page.snapshot, context, page.watermark_head !== null);
    if (page.observed_at_utc_epoch_ms !== page.snapshot.issued_at_utc_epoch_ms) fail('observation_mismatch');
    cursorValue(page.next_cursor);
    if (prior && (!equal(page.snapshot, prior.snapshot) || !equal(page.watermark_head, prior.watermarkHead))) fail('snapshot_mismatch');
    const ids = new Set(prior?.seenMessageIds ?? []);
    if (page.watermark_head === null) {
      if (prior || page.items.length !== 0 || page.has_more || page.next_cursor !== null || !equal(page.range, {start_sequence: null, end_sequence: null, next_sequence: null}) || page.coverage.status !== 'complete_for_cut' || page.coverage.truncation !== 'none') fail('coverage_mismatch');
    } else {
      headSnapshot(page.watermark_head, context);
      const start = prior?.nextSequence ?? page.watermark_head.revision;
      if (page.items.length === 0 || page.range.start_sequence !== start) fail('range_mismatch');
      // The watermark is validated separately from each older historical pair.
      const head = await validateReadOutput('Conversation', canonicalBytes(page.watermark_head), context);
      for (const [index, item] of page.items.entries()) {
        // Reconstructed command plus returned receipt checks INTERNAL consistency
        // only. It is never independently retained proof of the original append.
        const command: OwnerDiscussionCommand = {schema_version: 1, action: item.receipt.action, command_id: item.receipt.command_id, summary: item.message.summary, body: item.message.body};
        const pair = await validateOwnerDiscussionReadBack(canonicalBytes(item), context, command, item.receipt);
        if (pair.conversation.id !== head.id) fail('reference_mismatch');
        if (pair.conversation.visibility_revision !== head.visibility_revision || pair.message.visibility_revision !== head.visibility_revision) fail('visibility_mismatch');
        if (pair.message.conversation_sequence !== start - index) fail('sequence_mismatch');
        if (ids.has(pair.message.id)) fail('duplicate_item'); ids.add(pair.message.id);
        if (!prior && index === 0 && (!equal(pair.conversation, head) || !equal(pair.receipt.message_ref, page.snapshot.watermark_message_ref))) fail('reference_mismatch');
      }
      const count = page.items.length, end = page.items[count - 1].message.conversation_sequence;
      if (page.range.end_sequence !== end) fail('range_mismatch');
      if (page.has_more) {
        if (end <= 1 || page.range.next_sequence !== end - 1 || page.next_cursor === null || page.next_cursor === retainedRequest.cursor) fail('range_mismatch');
        if (page.coverage.status !== 'partial') fail('coverage_mismatch');
        if (page.coverage.truncation === 'item_limit') {if (count !== retainedRequest.limit) fail('coverage_mismatch');}
        else if (page.coverage.truncation === 'byte_limit') {if (count >= Math.min(start, retainedRequest.limit)) fail('coverage_mismatch');}
        else fail('coverage_mismatch');
      } else if (end !== 1 || page.range.next_sequence !== null || page.next_cursor !== null || page.coverage.status !== 'complete_for_cut' || page.coverage.truncation !== 'none') fail('coverage_mismatch');
    }
    if (await digest(page) !== page.digest) fail('digest_mismatch');
    const continuation = page.has_more ? {context, requestedLimit: retainedRequest.limit, snapshot: page.snapshot, watermarkHead: page.watermark_head!, nextSequence: page.range.next_sequence!, nextCursor: page.next_cursor!, seenMessageIds: [...ids]} : null;
    freeze(continuation);
    return Object.freeze({page, continuation});
  } catch (error) {return boundedError(error);}
}
