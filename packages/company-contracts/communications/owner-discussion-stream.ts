import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import recordsSchema from './reads-candidate.1/records.schema.json';
import discussionSchema from './owner-discussion-candidate.1/discussion.schema.json';
import schema from './owner-discussion-stream-candidate.1/stream.schema.json';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson} from './json.ts';
import {CommunicationReadError, snapshotReadContext, validateReadOutput, type ReadContext, type ReadConversation} from './reads.ts';
import {OwnerDiscussionValidationError, validateOwnerDiscussionReadBack, type OwnerDiscussionCommand, type OwnerDiscussionReadBack, type OwnerDiscussionReceipt} from './owner-discussion.ts';

export const OWNER_DISCUSSION_STREAM_PIN = Object.freeze({
  contract: 'maritime-owner-discussion-stream', version: '1.0.0-candidate.1',
  backendCheckpoint: '10bc0d8d20ba55f95130bdb0724800850cbb0c06',
  manifestSHA256: '173f068fc1a01ad5e01c8f4a2d035a324ccc66508ee20af5cb612dbf55b6de30',
  schemaSHA256: '677d95b1d5d9ab95d2c479a3476cf9d8e0ad1f83d5bce91fb123d27738efc4ec',
  examplesSHA256: '84d5053ebe73d71b6e8374b798c1f972293b4d24c933f2b425fb722fc95c8707',
  outputOnly: true, executable: false, maximumRawBytes: 262144, maximumEventBytes: 65536, maximumItems: 50, maximumCursorChars: 4096,
});
export interface OwnerDiscussionStreamRequest {
  readonly operation: 'snapshot' | 'changes'; readonly project_id: string; readonly limit: number; readonly cursor: string | null;
}
type Observation = OwnerDiscussionReadBack['observation'];
type ConversationRef = OwnerDiscussionReceipt['conversation_ref'];
type MessageRef = OwnerDiscussionReceipt['message_ref'];
export interface OwnerDiscussionEventRef {
  readonly kind: 'communication_event'; readonly id: string; readonly company_id: string; readonly scope: OwnerDiscussionReceipt['scope'];
  readonly availability: 'available'; readonly revision: 1; readonly digest: string; readonly unavailable_reason: null;
}
export interface OwnerDiscussionStreamSnapshot {
  readonly kind: 'owner_discussion_public_cut'; readonly id: string; readonly incarnation: string; readonly visibility_revision: 1;
  readonly access_digest: string; readonly stream_epoch: string; readonly issued_at_utc_epoch_ms: number; readonly expires_at_utc_epoch_ms: number;
  readonly coverage_floor: Readonly<{sequence: number; conversation_ref: ConversationRef | null; message_ref: MessageRef | null}>;
  readonly watermark: Readonly<{position: number; conversation_ref: ConversationRef; message_ref: MessageRef; event_ref: OwnerDiscussionEventRef | null}>;
}
export interface OwnerDiscussionEvent {
  readonly record_type: 'communication_event'; readonly id: string; readonly schema_version: 1; readonly revision: 1; readonly visibility_revision: 1;
  readonly company_id: string; readonly scope: OwnerDiscussionReceipt['scope']; readonly event_type: 'owner_discussion.message_stored';
  readonly producer: Readonly<{kind: 'company_service'; component: 'owner_discussion_acceptance'; version: 1}>;
  readonly stream_epoch: string; readonly sequence: number; readonly conversation_ref: ConversationRef; readonly message_ref: MessageRef;
  readonly accepted_command: Readonly<Pick<OwnerDiscussionReceipt, 'action' | 'principal_id' | 'command_id' | 'request_digest'>>;
  readonly recorded_at_utc_epoch_ms: number; readonly observation: Observation; readonly digest: string;
}
export interface OwnerDiscussionEventItem {readonly event: OwnerDiscussionEvent; readonly record: OwnerDiscussionReadBack; readonly digest: string}
interface PageBase {
  readonly schema_version: 1; readonly company_id: string; readonly scope: OwnerDiscussionReceipt['scope']; readonly requested_limit: number;
  readonly observed_at_utc_epoch_ms: number; readonly snapshot: OwnerDiscussionStreamSnapshot; readonly observation: Observation; readonly digest: string;
  readonly limits: Readonly<{max_items: 50; max_event_utf8_bytes: 65536; max_response_utf8_bytes: 262144; max_cursor_chars: 4096}>;
}
export interface OwnerDiscussionSnapshotPage extends PageBase {
  readonly projection_type: 'owner_discussion_snapshot'; readonly room_head: ReadConversation; readonly items: readonly OwnerDiscussionReadBack[];
  readonly order: 'conversation_sequence_descending'; readonly range: Readonly<{start_sequence: number; end_sequence: number; next_sequence: number | null}>;
  readonly has_more: boolean; readonly next_snapshot_cursor: string | null; readonly changes_cursor: string | null;
  readonly coverage: Readonly<{status: 'partial' | 'complete_for_cut'; truncation: 'none' | 'item_limit' | 'byte_limit'; total_count: null}>;
}
export interface OwnerDiscussionChangesPage extends PageBase {
  readonly projection_type: 'owner_discussion_changes'; readonly items: readonly OwnerDiscussionEventItem[]; readonly order: 'public_event_sequence_ascending';
  readonly range: Readonly<{after_position: number; start_position: number | null; end_position: number; observed_through_position: number}>;
  readonly caught_up: boolean; readonly next_cursor: string;
  readonly coverage: Readonly<{status: 'partial' | 'caught_up_through_observed'; truncation: 'none' | 'item_limit' | 'byte_limit'; total_count: null}>;
}
interface StateBase {
  readonly context: ReadContext; readonly requestedLimit: number; readonly snapshot: OwnerDiscussionStreamSnapshot;
  readonly roomHead: ReadConversation; readonly baseline: readonly OwnerDiscussionReadBack[]; readonly nextCursor: string;
}
export interface OwnerDiscussionSnapshotState extends StateBase {readonly mode: 'snapshot'; readonly nextSequence: number}
export interface OwnerDiscussionChangesState extends StateBase {readonly mode: 'changes'; readonly position: number; readonly seenEvents: readonly OwnerDiscussionEventItem[]}
export type OwnerDiscussionStreamState = OwnerDiscussionSnapshotState | OwnerDiscussionChangesState;
export interface OwnerDiscussionSnapshotResult {readonly page: OwnerDiscussionSnapshotPage; readonly state: OwnerDiscussionStreamState}
export interface OwnerDiscussionChangesResult {
  readonly page: OwnerDiscussionChangesPage; readonly state: OwnerDiscussionChangesState; readonly applied: readonly OwnerDiscussionEventItem[];
  readonly request: OwnerDiscussionStreamRequest;
}

type ValidationCode = CommunicationContractError['code'] | CommunicationReadError['code'] | OwnerDiscussionValidationError['code'] |
  'limit_mismatch' | 'cursor_mismatch' | 'continuation_mismatch' | 'snapshot_mismatch' | 'range_mismatch' | 'coverage_mismatch' | 'event_conflict';
export class OwnerDiscussionStreamValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'OwnerDiscussionStreamValidationError';}
}
function fail(code: ValidationCode): never {throw new OwnerDiscussionStreamValidationError(code);}
function boundedError(error: unknown): never {
  if (error instanceof OwnerDiscussionStreamValidationError) throw error;
  if (error instanceof CommunicationContractError || error instanceof CommunicationReadError || error instanceof OwnerDiscussionValidationError) return fail(error.code);
  return fail('validation_failed');
}
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(recordsSchema as AnySchemaObject); ajv.addSchema(discussionSchema as AnySchemaObject); ajv.addSchema(schema as AnySchemaObject);
const shape = (name: string) => ajv.getSchema(`${schema.$id}#/$defs/${name}`)!;
const snapshotPageShape = shape('SnapshotPage'), changesPageShape = shape('EventPage'), snapshotShape = shape('Snapshot');
const eventShape = shape('Event'), itemShape = shape('EventItem'), recordShape = shape('Record');
const headShape = ajv.getSchema(`${discussionSchema.$id}#/$defs/Conversation`)!;
const text = (value: unknown) => new TextDecoder().decode(canonicalBytes(value));
const equal = (a: unknown, b: unknown) => text(a) === text(b);
function freeze(value: unknown): void {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}}
function projectContext(expected: ReadContext): ReadContext {
  try {
    const context = snapshotReadContext(expected);
    if (context.scope.kind !== 'project' || !/^[a-z][a-z0-9-]{0,62}$/.test(context.scope.id) || /[^a-z0-9-]/.test(context.scope.id) || context.scope.id === 'company-ops') fail('read_context');
    freeze(context); return context;
  } catch {return fail('read_context');}
}
function limitValue(limit: number): void {if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('read_context');}
function cursorValue(cursor: string | null): void {
  if (cursor === null) return;
  if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 4096 || /[^A-Za-z0-9_-]/.test(cursor)) fail('cursor_mismatch');
  // Syntax and unused trailing bits only. Never interpret claims or signatures.
  const remainder = cursor.length % 4, last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(cursor.at(-1)!);
  if (remainder === 1 || (remainder === 2 && last % 16 !== 0) || (remainder === 3 && last % 4 !== 0)) fail('cursor_mismatch');
}
function scopes(value: unknown, context: ReadContext): void {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (Object.hasOwn(record, 'company_id') && record.company_id !== context.company_id) fail('company_mismatch');
    if (Object.hasOwn(record, 'scope') && !equal(record.scope, context.scope)) fail('scope_mismatch');
  }
  Object.values(value).forEach(child => scopes(child, context));
}
function ref(record: ReadConversation | OwnerDiscussionReadBack['message']): ConversationRef | MessageRef {
  return {kind: record.record_type, id: record.id, company_id: record.company_id, scope: record.scope as OwnerDiscussionReceipt['scope'],
    availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null};
}
function requestSnapshot(request: OwnerDiscussionStreamRequest, context: ReadContext, operation: 'snapshot' | 'changes'): OwnerDiscussionStreamRequest {
  const value = decodeBoundedJson(canonicalBytes(request), 32768) as unknown as OwnerDiscussionStreamRequest;
  if (!shape(operation === 'snapshot' ? 'SnapshotRequest' : 'ChangesRequest')(value)) fail('fields');
  if (value.project_id !== context.scope.id) fail('scope_mismatch'); cursorValue(value.cursor); freeze(value); return value;
}
/** Capture independently permitted query data before awaiting credentials. This is not authorization. */
export function normalizeOwnerDiscussionStreamRequest(operation: 'snapshot' | 'changes', expected: ReadContext, limit = 20, cursor: string | null = null): OwnerDiscussionStreamRequest {
  try {
    const context = projectContext(expected); limitValue(limit); cursorValue(cursor);
    if (operation !== 'snapshot' && operation !== 'changes') fail('read_context');
    if (operation === 'changes' && cursor === null) fail('cursor_mismatch');
    return Object.freeze({operation, project_id: context.scope.id, limit, cursor});
  } catch (error) {return boundedError(error);}
}
function cut(snapshot: OwnerDiscussionStreamSnapshot, head: ReadConversation, context: ReadContext): void {
  if (!snapshotShape(snapshot) || !headShape(head)) fail('fields'); scopes(snapshot, context); scopes(head, context);
  const duration = snapshot.expires_at_utc_epoch_ms - snapshot.issued_at_utc_epoch_ms;
  if (duration <= 0 || duration > 900000 || head.visibility_revision !== snapshot.visibility_revision) fail('snapshot_mismatch');
  const floor = snapshot.coverage_floor, watermark = snapshot.watermark;
  if (floor.sequence > head.revision || watermark.position !== head.revision - floor.sequence || !equal(watermark.conversation_ref, ref(head)) || watermark.message_ref.revision !== 1) fail('reference_mismatch');
  if (floor.sequence === 0) {if (floor.conversation_ref !== null || floor.message_ref !== null) fail('reference_mismatch');}
  else if (floor.conversation_ref === null || floor.message_ref === null || floor.conversation_ref.id !== head.id || floor.conversation_ref.revision !== floor.sequence || floor.message_ref.revision !== 1) fail('reference_mismatch');
  if ((watermark.position === 0) !== (watermark.event_ref === null)) fail('reference_mismatch');
  if (watermark.position === 0 && (!equal(floor.conversation_ref, watermark.conversation_ref) || !equal(floor.message_ref, watermark.message_ref))) fail('reference_mismatch');
}
function baselineShape(baseline: readonly OwnerDiscussionReadBack[], head: ReadConversation, snapshot: OwnerDiscussionStreamSnapshot, context: ReadContext): void {
  if (!Array.isArray(baseline) || baseline.length < 1 || baseline.length > head.revision) fail('continuation_mismatch');
  const ids = new Set<string>();
  for (const [index, item] of baseline.entries()) {
    if (!recordShape(item)) fail('fields'); scopes(item, context);
    if (item.message.conversation_sequence !== head.revision - index || item.conversation.id !== head.id || item.conversation.visibility_revision !== snapshot.visibility_revision || item.message.visibility_revision !== snapshot.visibility_revision) fail('sequence_mismatch');
    if (ids.has(item.message.id)) fail('duplicate_item'); ids.add(item.message.id);
    if (index === 0 && (!equal(item.conversation, head) || !equal(ref(item.message), snapshot.watermark.message_ref))) fail('reference_mismatch');
    if (item.message.conversation_sequence === snapshot.coverage_floor.sequence && (!equal(ref(item.conversation), snapshot.coverage_floor.conversation_ref) || !equal(ref(item.message), snapshot.coverage_floor.message_ref))) fail('reference_mismatch');
  }
}
/** Closed caller-owned local data, with no wire-size cap on total retained records.
 * Capturing and revalidating costs O(total baseline + events) per explicit read.
 * Callers control lifetime/discard; no cache, background fetch or authorization is created. */
export function captureOwnerDiscussionStreamState(value: OwnerDiscussionStreamState, expected: ReadContext): OwnerDiscussionStreamState {
  try {
    const context = projectContext(expected), retained = JSON.parse(text(value)) as OwnerDiscussionStreamState;
    const common = ['mode', 'context', 'requestedLimit', 'snapshot', 'roomHead', 'baseline', 'nextCursor'];
    const keys = retained?.mode === 'snapshot' ? [...common, 'nextSequence'] : [...common, 'position', 'seenEvents'];
    if (!retained || typeof retained !== 'object' || Array.isArray(retained) || !['snapshot', 'changes'].includes(retained.mode) || Object.keys(retained).length !== keys.length || !keys.every(key => Object.hasOwn(retained, key))) fail('continuation_mismatch');
    if (!equal(projectContext(retained.context), context)) fail('read_context'); limitValue(retained.requestedLimit); cursorValue(retained.nextCursor);
    if (retained.nextCursor === null) fail('cursor_mismatch');
    cut(retained.snapshot, retained.roomHead, context); baselineShape(retained.baseline, retained.roomHead, retained.snapshot, context);
    if (retained.mode === 'snapshot') {
      if (!Number.isSafeInteger(retained.nextSequence) || retained.nextSequence < 1 || retained.nextSequence !== retained.roomHead.revision - retained.baseline.length) fail('continuation_mismatch');
    } else {
      if (retained.baseline.length !== retained.roomHead.revision || !Number.isSafeInteger(retained.position) || retained.position < retained.snapshot.watermark.position || !Array.isArray(retained.seenEvents) || retained.seenEvents.length !== retained.position - retained.snapshot.watermark.position) fail('continuation_mismatch');
      const ids = new Set<string>(retained.snapshot.watermark.event_ref ? [retained.snapshot.watermark.event_ref.id] : []), messages = new Set(retained.baseline.map(item => item.message.id));
      for (const [index, item] of retained.seenEvents.entries()) {
        if (!itemShape(item)) fail('fields'); scopes(item, context);
        if (canonicalBytes(item).byteLength > 65536) fail('wire_limit');
        if (item.event.sequence !== retained.snapshot.watermark.position + index + 1) fail('range_mismatch');
        if (ids.has(item.event.id) || messages.has(item.record.message.id)) fail('duplicate_item'); ids.add(item.event.id); messages.add(item.record.message.id);
      }
    }
    freeze(retained); return retained;
  } catch (error) {return boundedError(error);}
}
async function digest(value: {readonly digest: string}): Promise<string> {
  const preimage = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(preimage));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
function reconstructEvent(id: string, sequence: number, snapshot: OwnerDiscussionStreamSnapshot, record: OwnerDiscussionReadBack): Omit<OwnerDiscussionEvent, 'digest'> {
  const receipt = record.receipt;
  return {record_type: 'communication_event', id, schema_version: 1, revision: 1, visibility_revision: 1,
    company_id: record.company_id, scope: record.scope, event_type: 'owner_discussion.message_stored',
    producer: {kind: 'company_service', component: 'owner_discussion_acceptance', version: 1}, stream_epoch: snapshot.stream_epoch, sequence,
    conversation_ref: receipt.conversation_ref, message_ref: receipt.message_ref,
    accepted_command: {action: receipt.action, principal_id: receipt.principal_id, command_id: receipt.command_id, request_digest: receipt.request_digest},
    recorded_at_utc_epoch_ms: record.message.recorded_at_utc_epoch_ms, observation: record.observation};
}
async function validRecord(item: OwnerDiscussionReadBack, context: ReadContext): Promise<void> {
  // This reconstructed command/receipt checks INTERNAL consistency only. It is
  // never independently retained evidence of append provenance or authority.
  const command: OwnerDiscussionCommand = {schema_version: 1, action: item.receipt.action, command_id: item.receipt.command_id, summary: item.message.summary, body: item.message.body};
  await validateOwnerDiscussionReadBack(canonicalBytes(item), context, command, item.receipt);
}
async function validBaseline(state: StateBase): Promise<void> {
  await validateReadOutput('Conversation', canonicalBytes(state.roomHead), state.context);
  for (const item of state.baseline) await validRecord(item, state.context);
  const watermark = state.snapshot.watermark;
  if (watermark.event_ref !== null) {
    const event = {...reconstructEvent(watermark.event_ref.id, watermark.position, state.snapshot, state.baseline[0]), digest: watermark.event_ref.digest};
    if (!eventShape(event) || await digest(event) !== event.digest) fail('digest_mismatch');
  }
}
async function validEvent(item: OwnerDiscussionEventItem, state: StateBase): Promise<void> {
  if (!itemShape(item)) fail('fields'); scopes(item, state.context);
  if (canonicalBytes(item).byteLength > 65536) fail('wire_limit');
  await validRecord(item.record, state.context);
  const event = item.event, record = item.record, sequence = state.snapshot.coverage_floor.sequence + event.sequence;
  if (!Number.isSafeInteger(sequence) || record.message.conversation_sequence !== sequence || record.conversation.id !== state.roomHead.id || record.message.visibility_revision !== 1 || record.conversation.visibility_revision !== 1) fail('sequence_mismatch');
  if (!equal(event, {...reconstructEvent(event.id, event.sequence, state.snapshot, record), digest: event.digest})) fail('reference_mismatch');
  if (event.recorded_at_utc_epoch_ms < state.snapshot.issued_at_utc_epoch_ms) fail('timestamp_mismatch');
  if (await digest(event) !== event.digest || await digest(item) !== item.digest) fail('digest_mismatch');
}
async function validState(state: OwnerDiscussionStreamState): Promise<void> {
  await validBaseline(state);
  if (state.mode === 'changes') for (const item of state.seenEvents) await validEvent(item, state);
}
function pageCommon(page: PageBase, context: ReadContext, request: OwnerDiscussionStreamRequest): void {
  scopes(page, context);
  if (canonicalBytes(page).byteLength > 262144) fail('wire_limit');
  if (page.requested_limit !== request.limit) fail('limit_mismatch');
  if (page.observed_at_utc_epoch_ms < page.snapshot.issued_at_utc_epoch_ms || page.observed_at_utc_epoch_ms >= page.snapshot.expires_at_utc_epoch_ms) fail('timestamp_mismatch');
}
function boundRequest(request: OwnerDiscussionStreamRequest, state: OwnerDiscussionStreamState): void {
  if (request.cursor !== state.nextCursor) fail('cursor_mismatch');
  if (request.limit !== state.requestedLimit) fail('limit_mismatch');
}
/** One explicit snapshot page. Only a complete validated baseline yields changes state. */
export async function validateOwnerDiscussionSnapshot(raw: Uint8Array, expected: ReadContext, request: OwnerDiscussionStreamRequest, previous?: OwnerDiscussionSnapshotState): Promise<OwnerDiscussionSnapshotResult> {
  try {
    const context = projectContext(expected), query = requestSnapshot(request, context, 'snapshot');
    const prior = previous === undefined ? undefined : captureOwnerDiscussionStreamState(previous, context);
    if (query.cursor === null) {if (prior !== undefined) fail('continuation_mismatch');}
    else {if (!prior || prior.mode !== 'snapshot') fail('continuation_mismatch'); boundRequest(query, prior);}
    const value = decodeBoundedJson(raw, 262144); if (!snapshotPageShape(value)) fail('fields');
    const page = value as unknown as OwnerDiscussionSnapshotPage; freeze(page); pageCommon(page, context, query);
    cut(page.snapshot, page.room_head, context); cursorValue(page.next_snapshot_cursor); cursorValue(page.changes_cursor);
    if (page.items.length > query.limit) fail('limit_mismatch');
    if (prior && (!equal(prior.snapshot, page.snapshot) || !equal(prior.roomHead, page.room_head))) fail('snapshot_mismatch');
    const start = prior && prior.mode === 'snapshot' ? prior.nextSequence : page.room_head.revision;
    if (page.range.start_sequence !== start) fail('range_mismatch');
    const baseline = [...(prior?.baseline ?? []), ...page.items];
    baselineShape(baseline, page.room_head, page.snapshot, context);
    const end = page.items.at(-1)!.message.conversation_sequence;
    if (page.range.end_sequence !== end) fail('range_mismatch');
    if (page.has_more) {
      if (end <= 1 || page.range.next_sequence !== end - 1 || page.next_snapshot_cursor === null || page.next_snapshot_cursor === query.cursor || page.changes_cursor !== null || page.coverage.status !== 'partial') fail('coverage_mismatch');
      if (page.coverage.truncation === 'item_limit') {if (page.items.length !== query.limit) fail('coverage_mismatch');}
      else if (page.coverage.truncation === 'byte_limit') {if (page.items.length >= Math.min(start, query.limit)) fail('coverage_mismatch');}
      else fail('coverage_mismatch');
    } else if (end !== 1 || page.range.next_sequence !== null || page.next_snapshot_cursor !== null || page.changes_cursor === null || page.coverage.status !== 'complete_for_cut' || page.coverage.truncation !== 'none') fail('coverage_mismatch');
    const common = {context, requestedLimit: query.limit, snapshot: page.snapshot, roomHead: page.room_head, baseline};
    const state: OwnerDiscussionStreamState = page.has_more ? {...common, mode: 'snapshot', nextSequence: end - 1, nextCursor: page.next_snapshot_cursor!} :
      {...common, mode: 'changes', position: page.snapshot.watermark.position, nextCursor: page.changes_cursor!, seenEvents: []};
    freeze(state); await validState(state);
    if (await digest(page) !== page.digest) fail('digest_mismatch');
    return Object.freeze({page, state});
  } catch (error) {return boundedError(error);}
}
/** One explicit catch-up. Authentication, expiry, private claims and HMAC remain server-owned. */
export async function validateOwnerDiscussionChanges(raw: Uint8Array, expected: ReadContext, request: OwnerDiscussionStreamRequest, previous: OwnerDiscussionChangesState): Promise<OwnerDiscussionChangesResult> {
  try {
    const context = projectContext(expected), query = requestSnapshot(request, context, 'changes'), prior = captureOwnerDiscussionStreamState(previous, context);
    if (prior.mode !== 'changes') fail('continuation_mismatch'); boundRequest(query, prior);
    const value = decodeBoundedJson(raw, 262144); if (!changesPageShape(value)) fail('fields');
    const page = value as unknown as OwnerDiscussionChangesPage; freeze(page); pageCommon(page, context, query); cursorValue(page.next_cursor);
    if (!equal(page.snapshot, prior.snapshot)) fail('snapshot_mismatch');
    if (page.items.length > query.limit) fail('limit_mismatch');
    const range = page.range, count = page.items.length;
    if (range.after_position !== prior.position || range.after_position < page.snapshot.watermark.position || range.observed_through_position < range.end_position || range.end_position !== range.after_position + count || !Number.isSafeInteger(range.end_position)) fail('range_mismatch');
    if (count === 0) {if (range.start_position !== null || range.end_position !== range.observed_through_position || page.next_cursor !== query.cursor) fail('range_mismatch');}
    else if (range.start_position !== range.after_position + 1 || page.next_cursor === query.cursor) fail('range_mismatch');
    if (page.caught_up !== (range.end_position === range.observed_through_position)) fail('coverage_mismatch');
    if (page.caught_up) {if (page.coverage.status !== 'caught_up_through_observed' || page.coverage.truncation !== 'none') fail('coverage_mismatch');}
    else {
      if (count === 0 || page.coverage.status !== 'partial') fail('coverage_mismatch');
      if (page.coverage.truncation === 'item_limit') {if (count !== query.limit) fail('coverage_mismatch');}
      else if (page.coverage.truncation === 'byte_limit') {if (count >= Math.min(query.limit, range.observed_through_position - range.after_position)) fail('coverage_mismatch');}
      else fail('coverage_mismatch');
    }
    await validState(prior);
    const seenEvents = [...prior.seenEvents], ids = new Set(seenEvents.map(item => item.event.id));
    if (prior.snapshot.watermark.event_ref) ids.add(prior.snapshot.watermark.event_ref.id);
    const messages = new Set([...prior.baseline.map(item => item.message.id), ...seenEvents.map(item => item.record.message.id)]);
    for (const [index, item] of page.items.entries()) {
      if (item.event.sequence !== prior.position + index + 1) fail('range_mismatch');
      if (ids.has(item.event.id) || messages.has(item.record.message.id)) fail('duplicate_item');
      ids.add(item.event.id); messages.add(item.record.message.id); await validEvent(item, prior); seenEvents.push(item);
    }
    if (await digest(page) !== page.digest) fail('digest_mismatch');
    const state: OwnerDiscussionChangesState = {...prior, position: range.end_position, nextCursor: page.next_cursor, seenEvents}; freeze(state);
    return Object.freeze({page, state, applied: page.items, request: query});
  } catch (error) {return boundedError(error);}
}
/** Pure data projection across an explicitly retained older-cursor replay. Recheck
 * full data instead of relying on an unforgeable brand or a global registry.
 * No event text or accepted-command metadata is ever executed. */
export async function projectOwnerDiscussionChanges(latest: OwnerDiscussionChangesState, result: OwnerDiscussionChangesResult): Promise<OwnerDiscussionChangesResult> {
  try {
    // Canonical cloning snapshots all caller inputs before the first await.
    const captured = JSON.parse(text({latest, result})) as {latest: OwnerDiscussionChangesState; result: OwnerDiscussionChangesResult};
    const current = captureOwnerDiscussionStreamState(captured.latest, captured.latest.context), incoming = captureOwnerDiscussionStreamState(captured.result.state, captured.latest.context);
    if (current.mode !== 'changes' || incoming.mode !== 'changes') fail('continuation_mismatch');
    if (!equal(current.snapshot, incoming.snapshot) || !equal(current.roomHead, incoming.roomHead) || !equal(current.baseline, incoming.baseline) || current.requestedLimit !== incoming.requestedLimit) fail('snapshot_mismatch');
    const page = captured.result.page, after = page.range.after_position;
    if (after < incoming.snapshot.watermark.position || after > incoming.position || after > current.position) fail('range_mismatch');
    const request = requestSnapshot(captured.result.request, current.context, 'changes');
    const old: OwnerDiscussionChangesState = {...incoming, position: after, nextCursor: request.cursor!, seenEvents: incoming.seenEvents.slice(0, after - incoming.snapshot.watermark.position)};
    const validated = await validateOwnerDiscussionChanges(canonicalBytes(page), current.context,
      request, old);
    await validState(current); await validState(incoming);
    if (incoming.position !== page.range.end_position || incoming.nextCursor !== page.next_cursor || !equal(incoming.seenEvents, validated.state.seenEvents)) fail('continuation_mismatch');
    const seenEvents = [...current.seenEvents], applied: OwnerDiscussionEventItem[] = [];
    for (const item of incoming.seenEvents) {
      const index = item.event.sequence - current.snapshot.watermark.position - 1;
      const existing = seenEvents[index];
      if (existing) {if (!equal(existing, item)) fail('event_conflict');}
      else {
        if (index !== seenEvents.length || seenEvents.some(prior => prior.event.id === item.event.id || prior.record.message.id === item.record.message.id)) fail('event_conflict');
        seenEvents.push(item); applied.push(item);
      }
    }
    const state = page.range.end_position > current.position ? {...current, position: page.range.end_position, nextCursor: page.next_cursor, seenEvents} : current;
    freeze(state); freeze(applied); freeze(page); return Object.freeze({page, state, applied, request});
  } catch (error) {return boundedError(error);}
}
