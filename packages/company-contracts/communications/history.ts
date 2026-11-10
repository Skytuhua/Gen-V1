import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import schema from './owner-note-history-candidate.1/history.schema.json';
import recordsSchema from './reads-candidate.1/records.schema.json';
import {canonicalBytes, decodeBoundedJson, type JsonValue} from './json.ts';
import {snapshotReadContext, validateReadOutput, type ReadContext, type ReadConversation, type ReadMessage, type ReadObservation} from './reads.ts';

export const OWNER_NOTE_HISTORY_PIN = Object.freeze({
  contract: 'maritime-owner-note-history', version: '1.0.0-history-candidate.1',
  backendCheckpoint: '24ff923dae78e5701447b687620b18c3c713c573',
  manifestSHA256: '26fd87d8b2065a1546f905963c8c0ebdc06f7a4783dd10993f94d83bb85a5f54',
  queryBindingCheckpoint: '966995529a306bfa93e6997667041605909ba711',
  executable: false, maximumRawBytes: 262144,
});
export interface OwnerNoteHistory {
  readonly schema_version: 1; readonly projection_type: 'owner_note_history';
  readonly company_id: string; readonly scope: Readonly<{kind: 'project'; id: string}>;
  readonly room_head: ReadConversation | null;
  readonly items: readonly Readonly<{conversation: ReadConversation; message: ReadMessage}>[];
  readonly requested_limit: number; readonly order: 'conversation_sequence_descending';
  readonly observed_at_utc_epoch_ms: number;
  readonly coverage: Readonly<{status: 'partial'; truncation: 'item_limit' | 'byte_limit' | 'none_observed'; total_count: null}>;
  readonly has_more: null; readonly next_cursor: null;
  readonly continuation: Readonly<{status: 'unavailable'; reason: 'cursor_issuance_replay_unimplemented'}>;
  readonly snapshot: Readonly<{status: 'unavailable'; reason: 'snapshot_protocol_unimplemented'}>;
  readonly observation: ReadObservation; readonly digest: string;
}
type HistoryErrorCode = 'fields' | 'read_context' | 'limit_mismatch' | 'company_mismatch' |
  'scope_mismatch' | 'reference_mismatch' | 'sequence_mismatch' | 'duplicate_item' |
  'observation_mismatch' | 'digest_mismatch';
export class OwnerNoteHistoryError extends Error {
  constructor(readonly code: HistoryErrorCode) {super(code); this.name = 'OwnerNoteHistoryError';}
}
const fail = (code: HistoryErrorCode): never => {throw new OwnerNoteHistoryError(code);};
const ajv = new Ajv2020({strict: true, allErrors: false});
ajv.addSchema(recordsSchema as AnySchemaObject);
const shape = ajv.compile(schema as AnySchemaObject);
const canonicalText = (value: unknown) => new TextDecoder().decode(canonicalBytes(value));
function freeze(value: JsonValue): void {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
}

/** Data validation only. Expected scope and resolved query limit must be retained
 * independently; neither this projection nor its observations grant authority. */
export async function validateOwnerNoteHistory(raw: Uint8Array, expected: ReadContext, expectedLimit: number): Promise<OwnerNoteHistory> {
  const value = decodeBoundedJson(raw, 262144);
  if (!shape(value)) return fail('fields');
  const context = snapshotReadContext(expected);
  if (context.scope.kind !== 'project' || !Number.isInteger(expectedLimit) || expectedLimit < 1 || expectedLimit > 50) return fail('read_context');
  const history = value as unknown as OwnerNoteHistory;
  if (history.company_id !== context.company_id) fail('company_mismatch');
  if (history.scope.kind !== context.scope.kind || history.scope.id !== context.scope.id) fail('scope_mismatch');
  if (history.requested_limit !== expectedLimit || history.items.length > expectedLimit) fail('limit_mismatch');
  const observation = canonicalText(history.observation), ids = new Set<string>();
  const checkObservation = (record: ReadConversation | ReadMessage) => {
    if (canonicalText(record.observation) !== observation) fail('observation_mismatch');
  };
  if (history.room_head) {
    const head = await validateReadOutput('Conversation', canonicalBytes(history.room_head), context);
    checkObservation(head);
    for (const [index, pair] of history.items.entries()) {
      // Validate separate records: an ID-only map would collapse historical revisions.
      const conversation = await validateReadOutput('Conversation', canonicalBytes(pair.conversation), context);
      const message = await validateReadOutput('Message', canonicalBytes(pair.message), context);
      checkObservation(conversation); checkObservation(message);
      if (conversation.id !== head.id || message.conversation_ref.availability !== 'available' || message.conversation_ref.id !== conversation.id || message.conversation_ref.revision !== conversation.revision || message.conversation_ref.digest !== conversation.digest) fail('reference_mismatch');
      if (message.conversation_sequence !== head.revision - index || conversation.revision !== message.conversation_sequence) fail('sequence_mismatch');
      if (ids.has(message.id)) fail('duplicate_item'); ids.add(message.id);
    }
  }
  const preimage = Object.fromEntries(Object.entries(history).filter(([key]) => key !== 'digest'));
  const digest = await crypto.subtle.digest('SHA-256', canonicalBytes(preimage));
  if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== history.digest) fail('digest_mismatch');
  freeze(value);
  return history;
}
