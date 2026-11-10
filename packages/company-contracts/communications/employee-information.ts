import * as shapes from '../generated/employee-information.ts';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson, type JsonValue} from './json.ts';
import type {ReadConversation, ReadMessage, ReadRecordRef} from './reads.ts';

export const EMPLOYEE_INFORMATION_PIN = Object.freeze({
  contract: 'maritime-communications', extension: 'employee-information', version: '1.0.0-candidate.1',
  backendCheckpoint: 'ea63ac3dbb668ff5c41e0d62c7fbfcbfbb7b0520',
  descriptorSHA256: '76e55347379d8adc9d4d17cb2f334c2636313eb1255c06bac31567ca14da2bd5',
  schemaSHA256: 'a0a90267037bdfa3a1a098a3a953be3374313a75ef4a902410dd3bdb5932082f',
  goldenSHA256: 'e983a6300c83fa2fb026039882aa12d43d95b387fa954ea7ae071c3d625d6fcd',
  executable: false, maximumCommandRawBytes: 32768, maximumRawBytes: 262144,
});
export type EmployeeProjectScope = Readonly<{kind: 'project'; id: string}>;
/** Independently retained request bindings, never authentication or permission. */
export interface EmployeeCoreBinding {
  readonly principal_id: string; readonly employee_id: string; readonly machine_id: string;
  readonly generation: number; readonly task_id: string; readonly attempt_id: string; readonly work_order_id: string;
}
export interface EmployeeInboxContext {
  readonly company_id: string; readonly scope: EmployeeProjectScope; readonly recipient: EmployeeCoreBinding;
}
export interface EmployeeSendContext extends EmployeeInboxContext {readonly sender: EmployeeCoreBinding}
/** Accepted/current descriptive provenance only. No field grants authority. */
export interface EmployeeInformationActor extends EmployeeCoreBinding {
  readonly scope: EmployeeProjectScope; readonly input_digest: string; readonly binding_digest: string;
  readonly playbook_digest: string; readonly lease_until_utc_epoch_ms: number;
  readonly admission_evidence_scope: 'synthetic_only'; readonly live_verified: false;
}
export interface EmployeeInformationCommand {
  readonly schema_version: 1; readonly command_id: string; readonly action: 'message.send'; readonly scope: EmployeeProjectScope;
  readonly payload: Readonly<{
    conversation_id: string; kind: 'note'; task_id: string; attempt_id: string; summary: string; body: string;
    required_action: null; response_required: false; recipient_employee_ids: readonly [string];
    observer_employee_ids: readonly []; artifact_refs: readonly []; reply_to_message_id: null;
  }>;
}
export interface PreparedEmployeeInformationCommand {
  readonly command: EmployeeInformationCommand; readonly canonicalJson: string; readonly argumentDigest: string;
  readonly executable: false;
}
type Scoped = Readonly<{company_id: string; scope: EmployeeProjectScope}>;
type Observation = Readonly<{source: 'stored_record'; evidence_scope: 'stored_record'; live_verified: false}>;
type CorrelationRef = Readonly<Scoped & {kind: 'correlation'; id: string}>;
type AvailableRef<Kind extends 'conversation' | 'message'> = Readonly<Omit<Extract<ReadRecordRef<Kind>, {availability: 'available'}>, 'scope'> & {scope: EmployeeProjectScope}>;
type NewRef<Kind extends 'delivery' | 'communication_event'> = Readonly<Scoped & {
  kind: Kind; id: string; availability: 'available'; revision: 1; digest: string; unavailable_reason: null;
}>;
interface AcceptedRecord extends Scoped {
  readonly schema_version: 1; readonly id: string; readonly revision: 1; readonly digest: string;
  readonly recorded_at_utc_epoch_ms: number; readonly expires_at_utc_epoch_ms: number;
  readonly correlation_ref: CorrelationRef; readonly observation: Observation;
}
export interface EmployeeInformationReceipt extends AcceptedRecord {
  readonly record_type: 'command_receipt'; readonly principal_id: string; readonly command_id: string;
  readonly action: 'message.send'; readonly argument_digest: string; readonly outcome: 'accepted_information';
  readonly conversation_ref: AvailableRef<'conversation'>; readonly message_ref: AvailableRef<'message'>;
  readonly delivery_ref: NewRef<'delivery'>; readonly event_ref: NewRef<'communication_event'>;
  readonly sender: EmployeeInformationActor; readonly recipient: EmployeeInformationActor;
}
export interface EmployeeInformationDelivery extends AcceptedRecord {
  readonly record_type: 'delivery'; readonly visibility_revision: 1; readonly message_ref: AvailableRef<'message'>;
  readonly recipient: EmployeeInformationActor; readonly inbox_sequence: number; readonly state: 'accepted';
  readonly received_at: null; readonly consumed_at: null;
}
export interface EmployeeInformationEvent extends AcceptedRecord {
  readonly record_type: 'communication_event'; readonly visibility_revision: 1; readonly event_type: 'message.accepted';
  readonly producer: Readonly<{kind: 'company_service'; component: 'communications_acceptance'; version: 1}>;
  readonly conversation_ref: AvailableRef<'conversation'>; readonly message_ref: AvailableRef<'message'>;
  readonly delivery_ref: NewRef<'delivery'>; readonly sender: EmployeeInformationActor;
  readonly recipient: EmployeeInformationActor; readonly sequence: number;
}
export interface EmployeeInformationConversation extends Omit<ReadConversation, 'kind' | 'scope' | 'title' | 'lifecycle' | 'visibility_revision' | 'observation' | 'task_ref' | 'work_order_ref'> {
  readonly scope: EmployeeProjectScope; readonly kind: 'task_thread'; readonly title: 'Employee information discussion';
  readonly lifecycle: 'open'; readonly visibility_revision: 1; readonly observation: Observation;
  readonly task_ref: NonNullable<ReadConversation['task_ref']> & Scoped;
  readonly work_order_ref: NonNullable<ReadConversation['work_order_ref']> & Scoped;
}
export interface EmployeeInformationMessage extends Omit<ReadMessage, 'scope' | 'kind' | 'revision' | 'visibility_revision' | 'required_action' | 'reply_to_message_ref' | 'correlation_ref' | 'effective_priority' | 'observation' | 'conversation_ref' | 'recorded_author'> {
  readonly scope: EmployeeProjectScope; readonly kind: 'note'; readonly revision: 1; readonly visibility_revision: 1;
  readonly required_action: null; readonly reply_to_message_ref: null; readonly correlation_ref: CorrelationRef;
  readonly effective_priority: 'normal'; readonly observation: Observation; readonly conversation_ref: AvailableRef<'conversation'>;
  readonly recorded_author: Readonly<Scoped & {principal_id: string; interpretation: 'recorded_reference_only'}>;
}
export interface EmployeeInformationItem extends Scoped {
  readonly schema_version: 1; readonly projection_type: 'employee_information';
  readonly conversation: EmployeeInformationConversation; readonly message: EmployeeInformationMessage;
  readonly delivery: EmployeeInformationDelivery; readonly event: EmployeeInformationEvent;
  readonly receipt: EmployeeInformationReceipt; readonly observation: Observation; readonly digest: string;
}
export interface EmployeeInformationInbox extends Scoped {
  readonly schema_version: 1; readonly projection_type: 'employee_inbox'; readonly recipient: EmployeeInformationActor;
  readonly items: readonly EmployeeInformationItem[]; readonly requested_limit: number;
  readonly order: 'recipient_sequence_descending'; readonly observed_at_utc_epoch_ms: number;
  readonly coverage: Readonly<{status: 'observed' | 'partial'; truncation: 'none' | 'item_limit' | 'byte_limit'; total_count: null}>;
  readonly next_cursor: null; readonly has_more: null;
  readonly limits: Readonly<{max_items: 50; max_response_utf8_bytes: 262144; continuation: false}>;
  readonly observation: Observation; readonly digest: string;
}
type ValidationCode = 'context' | 'fields' | 'company_mismatch' | 'scope_mismatch' | 'request_mismatch' |
  'actor_mismatch' | 'reference_mismatch' | 'timestamp_mismatch' | 'expiry_mismatch' | 'sequence_mismatch' |
  'duplicate_identity' | 'limit_mismatch' | 'digest_mismatch' | 'text_byte_limit' | 'validation_failed' |
  'invalid_json_type' | 'wire_limit' | 'invalid_utf8' | 'invalid_json' | 'integer_token' | 'unsafe_integer' |
  'duplicate_key' | 'invalid_unicode' | 'depth_limit';
export class EmployeeInformationValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'EmployeeInformationValidationError';}
}
function fail(code: ValidationCode): never {throw new EmployeeInformationValidationError(code);}
function boundedError(error: unknown): never {
  if (error instanceof EmployeeInformationValidationError) throw error;
  if (error instanceof CommunicationContractError) {
    const permitted = ['invalid_json_type', 'wire_limit', 'invalid_utf8', 'invalid_json', 'integer_token', 'unsafe_integer', 'duplicate_key', 'invalid_unicode', 'depth_limit', 'fields'];
    if (permitted.includes(error.code)) fail(error.code as ValidationCode);
  }
  return fail('validation_failed');
}
const commandShape = shapes.Command, receiptShape = shapes.Receipt, inboxShape = shapes.Inbox;
const companyShape = shapes.CompanyId, scopeShape = shapes.ProjectScope;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const text = (value: unknown) => decoder.decode(canonicalBytes(value));
const equal = (left: unknown, right: unknown) => text(left) === text(right);
type ObjectValue = {[key: string]: JsonValue};
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}
function nodes(value: JsonValue, found: ObjectValue[] = []): ObjectValue[] {
  if (Array.isArray(value)) for (const child of value) nodes(child, found);
  else if (object(value)) {found.push(value); for (const child of Object.values(value)) nodes(child, found);}
  return found;
}
const coreKeys = ['principal_id', 'employee_id', 'machine_id', 'generation', 'task_id', 'attempt_id', 'work_order_id'] as const;
function core(actor: EmployeeCoreBinding): EmployeeCoreBinding {return Object.fromEntries(coreKeys.map(key => [key, actor[key]])) as unknown as EmployeeCoreBinding;}
function checkCore(value: unknown): void {
  if (!object(value) || !equal(Object.keys(value).sort(), [...coreKeys].sort())) fail('context');
  for (const key of coreKeys) {
    if (key === 'generation') {if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 1) fail('context');}
    else if (typeof value[key] !== 'string' || !value[key].length || value[key].includes('\0') || encoder.encode(value[key]).byteLength > 128) fail('context');
  }
  if (!/^E(?:0[1-9]|[12][0-9]|3[0-2])$/.test(value.employee_id as string)) fail('context');
}
function captureContext(expected: EmployeeInboxContext | EmployeeSendContext, sending: boolean): EmployeeInboxContext | EmployeeSendContext {
  try {
    const value = decodeBoundedJson(canonicalBytes(expected), 32768);
    const keys = sending ? ['company_id', 'scope', 'sender', 'recipient'] : ['company_id', 'scope', 'recipient'];
    if (!object(value) || !equal(Object.keys(value).sort(), keys.sort()) || !companyShape(value.company_id) || !scopeShape(value.scope)) fail('context');
    checkCore(value.recipient);
    if (sending) {
      checkCore(value.sender);
      if ((value.sender as ObjectValue).principal_id === (value.recipient as ObjectValue).principal_id || (value.sender as ObjectValue).employee_id === (value.recipient as ObjectValue).employee_id) fail('context');
    }
    freeze(value); return value as unknown as EmployeeInboxContext | EmployeeSendContext;
  } catch {return fail('context');}
}
export function captureEmployeeSendContext(expected: EmployeeSendContext): EmployeeSendContext {return captureContext(expected, true) as EmployeeSendContext;}
export function captureEmployeeInboxContext(expected: EmployeeInboxContext): EmployeeInboxContext {return captureContext(expected, false);}
function checkBoundsAndScopes(value: JsonValue, context: EmployeeInboxContext): void {
  const limits: Record<string, number> = {id: 128, principal_id: 128, machine_id: 128, task_id: 128, attempt_id: 128, work_order_id: 128, summary: 1024, body: 8192, title: 1024};
  for (const node of nodes(value)) {
    if ('company_id' in node && node.company_id !== context.company_id) fail('company_mismatch');
    if ('scope' in node && !equal(node.scope, context.scope)) fail('scope_mismatch');
    for (const [key, item] of Object.entries(node)) {
      if (typeof item === 'string' && limits[key] !== undefined && (item.includes('\0') || encoder.encode(item).byteLength > limits[key])) fail('text_byte_limit');
    }
  }
}
function parseCommand(raw: Uint8Array, context: EmployeeSendContext): EmployeeInformationCommand {
  const value = decodeBoundedJson(raw, 32768);
  if (!commandShape(value)) fail('fields');
  checkBoundsAndScopes(value, context);
  const command = value as unknown as EmployeeInformationCommand;
  if (command.payload.task_id !== context.sender.task_id || command.payload.attempt_id !== context.sender.attempt_id || command.payload.recipient_employee_ids[0] !== context.recipient.employee_id) fail('request_mismatch');
  if (canonicalBytes(command).byteLength > 32768) fail('wire_limit');
  freeze(command); return command;
}
async function sha(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(value));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
const withoutDigest = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
const argumentsOnly = (command: EmployeeInformationCommand) => {const {command_id: _commandId, ...rest} = command; return rest;};
/** Captures raw intent and independent core bindings synchronously before hashing. */
export async function prepareEmployeeInformationCommand(raw: Uint8Array, expected: EmployeeSendContext): Promise<PreparedEmployeeInformationCommand> {
  try {
    const context = captureEmployeeSendContext(expected), command = parseCommand(raw, context);
    const canonicalJson = text(command), argumentDigest = await sha(argumentsOnly(command));
    return Object.freeze({command, canonicalJson, argumentDigest, executable: false});
  } catch (error) {return boundedError(error);}
}
function snapshotPrepared(prepared: PreparedEmployeeInformationCommand, context: EmployeeSendContext): PreparedEmployeeInformationCommand {
  const value = decodeBoundedJson(canonicalBytes(prepared), 262144);
  if (!object(value) || !equal(Object.keys(value).sort(), ['command', 'canonicalJson', 'argumentDigest', 'executable'].sort()) || value.executable !== false || typeof value.argumentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.argumentDigest)) fail('request_mismatch');
  const command = parseCommand(canonicalBytes(value.command), context);
  if (value.canonicalJson !== text(command)) fail('request_mismatch');
  freeze(value); return value as unknown as PreparedEmployeeInformationCommand;
}
function checkActor(actor: EmployeeInformationActor, expected: EmployeeCoreBinding): void {if (!equal(core(actor), expected)) fail('actor_mismatch');}
function checkReceipt(receipt: EmployeeInformationReceipt, context: EmployeeSendContext, command: EmployeeInformationCommand): void {
  checkActor(receipt.sender, context.sender); checkActor(receipt.recipient, context.recipient);
  if (receipt.principal_id !== context.sender.principal_id || receipt.principal_id !== receipt.sender.principal_id) fail('actor_mismatch');
  if (receipt.command_id !== command.command_id || receipt.action !== command.action || receipt.conversation_ref.id !== command.payload.conversation_id) fail('request_mismatch');
  if (receipt.message_ref.revision !== 1) fail('reference_mismatch');
  const ids = [receipt.id, receipt.message_ref.id, receipt.delivery_ref.id, receipt.event_ref.id];
  if (new Set(ids).size !== ids.length) fail('duplicate_identity');
  const expectedExpiry = Math.min(receipt.recorded_at_utc_epoch_ms + 900000, receipt.sender.lease_until_utc_epoch_ms, receipt.recipient.lease_until_utc_epoch_ms);
  if (receipt.expires_at_utc_epoch_ms !== expectedExpiry || expectedExpiry <= receipt.recorded_at_utc_epoch_ms) fail('expiry_mismatch');
}
function decodeOutput(raw: Uint8Array, context: EmployeeInboxContext, kind: 'Receipt' | 'Inbox'): JsonValue {
  const value = decodeBoundedJson(raw, 262144);
  if (!(kind === 'Receipt' ? receiptShape(value) : inboxShape(value))) fail('fields');
  if (canonicalBytes(value).byteLength > 262144) fail('wire_limit');
  checkBoundsAndScopes(value, context); freeze(value); return value;
}
async function checkOwnHashes(value: JsonValue): Promise<void> {
  for (const node of nodes(value).reverse()) {
    if (('record_type' in node || 'projection_type' in node) && await sha(withoutDigest(node)) !== node.digest) fail('digest_mismatch');
  }
}
/** Receipt provenance is bound to the actual retained send command. No authority is granted. */
export async function validateEmployeeInformationReceipt(raw: Uint8Array, expected: EmployeeSendContext, prepared: PreparedEmployeeInformationCommand): Promise<EmployeeInformationReceipt> {
  try {
    const context = captureEmployeeSendContext(expected), retained = snapshotPrepared(prepared, context);
    const receipt = decodeOutput(raw, context, 'Receipt') as unknown as EmployeeInformationReceipt;
    checkReceipt(receipt, context, retained.command);
    const digest = await sha(argumentsOnly(retained.command));
    if (digest !== retained.argumentDigest || digest !== receipt.argument_digest) fail('request_mismatch');
    await checkOwnHashes(receipt as unknown as JsonValue); return receipt;
  } catch (error) {return boundedError(error);}
}
function recordRef(record: EmployeeInformationConversation | EmployeeInformationMessage | EmployeeInformationDelivery | EmployeeInformationEvent): object {
  return {kind: record.record_type, id: record.id, company_id: record.company_id, scope: record.scope, availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null};
}
function immutableActor(actor: EmployeeInformationActor): object {
  const {lease_until_utc_epoch_ms: _lease, ...binding} = actor; return binding;
}
function checkItem(item: EmployeeInformationItem, inbox: EmployeeInformationInbox): EmployeeInformationCommand {
  const {conversation, message, delivery, event, receipt} = item;
  // Discovered command is internal consistency data only, never send provenance.
  const context = captureEmployeeSendContext({company_id: inbox.company_id, scope: inbox.scope, sender: core(receipt.sender), recipient: core(receipt.recipient)});
  const command = parseCommand(canonicalBytes({schema_version: 1, command_id: receipt.command_id, action: 'message.send', scope: item.scope, payload: {
    conversation_id: conversation.id, kind: message.kind, task_id: receipt.sender.task_id, attempt_id: receipt.sender.attempt_id,
    summary: message.summary, body: message.body, required_action: message.required_action, response_required: false,
    recipient_employee_ids: [receipt.recipient.employee_id], observer_employee_ids: [], artifact_refs: message.artifact_refs, reply_to_message_id: null,
  }}), context);
  checkReceipt(receipt, context, command);
  if (!equal(immutableActor(inbox.recipient), immutableActor(receipt.recipient)) || !equal(delivery.recipient, receipt.recipient) || !equal(event.recipient, receipt.recipient) || !equal(event.sender, receipt.sender)) fail('actor_mismatch');
  if (message.recorded_author.principal_id !== receipt.sender.principal_id) fail('actor_mismatch');
  if (conversation.task_ref.id !== receipt.sender.task_id || conversation.work_order_ref.id !== receipt.sender.work_order_id) fail('reference_mismatch');
  if (!equal(recordRef(conversation), message.conversation_ref) || !equal(recordRef(conversation), event.conversation_ref) || !equal(recordRef(conversation), receipt.conversation_ref) ||
      !equal(recordRef(message), delivery.message_ref) || !equal(recordRef(message), event.message_ref) || !equal(recordRef(message), receipt.message_ref) ||
      !equal(recordRef(delivery), event.delivery_ref) || !equal(recordRef(delivery), receipt.delivery_ref) || !equal(recordRef(event), receipt.event_ref)) fail('reference_mismatch');
  if (message.conversation_sequence !== conversation.revision) fail('sequence_mismatch');
  for (const record of [message, delivery, event]) {
    if (!equal(record.correlation_ref, receipt.correlation_ref)) fail('reference_mismatch');
    if (record.recorded_at_utc_epoch_ms !== receipt.recorded_at_utc_epoch_ms) fail('timestamp_mismatch');
  }
  if (delivery.expires_at_utc_epoch_ms !== receipt.expires_at_utc_epoch_ms || event.expires_at_utc_epoch_ms !== receipt.expires_at_utc_epoch_ms || receipt.expires_at_utc_epoch_ms <= inbox.observed_at_utc_epoch_ms) fail('expiry_mismatch');
  if (receipt.recorded_at_utc_epoch_ms > inbox.observed_at_utc_epoch_ms) fail('timestamp_mismatch');
  return command;
}
/** Validates this bounded, current observed prefix. It creates no continuation or side effect. */
export async function validateEmployeeInformationInbox(raw: Uint8Array, expected: EmployeeInboxContext, expectedLimit: number): Promise<EmployeeInformationInbox> {
  try {
    const context = captureEmployeeInboxContext(expected);
    if (!Number.isSafeInteger(expectedLimit) || expectedLimit < 1 || expectedLimit > 50) fail('limit_mismatch');
    const inbox = decodeOutput(raw, context, 'Inbox') as unknown as EmployeeInformationInbox;
    if (inbox.requested_limit !== expectedLimit || inbox.items.length > expectedLimit) fail('limit_mismatch');
    if (inbox.coverage.truncation === 'item_limit' && inbox.items.length !== expectedLimit) fail('limit_mismatch');
    checkActor(inbox.recipient, context.recipient);
    if (inbox.recipient.lease_until_utc_epoch_ms <= inbox.observed_at_utc_epoch_ms) fail('expiry_mismatch');
    const identities = new Set<string>(), historicalRevisions = new Set<string>();
    // This map compares immutable participant data only; it never resolves record refs.
    const roomBindings = new Map<string, object>(); let previousSequence = Number.POSITIVE_INFINITY;
    const commands: EmployeeInformationCommand[] = [];
    for (const item of inbox.items) {
      commands.push(checkItem(item, inbox));
      const historicalRevision = `${item.conversation.id}:${item.conversation.revision}`;
      if (historicalRevisions.has(historicalRevision)) fail('reference_mismatch');
      historicalRevisions.add(historicalRevision);
      const binding = {sender: immutableActor(item.receipt.sender), recipient: immutableActor(item.receipt.recipient)};
      const previousBinding = roomBindings.get(item.conversation.id);
      if (previousBinding && !equal(previousBinding, binding)) fail('actor_mismatch');
      roomBindings.set(item.conversation.id, binding);
      if (item.delivery.inbox_sequence >= previousSequence) fail('sequence_mismatch');
      previousSequence = item.delivery.inbox_sequence;
      for (const record of [item.message, item.delivery, item.event, item.receipt]) {
        if (identities.has(record.id)) fail('duplicate_identity'); identities.add(record.id);
      }
    }
    // Every caller-owned value and every consistency check above was captured before await.
    for (let index = 0; index < inbox.items.length; index++) {
      if (await sha(argumentsOnly(commands[index])) !== inbox.items[index].receipt.argument_digest) fail('request_mismatch');
    }
    await checkOwnHashes(inbox as unknown as JsonValue); return inbox;
  } catch (error) {return boundedError(error);}
}
