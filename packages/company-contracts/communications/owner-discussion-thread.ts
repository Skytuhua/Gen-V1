import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import recordsSchema from './reads-candidate.1/records.schema.json';
import discussionSchema from './owner-discussion-candidate.1/discussion.schema.json';
import schema from './owner-discussion-thread-candidate.1/thread.schema.json';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson} from './json.ts';
import {CommunicationReadError, snapshotReadContext, validateReadOutput, type ReadContext, type ReadConversation} from './reads.ts';
import {OwnerDiscussionValidationError, validateOwnerDiscussionReadBack, type OwnerDiscussionCommand, type OwnerDiscussionReadBack} from './owner-discussion.ts';

export const OWNER_DISCUSSION_THREAD_PIN = Object.freeze({
  contract: 'maritime-owner-discussion-thread', version: '1.0.0-candidate.1',
  backendCheckpoint: '06dd3273f9238b830fed0a6e65b08eb9f1cc73fa',
  manifestSHA256: 'cd386b8a084f2619868219a673be2b718802be95bc90cfca96258e13e5c0f6d8',
  schemaSHA256: '442ed5428659ce3336639efd89d651bea54bb4db03bec1b0ca285700c8a173b4',
  examplesSHA256: '6e9ba136bcf3fca5e235201120441b59fc5a983397c6e978f800000e2c872427',
  outputOnly: true, executable: false, maximumRawBytes: 262144, maximumItems: 50,
});

export interface OwnerDiscussionThread {
  readonly schema_version: 1; readonly projection_type: 'owner_discussion_thread';
  readonly company_id: string; readonly scope: Readonly<{kind: 'project'; id: string}>;
  readonly room_head: ReadConversation | null; readonly items: readonly OwnerDiscussionReadBack[];
  readonly requested_limit: number; readonly order: 'conversation_sequence_descending';
  readonly observed_at_utc_epoch_ms: number;
  readonly coverage: Readonly<{status: 'partial'; truncation: 'none_observed' | 'item_limit' | 'byte_limit'; total_count: null}>;
  readonly has_more: null; readonly next_cursor: null;
  readonly continuation: Readonly<{status: 'unavailable'; reason: 'cursor_protocol_unimplemented'}>;
  readonly snapshot: Readonly<{status: 'unavailable'; reason: 'snapshot_protocol_unimplemented'}>;
  readonly limits: Readonly<{max_items: 50; max_response_utf8_bytes: 262144}>;
  readonly observation: Readonly<{source: 'stored_record'; evidence_scope: 'stored_record'; live_verified: false}>;
  readonly digest: string;
}
type ValidationCode = 'fields' | 'read_context' | 'limit_mismatch' | 'company_mismatch' | 'scope_mismatch' |
  'reference_mismatch' | 'visibility_mismatch' | 'sequence_mismatch' | 'duplicate_item' | 'duplicate_sequence' |
  'observation_mismatch' | 'coverage_mismatch' | 'digest_mismatch' | 'validation_failed';
export class OwnerDiscussionThreadValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'OwnerDiscussionThreadValidationError';}
}
const fail = (code: ValidationCode): never => {throw new OwnerDiscussionThreadValidationError(code);};
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(recordsSchema as AnySchemaObject);
ajv.addSchema(discussionSchema as AnySchemaObject);
ajv.addSchema(schema as AnySchemaObject);
const threadShape = ajv.getSchema(`${schema.$id}#/$defs/ThreadPage`)!;
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
function stored(observation: unknown): void {
  if (!equal(observation, {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false})) fail('observation_mismatch');
}
async function digest(value: OwnerDiscussionThread): Promise<string> {
  const preimage = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(preimage));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Discovery data only: no caller room ID or independently retained original append proof. */
export async function validateOwnerDiscussionThread(raw: Uint8Array, expected: ReadContext, expectedLimit: number): Promise<OwnerDiscussionThread> {
  try {
    // Capture every caller-owned input before the first asynchronous record digest.
    const context = projectContext(expected), limit = expectedLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > OWNER_DISCUSSION_THREAD_PIN.maximumItems) fail('read_context');
    const value = decodeBoundedJson(raw, 262144);
    if (!threadShape(value)) fail('fields');
    const page = value as unknown as OwnerDiscussionThread;
    freeze(page);
    if (page.company_id !== context.company_id) fail('company_mismatch');
    if (!equal(page.scope, context.scope)) fail('scope_mismatch');
    if (page.requested_limit !== limit) fail('limit_mismatch');
    if (page.items.length > limit) fail('limit_mismatch');
    stored(page.observation);
    if (page.room_head === null) {
      if (page.items.length !== 0 || page.coverage.truncation !== 'none_observed') fail('coverage_mismatch');
    } else {
      if (page.items.length === 0) fail('coverage_mismatch');
      // Validate the current head separately; older pairs retain their own exact revision.
      const head = await validateReadOutput('Conversation', canonicalBytes(page.room_head), context);
      stored(head.observation);
      const ids = new Set<string>(), sequences = new Set<number>();
      for (const [index, item] of page.items.entries()) {
        // Response-derived command/receipt check INTERNAL stored-pair consistency only.
        // Current authorization/principal binding and private claim/journal verification
        // remain server-owned. Returned record labels and receipts grant no authority.
        const command: OwnerDiscussionCommand = {schema_version: 1, action: item.receipt.action,
          command_id: item.receipt.command_id, summary: item.message.summary, body: item.message.body};
        const pair = await validateOwnerDiscussionReadBack(canonicalBytes(item), context, command, item.receipt);
        if (pair.conversation.id !== head.id) fail('reference_mismatch');
        if (pair.conversation.visibility_revision !== head.visibility_revision || pair.message.visibility_revision !== head.visibility_revision) fail('visibility_mismatch');
        if (ids.has(pair.message.id)) fail('duplicate_item');
        ids.add(pair.message.id);
        if (sequences.has(pair.message.conversation_sequence)) fail('duplicate_sequence');
        sequences.add(pair.message.conversation_sequence);
        if (pair.message.conversation_sequence !== head.revision - index) fail('sequence_mismatch');
        if (index === 0 && !equal(pair.conversation, head)) fail('reference_mismatch');
      }
      const count = page.items.length, truncation = page.coverage.truncation;
      if (truncation === 'none_observed' && count !== head.revision) fail('coverage_mismatch');
      if (truncation === 'item_limit' && (count !== limit || head.revision <= count)) fail('coverage_mismatch');
      if (truncation === 'byte_limit' && count >= Math.min(head.revision, limit)) fail('coverage_mismatch');
    }
    if (await digest(page) !== page.digest) fail('digest_mismatch');
    return page;
  } catch (error) {
    if (error instanceof OwnerDiscussionThreadValidationError || error instanceof CommunicationContractError || error instanceof CommunicationReadError || error instanceof OwnerDiscussionValidationError) throw error;
    return fail('validation_failed');
  }
}
