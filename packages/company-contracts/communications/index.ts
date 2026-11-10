import {canonicalBytes, CommunicationContractError, decodeBoundedJson, type JsonValue} from './json.ts';
import Ajv2020, {type AnySchemaObject} from 'ajv/dist/2020.js';
import discussionSchema from './v1/discussion-command.schema.json';

// File-contract pin only; no route, authorization, receipt or runtime negotiation.
export const COMMUNICATION_CONTRACT_PIN = Object.freeze({
  contract: 'maritime-communications',
  version: '1.0.0-candidate.1',
  backendCheckpoint: '1214c9dcaf4ff2a2bc31e08afba09aadc30f10de',
  manifestSHA256: '4762203741d169461130796dab86e39adb5effa1e6c52bf77e837ba41a5e1492',
  executable: false,
});

export {canonicalBytes, CommunicationContractError};
const encoder = new TextEncoder();
const fail = (code: 'fields' | 'text_limit' | 'audience'): never => {throw new CommunicationContractError(code);};
/** Frozen command boundary; read outputs use a separate entrypoint. */
export function decodeJson(raw: Uint8Array): JsonValue {return decodeBoundedJson(raw, 32768);}

type TaskScope = {kind: 'project'; id: string} | {kind: 'company_ops'; id: 'company-ops'};
interface DiscussionCommand {
  schema_version: 1; command_id: string; action: 'message.send'; scope: TaskScope;
  payload: {
    conversation_id: string; kind: 'question' | 'answer' | 'handoff' | 'review_request' | 'blocker' | 'proposal' | 'note';
    task_id: string; attempt_id: string; summary: string; body: string;
    required_action: string | null; response_required: boolean;
    recipient_employee_ids: string[]; observer_employee_ids: string[];
    artifact_refs: []; reply_to_message_id: string | null;
  };
}
export interface ValidatedDiscussionCommand {
  readonly commandId: string; readonly action: 'message.send'; readonly scope: Readonly<TaskScope>;
  readonly canonicalJson: string; readonly argumentDigest: string; readonly executable: false;
}
const shape = new Ajv2020({strict: true, allErrors: false}).compile<DiscussionCommand>(discussionSchema as AnySchemaObject);

/** Validated intent data only. No authenticated actor, current attempt or admission. */
export async function validateDiscussionCommand(raw: Uint8Array): Promise<ValidatedDiscussionCommand> {
  const value = decodeJson(raw);
  if (!shape(value)) fail('fields');
  const command = value as unknown as DiscussionCommand;
  const payload = command.payload;
  for (const [field, maximum] of [['task_id', 128], ['attempt_id', 128], ['summary', 1024], ['body', 8192], ['required_action', 1024]] as const) {
    const text = payload[field];
    if (text !== null && encoder.encode(text).byteLength > maximum) fail('text_limit');
  }
  const audience = [...payload.recipient_employee_ids, ...payload.observer_employee_ids];
  if (audience.length < 1 || audience.length > 8 || new Set(audience).size !== audience.length) fail('audience');
  const {command_id: commandId, ...argumentsOnly} = command;
  const digest = await crypto.subtle.digest('SHA-256', canonicalBytes(argumentsOnly));
  return Object.freeze({
    commandId, action: command.action, scope: Object.freeze({...command.scope}),
    canonicalJson: new TextDecoder().decode(canonicalBytes(command)),
    argumentDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    executable: false,
  });
}
