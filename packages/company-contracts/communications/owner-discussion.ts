import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import schema from './owner-discussion-candidate.1/discussion.schema.json';
import recordsSchema from './reads-candidate.1/records.schema.json';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson, type JsonValue} from './json.ts';
import {CommunicationReadError, snapshotReadContext, validateReadOutput, type ReadContext, type ReadConversation, type ReadMessage, type ReadRecordRef} from './reads.ts';

export const OWNER_DISCUSSION_PIN = Object.freeze({
  contract: 'maritime-owner-discussion', version: '1.0.0-candidate.1',
  backendCheckpoint: '111214f5f535f982799fe9f1c178887a7b1dd385',
  manifestSHA256: '0552e449d911f63ba4655a0745a2a93db2b98708f721a1ec37c67ced27ad009a',
  schemaSHA256: '4a6b6fdd8cda6d2f3e8c13a5bd5cb17b9996f83b91dd40925741e990f2bc7a8a',
  examplesSHA256: 'f2bac10ee73fa274f18913e89fcb7262143117f9a4584ade067a16956284d7ea',
  executable: false, maximumCommandRawBytes: 32768, maximumRawBytes: 262144,
});
type ProjectScope = Readonly<{kind: 'project'; id: string}>;
type AvailableRef<Kind extends 'conversation' | 'message'> = Extract<ReadRecordRef<Kind>, {availability: 'available'}>;
export interface OwnerDiscussionCommand {
  readonly schema_version: 1; readonly action: 'owner.discussion.append';
  readonly command_id: string; readonly summary: string; readonly body: string;
}
export interface OwnerDiscussionReceipt {
  readonly receipt_type: 'owner_discussion_receipt'; readonly schema_version: 1;
  readonly action: 'owner.discussion.append'; readonly outcome: 'stored';
  readonly principal_id: string; readonly command_id: string; readonly company_id: string;
  readonly scope: ProjectScope; readonly request_digest: string;
  readonly conversation_ref: AvailableRef<'conversation'>; readonly message_ref: AvailableRef<'message'>;
  readonly recorded_at_utc_epoch_ms: number;
}
export interface OwnerDiscussionReadBack {
  readonly schema_version: 1; readonly projection_type: 'owner_discussion_record';
  readonly company_id: string; readonly scope: ProjectScope;
  readonly conversation: ReadConversation; readonly message: ReadMessage;
  readonly receipt: OwnerDiscussionReceipt;
  readonly observation: Readonly<{source: 'stored_record'; evidence_scope: 'stored_record'; live_verified: false}>;
  readonly digest: string;
}
type ValidationCode = 'fields' | 'read_context' | 'company_mismatch' | 'scope_mismatch' |
  'request_mismatch' | 'reference_mismatch' | 'receipt_mismatch' | 'author_mismatch' |
  'sequence_mismatch' | 'text_mismatch' | 'timestamp_mismatch' | 'observation_mismatch' |
  'digest_mismatch' | 'text_byte_limit' | 'invalid_json_type' | 'wire_limit' | 'invalid_utf8' |
  'invalid_json' | 'integer_token' | 'unsafe_integer' | 'duplicate_key' | 'invalid_unicode' |
  'depth_limit' | 'validation_failed';
export class OwnerDiscussionValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'OwnerDiscussionValidationError';}
}
const fail = (code: ValidationCode): never => {throw new OwnerDiscussionValidationError(code);};
function boundedError(error: unknown): never {
  if (error instanceof OwnerDiscussionValidationError) throw error;
  if (error instanceof CommunicationContractError || error instanceof CommunicationReadError) {
    // Only fixed internal codes are exposed, never schema details or record values.
    const permitted = ['fields', 'read_context', 'company_mismatch', 'scope_mismatch', 'reference_mismatch', 'digest_mismatch', 'text_byte_limit', 'invalid_json_type', 'wire_limit', 'invalid_utf8', 'invalid_json', 'integer_token', 'unsafe_integer', 'duplicate_key', 'invalid_unicode', 'depth_limit'];
    if (permitted.includes(error.code)) fail(error.code as ValidationCode);
  }
  return fail('validation_failed');
}
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(recordsSchema as AnySchemaObject);
ajv.addSchema(schema as AnySchemaObject);
const commandShape = ajv.getSchema(`${schema.$id}#/$defs/Command`)!;
const receiptShape = ajv.getSchema(`${schema.$id}#/$defs/Receipt`)!;
const readBackShape = ajv.getSchema(`${schema.$id}#/$defs/ReadBack`)!;
const encoder = new TextEncoder();
const canonicalText = (value: unknown) => new TextDecoder().decode(canonicalBytes(value));
const equal = (left: unknown, right: unknown) => canonicalText(left) === canonicalText(right);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}
function projectContext(expected: ReadContext): ReadContext {
  try {
    const value = snapshotReadContext(expected);
    if (value.scope.kind !== 'project' || !/^[a-z][a-z0-9-]{0,62}$/.test(value.scope.id) || value.scope.id === 'company-ops') fail('read_context');
    freeze(value); return value;
  } catch {return fail('read_context');}
}
async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', canonicalBytes(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function withoutDigest(value: object): object {return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));}
function checkScope(value: {company_id: string; scope: ReadContext['scope']}, context: ReadContext): void {
  if (value.company_id !== context.company_id) fail('company_mismatch');
  if (!equal(value.scope, context.scope)) fail('scope_mismatch');
}
function receiptSnapshot(raw: Uint8Array, context: ReadContext, command: OwnerDiscussionCommand): OwnerDiscussionReceipt {
  const value = decodeBoundedJson(raw, 262144);
  if (!receiptShape(value)) fail('fields');
  const receipt = value as unknown as OwnerDiscussionReceipt;
  if (encoder.encode(receipt.principal_id).byteLength > 128) fail('text_byte_limit');
  for (const scoped of [receipt, receipt.conversation_ref, receipt.message_ref]) checkScope(scoped, context);
  if (receipt.action !== command.action || receipt.command_id !== command.command_id) fail('request_mismatch');
  if (receipt.message_ref.revision !== 1) fail('reference_mismatch');
  freeze(receipt); return receipt;
}
function commandSnapshot(command: OwnerDiscussionCommand): OwnerDiscussionCommand {
  return parseOwnerDiscussionCommand(canonicalBytes(command));
}
function requestPreimage(command: OwnerDiscussionCommand, context: ReadContext): object {
  return {contract: 'maritime-owner-discussion', version: 1, company_id: context.company_id, scope: context.scope, command};
}

/** Strict command data only; validation grants no actor, permission or execution authority. */
export function parseOwnerDiscussionCommand(raw: Uint8Array): OwnerDiscussionCommand {
  try {
    const value = decodeBoundedJson(raw, 32768);
    if (!commandShape(value)) fail('fields');
    const command = value as unknown as OwnerDiscussionCommand;
    if (encoder.encode(command.summary).byteLength > 1024 || encoder.encode(command.body).byteLength > 8192) fail('text_byte_limit');
    freeze(value); return command;
  } catch (error) {return boundedError(error);}
}
/** Captures independently retained project and complete command before hashing. */
export async function ownerDiscussionRequestDigest(command: OwnerDiscussionCommand, expected: ReadContext): Promise<string> {
  try {
    const context = projectContext(expected), retained = commandSnapshot(command);
    return await sha256(requestPreimage(retained, context));
  } catch (error) {return boundedError(error);}
}
/** Receipt principal and outcome remain descriptive stored data, never authentication proof. */
export async function validateOwnerDiscussionReceipt(raw: Uint8Array, expected: ReadContext, command: OwnerDiscussionCommand): Promise<OwnerDiscussionReceipt> {
  try {
    const context = projectContext(expected), retained = commandSnapshot(command);
    const receipt = receiptSnapshot(raw, context, retained);
    if (await sha256(requestPreimage(retained, context)) !== receipt.request_digest) fail('request_mismatch');
    return receipt;
  } catch (error) {return boundedError(error);}
}
/** Validates the exact receipt-linked historical pair; no current-head or live-state claim. */
export async function validateOwnerDiscussionReadBack(raw: Uint8Array, expected: ReadContext, command: OwnerDiscussionCommand, expectedReceipt: OwnerDiscussionReceipt): Promise<OwnerDiscussionReadBack> {
  try {
    // Snapshot every caller-owned object synchronously, including a cast/unvalidated receipt.
    const context = projectContext(expected), retainedCommand = commandSnapshot(command);
    const retainedReceipt = receiptSnapshot(canonicalBytes(expectedReceipt), context, retainedCommand);
    const value: JsonValue = decodeBoundedJson(raw, 262144);
    if (!readBackShape(value)) fail('fields');
    const readBack = value as unknown as OwnerDiscussionReadBack;
    freeze(value);
    checkScope(readBack, context);
    if (await sha256(requestPreimage(retainedCommand, context)) !== retainedReceipt.request_digest) fail('request_mismatch');
    if (!equal(readBack.receipt, retainedReceipt)) fail('receipt_mismatch');
    const conversation = await validateReadOutput('Conversation', canonicalBytes(readBack.conversation), context);
    const message = await validateReadOutput('Message', canonicalBytes(readBack.message), context);
    const recordRef = (record: ReadConversation | ReadMessage) => ({kind: record.record_type, id: record.id, company_id: record.company_id, scope: record.scope, availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
    if (!equal(recordRef(conversation), retainedReceipt.conversation_ref) || !equal(recordRef(message), retainedReceipt.message_ref) || !equal(message.conversation_ref, retainedReceipt.conversation_ref)) fail('reference_mismatch');
    if (message.conversation_sequence !== conversation.revision) fail('sequence_mismatch');
    if (message.recorded_author.principal_id !== retainedReceipt.principal_id) fail('author_mismatch');
    if (message.recorded_at_utc_epoch_ms !== retainedReceipt.recorded_at_utc_epoch_ms) fail('timestamp_mismatch');
    if (message.summary !== retainedCommand.summary || message.body !== retainedCommand.body) fail('text_mismatch');
    for (const observation of [readBack.observation, conversation.observation, message.observation]) {
      if (!equal(observation, {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false})) fail('observation_mismatch');
    }
    if (await sha256(withoutDigest(readBack)) !== readBack.digest) fail('digest_mismatch');
    return readBack;
  } catch (error) {return boundedError(error);}
}
