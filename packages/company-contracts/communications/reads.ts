import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import schema from './reads-candidate.1/records.schema.json';
import {canonicalBytes, decodeBoundedJson, type JsonValue} from './json.ts';

export const COMMUNICATION_READ_PIN = Object.freeze({
  contract: 'maritime-communications-reads', version: '1.0.0-reads-candidate.1',
  backendCheckpoint: 'bdfbaae29d2838dcfa28f619b8a3d1c8bcb14113',
  manifestSHA256: 'd7cecf4b7d49c3bbb2ae154725762b5d5dc3af24abbfecf4f56ad70004a12df3',
  outputOnly: true, executable: false, maximumRawBytes: 262144,
});

export type ReadScope = Readonly<{kind: 'project'; id: string} | {kind: 'company_ops'; id: 'company-ops'}>;
/** Expected query binding, not an authenticated principal or permission. */
export interface ReadContext {readonly company_id: string; readonly scope: ReadScope}
export type ReadObservation = Readonly<(
  {source: 'synthetic_fixture'; evidence_scope: 'synthetic_contract'} |
  {source: 'stored_record'; evidence_scope: 'stored_record'} |
  {source: 'unavailable'; evidence_scope: 'unavailable'}
) & {live_verified: false}>;
interface Scoped {readonly company_id: string; readonly scope: ReadScope}
type ExistingRef<Kind extends 'task' | 'work_order'> = Readonly<Scoped & {
  kind: Kind; id: string; availability: 'unavailable'; revision: null; digest: null;
  unavailable_reason: 'existing_record_metadata_unavailable';
}>;
export type ReadRecordRef<Kind extends 'conversation' | 'message'> = Readonly<Scoped & {kind: Kind; id: string} & (
  {availability: 'available'; revision: number; digest: string; unavailable_reason: null} |
  {availability: 'unavailable'; revision: null; digest: null; unavailable_reason: 'linked_record_metadata_unavailable'}
)>;
interface RecordBase extends Scoped {
  readonly id: string; readonly schema_version: 1; readonly availability: 'present';
  readonly revision: number; readonly visibility_revision: number; readonly digest: string;
  readonly observation: ReadObservation;
}
export interface ReadConversation extends RecordBase {
  readonly record_type: 'conversation'; readonly kind: 'project_room' | 'task_thread' | 'company_ops';
  readonly task_ref: ExistingRef<'task'> | null; readonly work_order_ref: ExistingRef<'work_order'> | null;
  readonly title: string; readonly lifecycle: 'open' | 'closed' | 'archived';
}
export interface ReadMessage extends RecordBase {
  readonly record_type: 'message'; readonly conversation_ref: ReadRecordRef<'conversation'>;
  readonly recorded_author: Readonly<Scoped & {principal_id: string; interpretation: 'recorded_reference_only'}>;
  readonly kind: 'question' | 'answer' | 'handoff' | 'review_request' | 'blocker' | 'proposal' | 'note';
  readonly body: string; readonly summary: string; readonly required_action: string | null;
  readonly response_request_ref: null; readonly artifact_refs: readonly [];
  readonly reply_to_message_ref: ReadRecordRef<'message'> | null;
  readonly correlation_ref: Readonly<Scoped & {kind: 'correlation'; id: string}> | null;
  readonly effective_priority: 'normal' | 'digest'; readonly conversation_sequence: number;
  readonly recorded_at_utc_epoch_ms: number;
}
interface PageBase extends Scoped {
  readonly schema_version: 1; readonly availability: 'available' | 'unavailable';
  readonly unavailable_reason: 'canonical_records_unimplemented' | null;
  readonly visibility_revision: number | null; readonly digest: string | null;
  readonly observed_at_utc_epoch_ms: number; readonly item_limit: 50; readonly raw_byte_limit: 262144;
  readonly coverage: Readonly<{status: 'partial' | 'unknown'; truncation: 'item_limit' | 'byte_limit' | 'unknown' | 'none_observed'; total_count: null}>;
  readonly next_cursor: null; readonly has_more: null;
  readonly continuation: Readonly<{status: 'unavailable'; reason: 'cursor_issuance_replay_unimplemented'}>;
  readonly snapshot: Readonly<{status: 'unavailable'; reason: 'snapshot_protocol_unimplemented'}>;
  readonly observation: ReadObservation;
}
export interface ReadConversationPage extends PageBase {readonly page_type: 'conversation_page'; readonly items: readonly ReadConversation[]}
export interface ReadMessagePage extends PageBase {
  readonly page_type: 'message_page'; readonly items: readonly ReadMessage[];
  readonly conversation_ref: ReadRecordRef<'conversation'>;
}
export interface CommunicationReadTypes {
  Conversation: ReadConversation; Message: ReadMessage;
  ConversationPage: ReadConversationPage; MessagePage: ReadMessagePage;
}
export type CommunicationReadKind = keyof CommunicationReadTypes;
type ReadErrorCode = 'fields' | 'read_context' | 'company_mismatch' | 'scope_mismatch' |
  'conversation_mismatch' | 'visibility_mismatch' | 'duplicate_item' | 'duplicate_sequence' |
  'reference_mismatch' | 'text_byte_limit' | 'digest_mismatch';
export class CommunicationReadError extends Error {
  constructor(readonly code: ReadErrorCode) {super(code); this.name = 'CommunicationReadError';}
}
const fail = (code: ReadErrorCode): never => {throw new CommunicationReadError(code);};
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(schema as AnySchemaObject);
const kinds = ['Conversation', 'Message', 'ConversationPage', 'MessagePage'] as const;
const validators = Object.fromEntries(kinds.map(kind => [kind, ajv.getSchema(`${schema.$id}#/$defs/${kind}`)!]));
const companyShape = ajv.getSchema(`${schema.$id}#/$defs/CompanyId`)!;
const scopeShape = ajv.getSchema(`${schema.$id}#/$defs/TaskScope`)!;
type ObjectValue = {[key: string]: JsonValue};
const object = (value: JsonValue): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameScope = (left: JsonValue, right: ReadScope) => object(left) && left.kind === right.kind && left.id === right.id;
const canonicalText = (value: JsonValue) => new TextDecoder().decode(canonicalBytes(value));

function queryContext(expected: ReadContext): ReadContext {
  let value: JsonValue;
  try {value = decodeBoundedJson(canonicalBytes(expected), 32768);} catch {return fail('read_context');}
  if (!object(value) || Object.keys(value).length !== 2 || !companyShape(value.company_id) || !scopeShape(value.scope)) return fail('read_context');
  return value as unknown as ReadContext;
}
// Shared query-data snapshot only; this is never an authorization result.
export {queryContext as snapshotReadContext};
function objects(value: JsonValue, found: ObjectValue[] = []): ObjectValue[] {
  if (Array.isArray(value)) for (const child of value) objects(child, found);
  else if (object(value)) {found.push(value); for (const child of Object.values(value)) objects(child, found);}
  return found;
}
function freeze(value: JsonValue): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}
async function digest(value: ObjectValue): Promise<string> {
  const preimage = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
  const result = await crypto.subtle.digest('SHA-256', canonicalBytes(preimage));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Data validation only. This creates no record, cursor, approval, actor binding or permission. */
export async function validateReadOutput<Kind extends CommunicationReadKind>(kind: Kind, raw: Uint8Array, expected: ReadContext): Promise<CommunicationReadTypes[Kind]> {
  const value = decodeBoundedJson(raw, 262144);
  if (!Object.hasOwn(validators, kind) || !validators[kind](value)) return fail('fields');
  const context = queryContext(expected), nodes = objects(value);
  for (const node of nodes) {
    if ('company_id' in node) {
      if (node.company_id !== context.company_id) fail('company_mismatch');
      if (!sameScope(node.scope, context.scope)) fail('scope_mismatch');
    }
  }
  const root = value as ObjectValue;
  if ('page_type' in root) {
    const ids = new Set<JsonValue>(), sequences = new Set<JsonValue>();
    for (const item of root.items as ObjectValue[]) {
      if (item.visibility_revision !== root.visibility_revision) fail('visibility_mismatch');
      if (root.page_type === 'message_page' && canonicalText(item.conversation_ref) !== canonicalText(root.conversation_ref)) fail('conversation_mismatch');
      if (ids.has(item.id)) fail('duplicate_item'); ids.add(item.id);
      if ('conversation_sequence' in item) {if (sequences.has(item.conversation_sequence)) fail('duplicate_sequence'); sequences.add(item.conversation_sequence);}
    }
  }
  const records = nodes.filter(node => node.record_type === 'conversation' || node.record_type === 'message');
  const included = new Map(records.map(node => [`${node.record_type}:${node.id}`, node]));
  for (const node of nodes) {
    if ((node.kind === 'conversation' || node.kind === 'message') && node.availability === 'available') {
      const target = included.get(`${node.kind}:${node.id}`);
      if (target && (node.revision !== target.revision || node.digest !== target.digest)) fail('reference_mismatch');
    }
  }
  const encoder = new TextEncoder();
  const byteLimits: Record<string, number> = {body: 8192, summary: 1024, title: 1024, required_action: 1024, id: 128, principal_id: 128};
  for (const node of nodes) for (const [key, text] of Object.entries(node)) {
    if (typeof text === 'string' && byteLimits[key] !== undefined && (text.includes('\0') || encoder.encode(text).byteLength > byteLimits[key])) fail('text_byte_limit');
  }
  // Children first; a valid outer digest cannot conceal a stale nested record.
  for (const node of [...nodes].reverse()) {
    if ((node.record_type || node.page_type) && node.digest !== null && await digest(node) !== node.digest) fail('digest_mismatch');
  }
  freeze(value);
  return value as unknown as CommunicationReadTypes[Kind];
}
