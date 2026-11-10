import type {EmployeeInformationItem} from '../../../../packages/company-contracts/communications/employee-information';
import type {EmployeeDeliveryReceipt} from '../../../../packages/company-contracts/communications/employee-received';
import {canonicalBytes} from '../../../../packages/company-contracts/communications/json';

export interface CommunicationMessage {
  readonly id: string; readonly taskId: string; readonly conversationId: string;
  readonly summary: string; readonly body: string; readonly sender: string; readonly recipient: string;
  readonly acceptedAt: number; readonly receivedAt: number | null; readonly consumedAt: null;
  readonly deliveryId: string; readonly receivedReceiptId: string | null;
  readonly messageRef: EmployeeInformationItem['receipt']['message_ref'];
  readonly conversationRef: EmployeeInformationItem['receipt']['conversation_ref'];
  readonly deliveryRef: EmployeeInformationItem['receipt']['delivery_ref'];
}
export interface CommunicationReadModel {
  readonly companyId: string; readonly projectId: string; readonly projectName: string;
  readonly source: 'synthetic_fixture' | 'authorized_host'; readonly proofLabel: string;
  readonly messages: readonly CommunicationMessage[]; readonly timeline: readonly string[];
  readonly tasks: readonly {readonly id: string; readonly title: string; readonly messageIds: readonly string[]}[];
  readonly inboxes: readonly {readonly employeeId: string; readonly messageIds: readonly string[]}[];
  readonly blockers: readonly string[];
  readonly decision: null | Readonly<{title: string; status: 'unavailable'; detail: string;
    acceptedDecision: null; decider: null; evidence: readonly []}>;
}
const canonical = (value: unknown) => new TextDecoder().decode(canonicalBytes(value));
const equal = (left: unknown, right: unknown) => canonical(left) === canonical(right);
function fail(): never {throw new Error('Communication records do not match this project projection.');}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}

/** Inputs must already pass their canonical client validators. This joins records, never grants access. */
export function projectCommunicationRecords(companyId: string, projectId: string,
  items: readonly EmployeeInformationItem[], receipts: readonly EmployeeDeliveryReceipt[],
  source: CommunicationReadModel['source'] = 'authorized_host'): CommunicationReadModel {
  const scope = {kind: 'project', id: projectId};
  const checkScope = (value: {company_id: string; scope: unknown}) => {
    if (value.company_id !== companyId || !equal(value.scope, scope)) fail();
  };
  const unique = new Map<string, EmployeeInformationItem>();
  for (const item of items) {
    for (const record of [item, item.message, item.conversation, item.delivery, item.receipt, item.event]) checkScope(record);
    if (item.message.id !== item.receipt.message_ref.id || item.delivery.id !== item.receipt.delivery_ref.id ||
      item.message.digest !== item.receipt.message_ref.digest || !equal(item.message.conversation_ref, item.receipt.conversation_ref)) fail();
    const previous = unique.get(item.message.id);
    if (previous && !equal(previous, item)) fail();
    unique.set(item.message.id, item);
  }
  const received = new Map<string, EmployeeDeliveryReceipt>();
  for (const receipt of receipts) {
    checkScope(receipt);
    const item = unique.get(receipt.message_ref.id);
    if (!item || !equal(receipt.message_ref, item.receipt.message_ref) || !equal(receipt.delivery_ref, item.receipt.delivery_ref) ||
      !equal(receipt.recipient, item.delivery.recipient) || !equal(receipt.local_receipt.recipient, item.delivery.recipient) ||
      !equal(receipt.local_receipt.message_ref, item.receipt.message_ref) || !equal(receipt.local_receipt.delivery_ref, item.receipt.delivery_ref) ||
      receipt.received_at_utc_epoch_ms < receipt.local_receipt.stored_at_utc_epoch_ms ||
      receipt.local_receipt.stored_at_utc_epoch_ms < item.receipt.recorded_at_utc_epoch_ms ||
      receipt.received_at_utc_epoch_ms >= item.receipt.expires_at_utc_epoch_ms) fail();
    const previous = received.get(receipt.message_ref.id);
    if (previous && !equal(previous, receipt)) fail();
    received.set(receipt.message_ref.id, receipt);
  }
  const messages: CommunicationMessage[] = [...unique.values()].map(item => ({
    id: item.message.id, taskId: item.conversation.task_ref.id, conversationId: item.conversation.id,
    summary: item.message.summary, body: item.message.body,
    sender: item.receipt.sender.employee_id, recipient: item.delivery.recipient.employee_id,
    acceptedAt: item.receipt.recorded_at_utc_epoch_ms,
    receivedAt: received.get(item.message.id)?.received_at_utc_epoch_ms ?? null, consumedAt: null,
    deliveryId: item.delivery.id, receivedReceiptId: received.get(item.message.id)?.id ?? null,
    messageRef: structuredClone(item.receipt.message_ref), conversationRef: structuredClone(item.receipt.conversation_ref),
    deliveryRef: structuredClone(item.receipt.delivery_ref),
  })).sort((a, b) => b.acceptedAt - a.acceptedAt || a.id.localeCompare(b.id));
  const taskIds = [...new Set(messages.map(message => message.taskId))];
  const recipientIds = [...new Set(messages.map(message => message.recipient))];
  return freeze({companyId, projectId, projectName: projectId, source,
    proofLabel: source === 'synthetic_fixture' ? 'Synthetic fixture — no live employees or model activity.' : 'Authorized host projection — record provenance is not current employee activity.',
    messages, timeline: messages.map(message => message.id),
    tasks: taskIds.map(id => ({id, title: id, messageIds: messages.filter(message => message.taskId === id).map(message => message.id)})),
    inboxes: recipientIds.map(employeeId => ({employeeId, messageIds: messages.filter(message => message.recipient === employeeId).map(message => message.id)})),
    blockers: [], decision: null,
  });
}
