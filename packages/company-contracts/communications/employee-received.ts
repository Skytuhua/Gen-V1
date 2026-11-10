import * as shapes from '../generated/employee-received.ts';
import {canonicalBytes, CommunicationContractError, decodeBoundedJson, type JsonValue} from './json.ts';
import {EmployeeInformationValidationError, validateEmployeeInformationInbox, type EmployeeCoreBinding,
  type EmployeeInformationActor, type EmployeeInformationItem, type EmployeeProjectScope} from './employee-information.ts';

export const EMPLOYEE_RECEIVED_PIN = Object.freeze({
  contract: 'maritime-communications', extension: 'employee-received', version: '1.0.0-candidate.1',
  backendCheckpoint: 'cb130ab31b2c8818c4a199a3eb0c9e7017d47c5b',
  descriptorSHA256: '1133105cec39e87da88435e0afd1c40c591dd2470afbfefe3e6c8aac61306016',
  schemaSHA256: 'b73542afe5cbb64ce9b380ebf617ab960e018f57668efce970f929938f8ff4c4',
  goldenSHA256: 'c455ac872fcd750192ca3e52b4c407ae82456c10c60334ec7bdeca14334effb1',
  executable: false, maximumCommandRawBytes: 32768, maximumRawBytes: 262144,
});

/** Independently protected supervisor bindings. These data do not grant permission. */
export interface EmployeeReceivedContext {
  readonly company_id: string; readonly scope: EmployeeProjectScope;
  readonly machine_principal_id: string; readonly journal_owner_id: string;
  readonly recipient: EmployeeInformationActor;
}
type DeliveryRef = EmployeeInformationItem['receipt']['delivery_ref'];
type MessageRef = EmployeeInformationItem['receipt']['message_ref'];
export interface EmployeeLocalReceipt {
  readonly schema_version: 1; readonly record_type: 'local_receive_receipt'; readonly id: string;
  readonly company_id: string; readonly scope: EmployeeProjectScope; readonly delivery_ref: DeliveryRef;
  readonly message_ref: MessageRef; readonly recipient: EmployeeInformationActor;
  readonly machine_principal_id: string; readonly journal_owner_id: string; readonly envelope_digest: string;
  readonly stored_at_utc_epoch_ms: number; readonly stage: 'received'; readonly digest: string;
  readonly observation: Readonly<{source: 'supervisor_journal'; evidence_scope: 'synthetic_only'; live_verified: false}>;
}
export interface EmployeeReceivedCommand {
  readonly schema_version: 1; readonly command_id: string; readonly action: 'delivery.ack'; readonly scope: EmployeeProjectScope;
  readonly payload: Readonly<{stage: 'received'; delivery_ref: DeliveryRef; local_receipt: EmployeeLocalReceipt}>;
}
export interface EmployeeDeliveryReceipt {
  readonly schema_version: 1; readonly record_type: 'delivery_receipt'; readonly id: string; readonly revision: 1;
  readonly company_id: string; readonly scope: EmployeeProjectScope; readonly principal_id: string; readonly command_id: string;
  readonly action: 'delivery.ack'; readonly argument_digest: string; readonly stage: 'received';
  readonly delivery_ref: DeliveryRef; readonly message_ref: MessageRef; readonly recipient: EmployeeInformationActor;
  readonly local_receipt: EmployeeLocalReceipt; readonly received_at_utc_epoch_ms: number; readonly digest: string;
  readonly observation: Readonly<{source: 'stored_record'; evidence_scope: 'stored_record'; live_verified: false}>;
}
export interface PreparedEmployeeReceivedCommand {
  readonly command: EmployeeReceivedCommand; readonly canonicalJson: string; readonly argumentDigest: string;
  readonly envelope: EmployeeInformationItem; readonly context: EmployeeReceivedContext; readonly executable: false;
}
type ValidationCode = CommunicationContractError['code'] | EmployeeInformationValidationError['code'];
export class EmployeeReceivedValidationError extends Error {
  constructor(readonly code: ValidationCode) {super(code); this.name = 'EmployeeReceivedValidationError';}
}
function fail(code: ValidationCode): never {throw new EmployeeReceivedValidationError(code);}
function boundedError(error: unknown): never {
  if (error instanceof EmployeeReceivedValidationError) throw error;
  if (error instanceof CommunicationContractError || error instanceof EmployeeInformationValidationError) fail(error.code);
  return fail('validation_failed');
}
const shape = (kind: 'Command' | 'LocalReceipt' | 'Receipt') => shapes[kind];
const itemShape = shapes.InformationItem, contextShape = shapes.Context;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const text = (value: unknown) => decoder.decode(canonicalBytes(value));
const equal = (left: unknown, right: unknown) => text(left) === text(right);
const withoutDigest = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
const argumentsOnly = (command: EmployeeReceivedCommand) => {const {command_id: _id, ...rest} = command; return rest;};
const immutableActor = (actor: EmployeeInformationActor) => {const {lease_until_utc_epoch_ms: _lease, ...rest} = actor; return rest;};
function freeze(value: unknown): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}
function bounds(value: JsonValue, context: EmployeeReceivedContext): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {for (const child of value) bounds(child, context); return;}
  if ('company_id' in value && value.company_id !== context.company_id) fail('company_mismatch');
  if ('scope' in value && !equal(value.scope, context.scope)) fail('scope_mismatch');
  const opaqueKeys = ['id', 'principal_id', 'machine_principal_id', 'journal_owner_id', 'employee_id', 'machine_id', 'task_id', 'attempt_id', 'work_order_id'];
  for (const [key, child] of Object.entries(value)) {
    if (opaqueKeys.includes(key) && typeof child === 'string' && (child.includes('\0') || encoder.encode(child).byteLength > 128)) fail('text_byte_limit');
    bounds(child, context);
  }
}
function decode<T>(raw: Uint8Array, maximum: 32768 | 262144, validator: (value: unknown) => boolean, context: EmployeeReceivedContext): T {
  const value = decodeBoundedJson(raw, maximum);
  if (!validator(value)) fail('fields');
  if (canonicalBytes(value).byteLength > maximum) fail('wire_limit');
  bounds(value, context); freeze(value); return value as unknown as T;
}
/** Closed snapshot; caller mutations cannot change a validation after its first await. */
export function captureEmployeeReceivedContext(expected: EmployeeReceivedContext): EmployeeReceivedContext {
  try {
    const value = decodeBoundedJson(canonicalBytes(expected), 32768);
    if (!contextShape(value)) fail('context');
    bounds(value, value as unknown as EmployeeReceivedContext); freeze(value);
    return value as unknown as EmployeeReceivedContext;
  } catch {return fail('context');}
}
async function sha(value: unknown): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(value));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
function checkLocal(local: EmployeeLocalReceipt, context: EmployeeReceivedContext, envelope: EmployeeInformationItem): void {
  if (local.machine_principal_id !== context.machine_principal_id || local.journal_owner_id !== context.journal_owner_id) fail('actor_mismatch');
  if (!equal(local.recipient, envelope.delivery.recipient) || !equal(immutableActor(local.recipient), immutableActor(context.recipient))) fail('actor_mismatch');
  if (!equal(local.delivery_ref, envelope.receipt.delivery_ref) || !equal(local.message_ref, envelope.receipt.message_ref)) fail('reference_mismatch');
  if (local.stored_at_utc_epoch_ms < envelope.message.recorded_at_utc_epoch_ms) fail('timestamp_mismatch');
  if (local.stored_at_utc_epoch_ms >= envelope.delivery.expires_at_utc_epoch_ms || context.recipient.lease_until_utc_epoch_ms <= local.stored_at_utc_epoch_ms) fail('expiry_mismatch');
}
function checkCommand(command: EmployeeReceivedCommand, context: EmployeeReceivedContext, envelope: EmployeeInformationItem): void {
  if (command.command_id !== command.payload.local_receipt.id) fail('request_mismatch');
  if (!equal(command.payload.delivery_ref, command.payload.local_receipt.delivery_ref)) fail('reference_mismatch');
  checkLocal(command.payload.local_receipt, context, envelope);
}
/** Private validation adapter only. This constructed wrapper is never returned as an observed inbox. */
async function checkEnvelope(envelope: EmployeeInformationItem, context: EmployeeReceivedContext, storedAt: number): Promise<void> {
  const {principal_id, employee_id, machine_id, generation, task_id, attempt_id, work_order_id} = context.recipient;
  const recipient: EmployeeCoreBinding = {principal_id, employee_id, machine_id, generation, task_id, attempt_id, work_order_id};
  const wrapper = {schema_version: 1, projection_type: 'employee_inbox', company_id: context.company_id, scope: context.scope,
    recipient: context.recipient, items: [envelope], requested_limit: 1, order: 'recipient_sequence_descending',
    observed_at_utc_epoch_ms: storedAt, coverage: {status: 'observed', truncation: 'none', total_count: null},
    next_cursor: null, has_more: null, limits: {max_items: 50, max_response_utf8_bytes: 262144, continuation: false},
    observation: {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false}};
  const digest = await sha(wrapper);
  await validateEmployeeInformationInbox(canonicalBytes({...wrapper, digest}), {company_id: context.company_id, scope: context.scope, recipient}, 1);
}
async function checkHashes(local: EmployeeLocalReceipt, envelope: EmployeeInformationItem): Promise<void> {
  if (await sha(envelope) !== local.envelope_digest || await sha(withoutDigest(local)) !== local.digest) fail('digest_mismatch');
}
/** Validates a supplied storage assertion; does not establish actual filesystem durability. */
export async function validateEmployeeLocalReceipt(raw: Uint8Array, expected: EmployeeReceivedContext, envelopeRaw: Uint8Array): Promise<EmployeeLocalReceipt> {
  try {
    const context = captureEmployeeReceivedContext(expected);
    const local = decode<EmployeeLocalReceipt>(raw, 262144, shape('LocalReceipt'), context);
    const envelope = decode<EmployeeInformationItem>(envelopeRaw, 262144, itemShape, context);
    checkLocal(local, context, envelope);
    await checkEnvelope(envelope, context, local.stored_at_utc_epoch_ms);
    await checkHashes(local, envelope); return local;
  } catch (error) {return boundedError(error);}
}
/** Retains the actual already-persisted command, without creating a receipt, journal, or UUID. */
export async function prepareEmployeeReceivedCommand(raw: Uint8Array, expected: EmployeeReceivedContext, envelopeRaw: Uint8Array): Promise<PreparedEmployeeReceivedCommand> {
  try {
    const context = captureEmployeeReceivedContext(expected);
    const command = decode<EmployeeReceivedCommand>(raw, 32768, shape('Command'), context);
    const envelope = decode<EmployeeInformationItem>(envelopeRaw, 262144, itemShape, context);
    checkCommand(command, context, envelope);
    const canonicalJson = text(command);
    await checkEnvelope(envelope, context, command.payload.local_receipt.stored_at_utc_epoch_ms);
    await checkHashes(command.payload.local_receipt, envelope);
    const argumentDigest = await sha(argumentsOnly(command));
    return Object.freeze({command, canonicalJson, argumentDigest, envelope, context, executable: false});
  } catch (error) {return boundedError(error);}
}
function snapshotPrepared(prepared: PreparedEmployeeReceivedCommand, context: EmployeeReceivedContext): PreparedEmployeeReceivedCommand {
  const value = decodeBoundedJson(canonicalBytes(prepared), 262144);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !equal(Object.keys(value).sort(), ['command', 'canonicalJson', 'argumentDigest', 'envelope', 'context', 'executable'].sort()) ||
    value.executable !== false || typeof value.argumentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.argumentDigest)) fail('request_mismatch');
  const retainedContext = captureEmployeeReceivedContext(value.context as unknown as EmployeeReceivedContext);
  if (!equal({...retainedContext, recipient: immutableActor(retainedContext.recipient)}, {...context, recipient: immutableActor(context.recipient)})) fail('request_mismatch');
  const command = decode<EmployeeReceivedCommand>(canonicalBytes(value.command), 32768, shape('Command'), context);
  const envelope = decode<EmployeeInformationItem>(canonicalBytes(value.envelope), 262144, itemShape, context);
  if (value.canonicalJson !== text(command)) fail('request_mismatch');
  checkCommand(command, context, envelope); freeze(value); return value as unknown as PreparedEmployeeReceivedCommand;
}
/** Binds the service confirmation to the exact retained command and accepted envelope. */
export async function validateEmployeeDeliveryReceipt(raw: Uint8Array, expected: EmployeeReceivedContext, prepared: PreparedEmployeeReceivedCommand): Promise<EmployeeDeliveryReceipt> {
  try {
    const context = captureEmployeeReceivedContext(expected), retained = snapshotPrepared(prepared, context);
    const receipt = decode<EmployeeDeliveryReceipt>(raw, 262144, shape('Receipt'), context);
    const {command, envelope} = retained, local = command.payload.local_receipt;
    if (receipt.principal_id !== context.machine_principal_id || !equal(receipt.recipient, local.recipient)) fail('actor_mismatch');
    if (receipt.command_id !== command.command_id || receipt.action !== command.action || !equal(receipt.local_receipt, local)) fail('request_mismatch');
    if (!equal(receipt.delivery_ref, local.delivery_ref) || !equal(receipt.message_ref, local.message_ref)) fail('reference_mismatch');
    if (receipt.received_at_utc_epoch_ms < local.stored_at_utc_epoch_ms) fail('timestamp_mismatch');
    if (receipt.received_at_utc_epoch_ms >= envelope.delivery.expires_at_utc_epoch_ms || context.recipient.lease_until_utc_epoch_ms <= receipt.received_at_utc_epoch_ms) fail('expiry_mismatch');
    await checkEnvelope(envelope, context, local.stored_at_utc_epoch_ms);
    await checkHashes(local, envelope);
    const argumentDigest = await sha(argumentsOnly(command));
    if (argumentDigest !== retained.argumentDigest || receipt.argument_digest !== argumentDigest) fail('request_mismatch');
    if (await sha(withoutDigest(receipt)) !== receipt.digest) fail('digest_mismatch');
    return receipt;
  } catch (error) {return boundedError(error);}
}
