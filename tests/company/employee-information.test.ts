import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import golden from '../../packages/company-contracts/communications/v1/golden/employee-information.json';
import {canonicalBytes, validateDiscussionCommand} from '../../packages/company-contracts/communications/index.ts';

// Dynamic loading lets RED establish the missing public behavior as an assertion.
const api = await import('../../packages/company-contracts/communications/employee-information.ts').catch(() => undefined);
const bytes = (value: unknown) => canonicalBytes(value);
const copy = <T>(value: T): T => structuredClone(value);
const core = (employee: 'E10' | 'E11') => ({
  principal_id: `employee:${employee}`, employee_id: employee,
  machine_id: `synthetic-machine-${employee}`, generation: 1,
  task_id: `task-${employee}`, attempt_id: employee === 'E10' ? '00000000000000000000000000000007' : '0000000000000000000000000000000a',
  work_order_id: `order-${employee}`,
});
const sendContext = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}, sender: core('E10'), recipient: core('E11')});
const inboxContext = () => ({company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}, recipient: core('E11')});
type Mutable = Record<string, any>;
function ownDigest(value: Mutable): void {
  const {digest: _digest, ...rest} = value;
  value.digest = createHash('sha256').update(bytes(rest)).digest('hex');
}
function sealItem(item: Mutable): void {
  ownDigest(item.conversation);
  item.message.conversation_ref.digest = item.conversation.digest;
  ownDigest(item.message);
  item.delivery.message_ref.digest = item.message.digest;
  ownDigest(item.delivery);
  item.event.conversation_ref.digest = item.conversation.digest;
  item.event.message_ref.digest = item.message.digest;
  item.event.delivery_ref.digest = item.delivery.digest;
  ownDigest(item.event);
  item.receipt.conversation_ref.digest = item.conversation.digest;
  item.receipt.message_ref.digest = item.message.digest;
  item.receipt.delivery_ref.digest = item.delivery.digest;
  item.receipt.event_ref.digest = item.event.digest;
  ownDigest(item.receipt); ownDigest(item);
}
function sealInbox(inbox: Mutable): void {for (const item of inbox.items) sealItem(item); ownDigest(inbox);}
const rejectInbox = async (value: unknown, code?: string) => {
  const promise = api!.validateEmployeeInformationInbox(bytes(value), inboxContext(), 20);
  if (code) await expect(promise).rejects.toMatchObject({name: 'EmployeeInformationValidationError', code, message: code});
  else await expect(promise).rejects.toHaveProperty('name', 'EmployeeInformationValidationError');
};

describe('employee information strict data boundary', () => {
  it('exports the separate information-only entrypoints', () => {
    for (const name of ['captureEmployeeSendContext', 'captureEmployeeInboxContext', 'prepareEmployeeInformationCommand', 'validateEmployeeInformationReceipt', 'validateEmployeeInformationInbox']) {
      expect(typeof api?.[name as keyof NonNullable<typeof api>]).toBe('function');
    }
  });
  it('matches frozen C01 argument digests while preserving executable false', async () => {
    for (const example of golden.examples) {
      const prepared = await api!.prepareEmployeeInformationCommand(bytes(example.command), sendContext());
      expect(prepared.command).toEqual(example.command);
      expect(prepared.canonicalJson).toBe(new TextDecoder().decode(bytes(example.command)));
      expect(prepared.argumentDigest).toBe(example.receipt.argument_digest);
      expect(prepared.argumentDigest).toBe((await validateDiscussionCommand(bytes(example.command))).argumentDigest);
      expect(prepared.executable).toBe(false);
      const receipt = await api!.validateEmployeeInformationReceipt(bytes(example.receipt), sendContext(), prepared);
      expect(receipt).toEqual(example.receipt);
      expect(Object.isFrozen(receipt.sender)).toBe(true);
    }
  });
  it('validates both historical revisions without collapsing conversation identities', async () => {
    const result = await api!.validateEmployeeInformationInbox(bytes(golden.inbox), inboxContext(), 20);
    expect(result).toEqual(golden.inbox);
    expect(result.items.map(item => item.conversation.revision)).toEqual([2, 1]);
    expect(Object.isFrozen(result.items[0].receipt.recipient)).toBe(true);
    expect(await api!.validateEmployeeInformationInbox(bytes(golden.empty_inbox), inboxContext(), 20)).toEqual(golden.empty_inbox);
  });
  it('captures independent complete core bindings synchronously without actor metadata', () => {
    const original = sendContext(); const context = api!.captureEmployeeSendContext(original);
    original.sender.task_id = 'later'; original.scope.id = 'beta';
    expect(context.sender.task_id).toBe('task-E10'); expect(context.scope.id).toBe('alpha');
    expect(Object.keys(context.sender).sort()).toEqual(Object.keys(core('E10')).sort());
    expect(Object.isFrozen(context.sender)).toBe(true);
    expect(api!.captureEmployeeInboxContext(inboxContext()).recipient).toEqual(core('E11'));
  });
  it('captures command bytes and context before the first hash await', async () => {
    const raw = bytes(golden.examples[0].command), context = sendContext();
    const pending = api!.prepareEmployeeInformationCommand(raw, context);
    raw.fill(0); context.sender.task_id = 'changed'; context.recipient.employee_id = 'E10';
    expect((await pending).argumentDigest).toBe(golden.examples[0].receipt.argument_digest);
  });
  it('captures response bytes and contexts before the first hash await', async () => {
    const raw = bytes(golden.inbox), context = inboxContext();
    const pending = api!.validateEmployeeInformationInbox(raw, context, 20);
    raw.fill(0); context.recipient.generation = 99;
    expect(await pending).toEqual(golden.inbox);
  });
  it.each(['principal_id', 'employee_id', 'machine_id', 'generation', 'task_id', 'attempt_id', 'work_order_id'] as const)('rejects missing independent %s', field => {
    const value: Mutable = sendContext(); delete value.sender[field];
    expect(() => api!.captureEmployeeSendContext(value as ReturnType<typeof sendContext>)).toThrow('context');
  });
  it('rejects accessor contexts without invoking their getter', () => {
    const context = sendContext(); let reads = 0;
    Object.defineProperty(context.sender, 'task_id', {enumerable: true, get() {reads++; return 'task-E10';}});
    expect(() => api!.captureEmployeeSendContext(context)).toThrow('context'); expect(reads).toBe(0);
  });
  it('accepts opaque non-UUID task and attempt identifiers at the UTF8 boundary', async () => {
    const command = copy(golden.examples[0].command), context = sendContext();
    command.payload.task_id = context.sender.task_id = '任务'.repeat(21);
    command.payload.attempt_id = context.sender.attempt_id = 'opaque-attempt';
    expect((await api!.prepareEmployeeInformationCommand(bytes(command), context)).command.payload.attempt_id).toBe('opaque-attempt');
    context.sender.task_id = 'é'.repeat(65);
    expect(() => api!.captureEmployeeSendContext(context)).toThrow('context');
  });
  it.each(['task_id', 'attempt_id'] as const)('rejects a command with a different retained %s', async field => {
    const command = copy(golden.examples[0].command); command.payload[field] = 'other';
    await expect(api!.prepareEmployeeInformationCommand(bytes(command), sendContext())).rejects.toHaveProperty('code', 'request_mismatch');
  });
  it('rejects a self recipient and non-note commands', async () => {
    const context = sendContext(); context.recipient = core('E10');
    await expect(api!.prepareEmployeeInformationCommand(bytes(golden.examples[0].command), context)).rejects.toHaveProperty('code', 'context');
    const command = copy(golden.examples[0].command); command.payload.kind = 'question';
    await expect(api!.prepareEmployeeInformationCommand(bytes(command), sendContext())).rejects.toHaveProperty('code', 'fields');
  });
  it.each(golden.byte_recipes)('enforces frozen raw and UTF8 byte recipe $name', async recipe => {
    const command = copy(golden.examples[0].command);
    command.payload[recipe.field as 'summary' | 'body'] = recipe.repeat.repeat(recipe.count);
    const result = api!.prepareEmployeeInformationCommand(bytes(command), sendContext());
    if (recipe.codec_valid) expect((await result).argumentDigest).toMatch(/^[a-f0-9]{64}$/);
    else await expect(result).rejects.toHaveProperty('name', 'EmployeeInformationValidationError');
  });
  it.each([
    ['duplicate_key', '{"schema_version":1,"schema_version":1}'],
    ['integer_token', '{"n":1e0}'], ['integer_token', '{"n":-0}'],
    ['invalid_unicode', '{"n":"\\ud800"}'],
  ])('preserves strict C01 raw rejection %s', async (code, raw) => {
    await expect(api!.prepareEmployeeInformationCommand(new TextEncoder().encode(raw), sendContext())).rejects.toMatchObject({code, message: code});
  });
  it('rejects raw response bytes above the separate 262144 boundary', async () => {
    const raw = new TextEncoder().encode(JSON.stringify(golden.empty_inbox) + ' '.repeat(262144));
    await expect(api!.validateEmployeeInformationInbox(raw, inboxContext(), 20)).rejects.toHaveProperty('code', 'wire_limit');
  });
  it('binds send receipts to the actual retained command, never a reconstructed response', async () => {
    const prepared = await api!.prepareEmployeeInformationCommand(bytes(golden.examples[0].command), sendContext());
    await expect(api!.validateEmployeeInformationReceipt(bytes(golden.examples[1].receipt), sendContext(), prepared)).rejects.toHaveProperty('code', 'request_mismatch');
    const forged = {...prepared, argumentDigest: golden.examples[1].receipt.argument_digest};
    await expect(api!.validateEmployeeInformationReceipt(bytes(golden.examples[0].receipt), sendContext(), forged)).rejects.toHaveProperty('code', 'request_mismatch');
  });
  it('rejects a sender core generation mismatch even with a valid receipt hash', async () => {
    const prepared = await api!.prepareEmployeeInformationCommand(bytes(golden.examples[0].command), sendContext());
    const receipt = copy(golden.examples[0].receipt); receipt.sender.generation++; ownDigest(receipt);
    await expect(api!.validateEmployeeInformationReceipt(bytes(receipt), sendContext(), prepared)).rejects.toHaveProperty('code', 'actor_mismatch');
  });
  it('requires message revision one in a standalone send receipt', async () => {
    const prepared = await api!.prepareEmployeeInformationCommand(bytes(golden.examples[0].command), sendContext());
    const receipt = copy(golden.examples[0].receipt); receipt.message_ref.revision = 2; ownDigest(receipt);
    await expect(api!.validateEmployeeInformationReceipt(bytes(receipt), sendContext(), prepared)).rejects.toHaveProperty('code', 'reference_mismatch');
  });
  it('captures all mutable receipt validation inputs before hashing', async () => {
    const prepared = copy(await api!.prepareEmployeeInformationCommand(bytes(golden.examples[0].command), sendContext())) as Mutable;
    const context = sendContext(), raw = bytes(golden.examples[0].receipt);
    const pending = api!.validateEmployeeInformationReceipt(raw, context, prepared as Awaited<ReturnType<NonNullable<typeof api>['prepareEmployeeInformationCommand']>>);
    prepared.command.payload.body = 'changed'; prepared.argumentDigest = '0'.repeat(64); raw.fill(0); context.sender.generation++;
    expect(await pending).toEqual(golden.examples[0].receipt);
  });
  it('binds the inbox limit independently and rejects item count overflow', async () => {
    await expect(api!.validateEmployeeInformationInbox(bytes(golden.inbox), inboxContext(), 1)).rejects.toHaveProperty('code', 'limit_mismatch');
    const inbox = copy(golden.inbox); inbox.requested_limit = 1; ownDigest(inbox);
    await expect(api!.validateEmployeeInformationInbox(bytes(inbox), inboxContext(), 1)).rejects.toHaveProperty('code', 'limit_mismatch');
  });
  it('requires item_limit coverage to actually reach the independent item limit', async () => {
    const inbox = copy(golden.inbox); inbox.coverage = {status: 'partial', truncation: 'item_limit', total_count: null}; ownDigest(inbox);
    await rejectInbox(inbox, 'limit_mismatch');
  });
  it('accepts only current page recipient lease renewal among Actor changes', async () => {
    const inbox = copy(golden.inbox); inbox.recipient.lease_until_utc_epoch_ms += 60000; ownDigest(inbox);
    expect((await api!.validateEmployeeInformationInbox(bytes(inbox), inboxContext(), 20)).recipient.lease_until_utc_epoch_ms).toBe(inbox.recipient.lease_until_utc_epoch_ms);
    inbox.recipient.input_digest = '0'.repeat(64); ownDigest(inbox);
    await rejectInbox(inbox, 'actor_mismatch');
  });
  it('does not allow the lease renewal exception between accepted snapshots', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].delivery.recipient.lease_until_utc_epoch_ms++; sealInbox(inbox);
    await rejectInbox(inbox, 'actor_mismatch');
  });
  it.each(['input_digest', 'binding_digest', 'playbook_digest'] as const)('crosschecks full accepted actor %s', async field => {
    const inbox = copy(golden.inbox); inbox.items[0].event.sender[field] = '0'.repeat(64); sealInbox(inbox);
    await rejectInbox(inbox, 'actor_mismatch');
  });
  it('rejects a historical reference substituted with current head metadata', async () => {
    const inbox = copy(golden.inbox);
    inbox.items[1].receipt.conversation_ref = copy(inbox.items[0].receipt.conversation_ref);
    ownDigest(inbox.items[1].receipt); ownDigest(inbox.items[1]); ownDigest(inbox);
    await rejectInbox(inbox, 'reference_mismatch');
  });
  it('preserves immutable sender bindings across this inbox same-room revisions', async () => {
    const inbox = copy(golden.inbox);
    inbox.items[1].receipt.sender.input_digest = '0'.repeat(64);
    inbox.items[1].event.sender.input_digest = '0'.repeat(64);
    sealInbox(inbox); await rejectInbox(inbox, 'actor_mismatch');
  });
  it('allows accepted sender lease renewal across this inbox same-room revisions', async () => {
    const inbox = copy(golden.inbox);
    inbox.items[1].receipt.sender.lease_until_utc_epoch_ms += 60000;
    inbox.items[1].event.sender.lease_until_utc_epoch_ms += 60000;
    sealInbox(inbox);
    expect(await api!.validateEmployeeInformationInbox(bytes(inbox), inboxContext(), 20)).toEqual(inbox);
  });
  it('rejects two distinct messages claiming the same conversation revision', async () => {
    const inbox = copy(golden.inbox), item = inbox.items[1];
    item.conversation.revision = 2; item.message.conversation_sequence = 2;
    for (const ref of [item.message.conversation_ref, item.event.conversation_ref, item.receipt.conversation_ref]) ref.revision = 2;
    sealInbox(inbox); await rejectInbox(inbox, 'reference_mismatch');
  });
  it.each(['conversation', 'message', 'delivery', 'event', 'receipt'] as const)('checks the nested %s own hash even after outer resealing', async field => {
    const inbox = copy(golden.inbox); inbox.items[0][field].digest = '0'.repeat(64);
    ownDigest(inbox.items[0]); ownDigest(inbox);
    await rejectInbox(inbox);
  });
  it('checks item and whole inbox own hashes', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].digest = '0'.repeat(64); ownDigest(inbox);
    await rejectInbox(inbox, 'digest_mismatch');
    await rejectInbox({...golden.inbox, digest: '0'.repeat(64)}, 'digest_mismatch');
  });
  it('crosschecks all reference scopes even when independently hashed', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].message.recorded_author.scope.id = 'beta'; sealInbox(inbox);
    await rejectInbox(inbox, 'scope_mismatch');
  });
  it('requires actual task and work order unavailable references', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].conversation.task_ref.id = 'other-task'; sealInbox(inbox);
    await rejectInbox(inbox, 'reference_mismatch');
  });
  it('checks recorded author, correlation and conversation sequence relationships', async () => {
    for (const field of ['author', 'correlation', 'sequence']) {
      const inbox = copy(golden.inbox);
      if (field === 'author') inbox.items[0].message.recorded_author.principal_id = 'other';
      if (field === 'correlation') inbox.items[0].message.correlation_ref.id = inbox.items[1].message.correlation_ref.id;
      if (field === 'sequence') inbox.items[0].message.conversation_sequence++;
      sealInbox(inbox); await rejectInbox(inbox);
    }
  });
  it('requires equal accepted timestamps and exact fixed minimum expiry', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].event.recorded_at_utc_epoch_ms++; sealInbox(inbox);
    await rejectInbox(inbox, 'timestamp_mismatch');
    const early = copy(golden.inbox);
    for (const record of [early.items[0].receipt, early.items[0].event, early.items[0].delivery]) record.expires_at_utc_epoch_ms--;
    sealInbox(early); await rejectInbox(early, 'expiry_mismatch');
  });
  it('hides no expired item inside a valid inbox wrapper', async () => {
    const inbox = copy(golden.inbox); inbox.observed_at_utc_epoch_ms = inbox.items[0].delivery.expires_at_utc_epoch_ms; ownDigest(inbox);
    await rejectInbox(inbox, 'expiry_mismatch');
  });
  it('permits recipient sequence gaps while rejecting duplicate or ascending sequence', async () => {
    const inbox = copy(golden.inbox); inbox.items[0].delivery.inbox_sequence = 9; sealInbox(inbox);
    expect((await api!.validateEmployeeInformationInbox(bytes(inbox), inboxContext(), 20)).items[0].delivery.inbox_sequence).toBe(9);
    inbox.items[1].delivery.inbox_sequence = 9; sealInbox(inbox); await rejectInbox(inbox, 'sequence_mismatch');
    inbox.items[1].delivery.inbox_sequence = 10; sealInbox(inbox); await rejectInbox(inbox, 'sequence_mismatch');
  });
  it('requires distinct message, delivery, event and receipt identities', async () => {
    const inbox = copy(golden.inbox); inbox.items[1].receipt.id = inbox.items[0].receipt.id; sealInbox(inbox);
    await rejectInbox(inbox, 'duplicate_identity');
  });
  it('rejects reflected metadata and dishonest coverage', async () => {
    await rejectInbox({...golden.inbox, protected: 'private'}, 'fields');
    const inbox = copy(golden.inbox); inbox.coverage.status = 'partial'; ownDigest(inbox);
    await rejectInbox(inbox, 'fields');
  });
});
