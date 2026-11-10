import {describe, expect, it} from 'vitest';
import golden from '../packages/company-contracts/communications/v1/golden/employee-received.json';
import type {EmployeeInformationItem} from '../packages/company-contracts/communications/employee-information';
import type {EmployeeDeliveryReceipt} from '../packages/company-contracts/communications/employee-received';

const api = await import('../apps/web/src/company/communication-model').catch(() => undefined);
const fixtures = await import('../apps/web/src/company/communication-fixture').catch(() => undefined);
const item = () => structuredClone(golden.example.envelope) as unknown as EmployeeInformationItem;
const receipt = () => structuredClone(golden.example.receipt) as EmployeeDeliveryReceipt;

describe('Stage 1 communication projection', () => {
  it('keeps one canonical message referenced by project, task and addressed inbox', async () => {
    const model = await fixtures!.createCommunicationFixture();
    expect(model.source).toBe('synthetic_fixture');
    expect(model.proofLabel).toContain('Synthetic');
    expect(model.messages).toHaveLength(1);
    const message = model.messages[0];
    expect(message.id).toBe(golden.example.envelope.message.id);
    expect(model.timeline).toEqual([message.id]);
    expect(model.tasks[0].messageIds).toEqual([message.id]);
    expect(model.inboxes).toEqual([{employeeId: message.recipient, messageIds: [message.id]}]);
    expect(message.body).toBe(golden.example.envelope.message.body);
    expect(message.receivedAt).toBe(golden.example.receipt.received_at_utc_epoch_ms);
    expect(message.consumedAt).toBeNull();
    expect(model.decision?.acceptedDecision).toBeNull();
    expect(model.decision?.status).toBe('unavailable');
  });
  it('never promotes an accepted delivery to received or consumed from viewing it', () => {
    const model = api!.projectCommunicationRecords('leo-company', 'alpha', [item()], []);
    expect(model.messages[0].acceptedAt).toBe(golden.example.envelope.receipt.recorded_at_utc_epoch_ms);
    expect(model.messages[0].receivedAt).toBeNull();
    expect(model.messages[0].consumedAt).toBeNull();
    expect(model.messages[0].receivedReceiptId).toBeNull();
  });
  it('deduplicates an identical canonical message and rejects a conflicting duplicate', () => {
    expect(api!.projectCommunicationRecords('leo-company', 'alpha', [item(), item()], []).messages).toHaveLength(1);
    const changed = structuredClone(item());
    (changed.message as {body: string}).body = 'Different content';
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [item(), changed], [])).toThrow();
  });
  it('rejects cross-project records and foreign or mismatched received assertions', () => {
    expect(() => api!.projectCommunicationRecords('leo-company', 'beta', [item()], [])).toThrow();
    expect(() => api!.projectCommunicationRecords('other-company', 'alpha', [item()], [])).toThrow();
    const foreign = structuredClone(receipt());
    (foreign.scope as {id: string}).id = 'beta';
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [item()], [foreign])).toThrow();
    const changed = structuredClone(receipt());
    (changed.message_ref as {digest: string}).digest = '0'.repeat(64);
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [item()], [changed])).toThrow();
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [], [receipt()])).toThrow();
  });
  it('requires the received assertion to retain its exact accepted recipient and delivery', () => {
    const changed = structuredClone(receipt());
    (changed.recipient as {employee_id: string}).employee_id = 'E12';
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [item()], [changed])).toThrow();
    const wrongDelivery = structuredClone(receipt());
    (wrongDelivery.delivery_ref as {id: string}).id = '00000000-0000-4000-8000-000000000001';
    expect(() => api!.projectCommunicationRecords('leo-company', 'alpha', [item()], [wrongDelivery])).toThrow();
  });
});
