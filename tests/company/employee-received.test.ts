import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import golden from '../../packages/company-contracts/communications/v1/golden/employee-received.json';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import type {EmployeeReceivedContext} from '../../packages/company-contracts/communications/employee-received.ts';

const api = await import('../../packages/company-contracts/communications/employee-received.ts').catch(() => undefined);
const bytes = canonicalBytes;
type MutableData<T> = T extends object ? {-readonly [Key in keyof T]: MutableData<T[Key]>} : T;
const clone = <T>(value: T): MutableData<T> => structuredClone(value) as MutableData<T>;
const hash = (value: unknown) => createHash('sha256').update(bytes(value)).digest('hex');
type Mutable = Record<string, any>;
function seal(value: Mutable): void {const {digest: _digest, ...rest} = value; value.digest = hash(rest);}
const context = (): MutableData<EmployeeReceivedContext> => ({company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
  machine_principal_id: 'machine:E11', journal_owner_id: 'supervisor-E11', recipient: clone(golden.example.envelope.delivery.recipient) as EmployeeReceivedContext['recipient']});
const example = () => clone(golden.example);
const rejection = {name: 'EmployeeReceivedValidationError'};
async function prepared() {return api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), context(), bytes(golden.example.envelope));}

describe('employee received isolated data validation', () => {
  it('exposes received-only capture and validation entrypoints', () => {
    for (const name of ['captureEmployeeReceivedContext', 'validateEmployeeLocalReceipt', 'prepareEmployeeReceivedCommand', 'validateEmployeeDeliveryReceipt']) {
      expect(typeof api?.[name as keyof NonNullable<typeof api>]).toBe('function');
    }
  });
  it('validates the pinned local assertion and actual command without inventing an identity', async () => {
    const result = await prepared();
    expect(result.command).toEqual(golden.example.command);
    expect(result.canonicalJson).toBe(new TextDecoder().decode(bytes(golden.example.command)));
    expect(result.argumentDigest).toBe('60d671ac14fd723535efdb948e687a5000a5d31752d0bc478f7c7833880b9b66');
    expect(result.executable).toBe(false);
    expect(result.envelope).toEqual(golden.example.envelope);
    expect(await api!.validateEmployeeLocalReceipt(bytes(golden.example.local_receipt), context(), bytes(golden.example.envelope))).toEqual(golden.example.local_receipt);
    expect(await api!.validateEmployeeDeliveryReceipt(bytes(golden.example.receipt), context(), result)).toEqual(golden.example.receipt);
    expect(Object.isFrozen(result.command.payload.local_receipt.recipient)).toBe(true);
    expect(Object.isFrozen(result.envelope.message)).toBe(true);
  });
  it('captures a closed full protected context synchronously', () => {
    const expected = context(), captured = api!.captureEmployeeReceivedContext(expected);
    expected.recipient.generation = 2;
    expect(captured.recipient.generation).toBe(1);
    expect(Object.isFrozen(captured.recipient)).toBe(true);
    for (const invalid of [{...context(), permission: 'all'}, {...context(), journal_owner_id: ''},
      {...context(), recipient: {...context().recipient, work_order_id: undefined}},
      {...context(), recipient: {...context().recipient, input_digest: 'bad'}},
      {...context(), machine_principal_id: 'é'.repeat(65)}]) {
      expect(() => api!.captureEmployeeReceivedContext(invalid as unknown as EmployeeReceivedContext)).toThrowError('context');
    }
  });
  it('accepts a current lease renewal while retaining every other full binding', async () => {
    const current = context(); current.recipient.lease_until_utc_epoch_ms += 60000;
    await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), current, bytes(golden.example.envelope))).resolves.toHaveProperty('executable', false);
    await expect(api!.validateEmployeeDeliveryReceipt(bytes(golden.example.receipt), current, await prepared())).resolves.toHaveProperty('stage', 'received');
    for (const key of ['input_digest', 'binding_digest', 'playbook_digest', 'work_order_id', 'attempt_id', 'principal_id', 'machine_id', 'task_id'] as const) {
      const changed = context(); changed.recipient[key] = ['input_digest', 'binding_digest', 'playbook_digest'].includes(key) ? '0'.repeat(64) : 'foreign';
      await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), changed, bytes(golden.example.envelope))).rejects.toMatchObject(rejection);
    }
  });
  it('binds machine principal and journal owner independently of payload claims', async () => {
    for (const changed of [{...context(), machine_principal_id: 'machine:E10'}, {...context(), journal_owner_id: 'received-fixture-supervisor'}]) {
      await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), changed, bytes(golden.example.envelope))).rejects.toMatchObject(rejection);
    }
  });
  it('requires command identity to equal the already supplied local receipt identity', async () => {
    const value = example(); value.command.command_id = '00000000-0000-0000-0000-0000000000a1';
    await expect(api!.prepareEmployeeReceivedCommand(bytes(value.command), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
  });
  it('rejects every contract mutation including schema-valid principal and full reference forgery', async () => {
    for (const mutation of golden.mutations) {
      const value = example() as Mutable, target = value[mutation.source]; let parent = target;
      for (const key of mutation.path.slice(0, -1)) parent = parent[key];
      const key = mutation.path.at(-1)!;
      if ('delete' in mutation) delete parent[key]; else parent[key] = mutation.value;
      if (mutation.export === 'Command') await expect(api!.prepareEmployeeReceivedCommand(bytes(target), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
      else if (mutation.export === 'LocalReceipt') await expect(api!.validateEmployeeLocalReceipt(bytes(target), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
      else await expect(api!.validateEmployeeDeliveryReceipt(bytes(target), context(), await prepared())).rejects.toMatchObject(rejection);
    }
  });
  it('checks local own hash and the hash of the entire envelope including its projection digest', async () => {
    for (const mutate of [(local: Mutable) => {local.digest = '0'.repeat(64);},
      (local: Mutable) => {const {digest: _digest, ...rest} = golden.example.envelope; local.envelope_digest = hash(rest); seal(local);},
      (local: Mutable) => {local.recipient.lease_until_utc_epoch_ms += 1; seal(local);}]) {
      const value = example(); mutate(value.local_receipt);
      await expect(api!.validateEmployeeLocalReceipt(bytes(value.local_receipt), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
    }
  });
  it('validates the entire envelope rather than trusting a matching supplied envelope hash', async () => {
    for (const mutate of [(item: Mutable) => {item.message.body = 'forged';},
      (item: Mutable) => {item.message.recorded_author.principal_id = 'foreign'; seal(item.message);},
      (item: Mutable) => {item.delivery.message_ref.digest = '0'.repeat(64); seal(item.delivery);},
      (item: Mutable) => {item.conversation.scope.id = 'beta'; seal(item.conversation);}]) {
      const value = example(); mutate(value.envelope); seal(value.envelope);
      value.local_receipt.envelope_digest = hash(value.envelope); seal(value.local_receipt);
      await expect(api!.validateEmployeeLocalReceipt(bytes(value.local_receipt), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
    }
  });
  it('rejects full reference changes even after the local assertion is resealed', async () => {
    for (const ref of ['message_ref', 'delivery_ref'] as const) {
      const value = example(); value.local_receipt[ref].digest = '0'.repeat(64); seal(value.local_receipt);
      await expect(api!.validateEmployeeLocalReceipt(bytes(value.local_receipt), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
    }
  });
  it('requires acceptance <= local storage < unchanged expiry and a current lease', async () => {
    for (const time of [golden.example.envelope.message.recorded_at_utc_epoch_ms - 1, golden.example.envelope.delivery.expires_at_utc_epoch_ms]) {
      const value = example(); value.local_receipt.stored_at_utc_epoch_ms = time; seal(value.local_receipt);
      await expect(api!.validateEmployeeLocalReceipt(bytes(value.local_receipt), context(), bytes(value.envelope))).rejects.toMatchObject(rejection);
    }
    const current = context(); current.recipient.lease_until_utc_epoch_ms = golden.example.local_receipt.stored_at_utc_epoch_ms;
    await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), current, bytes(golden.example.envelope))).rejects.toMatchObject(rejection);
  });
  it('checks independently resealed server receipts against exact retained request and local fields', async () => {
    for (const mutate of [(receipt: Mutable) => {receipt.principal_id = 'machine:E10';},
      (receipt: Mutable) => {receipt.argument_digest = '0'.repeat(64);},
      (receipt: Mutable) => {receipt.command_id = '00000000-0000-0000-0000-0000000000a1';},
      (receipt: Mutable) => {receipt.local_receipt.journal_owner_id = 'foreign'; seal(receipt.local_receipt);},
      (receipt: Mutable) => {receipt.recipient.input_digest = '0'.repeat(64);},
      (receipt: Mutable) => {receipt.received_at_utc_epoch_ms -= 1;},
      (receipt: Mutable) => {receipt.received_at_utc_epoch_ms = golden.example.envelope.delivery.expires_at_utc_epoch_ms;},
      (receipt: Mutable) => {receipt.consumed_at = 1793664000000;}]) {
      const value = example(); mutate(value.receipt); seal(value.receipt);
      await expect(api!.validateEmployeeDeliveryReceipt(bytes(value.receipt), context(), await prepared())).rejects.toMatchObject(rejection);
    }
    const value = example(); value.receipt.digest = '0'.repeat(64);
    await expect(api!.validateEmployeeDeliveryReceipt(bytes(value.receipt), context(), await prepared())).rejects.toMatchObject(rejection);
  });
  it('does not trust a forged prepared command or substituted captured envelope', async () => {
    for (const mutate of [(value: Mutable) => {value.argumentDigest = '0'.repeat(64);},
      (value: Mutable) => {value.canonicalJson += ' ';},
      (value: Mutable) => {value.envelope.message.body = 'substituted';},
      (value: Mutable) => {value.executable = true;},
      (value: Mutable) => {value.extra = undefined;}]) {
      const retained = clone(await prepared()); mutate(retained);
      await expect(api!.validateEmployeeDeliveryReceipt(bytes(golden.example.receipt), context(), retained)).rejects.toMatchObject(rejection);
    }
  });
  it('keeps strict frozen C01 lexical rejection on every byte entrypoint', async () => {
    const valid = new TextDecoder().decode(bytes(golden.example.command));
    for (const raw of ['{"schema_version":1,' + valid.slice(1), valid.replace('"schema_version":1', '"schema_version":1e0'),
      valid.replace('"schema_version":1', '"schema_version":-0'), valid.replace('"generation":1', '"generation":9007199254740992'),
      '\ufeff' + valid, valid.replace('machine:E11', '\\ud800'), valid + ' null']) {
      await expect(api!.prepareEmployeeReceivedCommand(new TextEncoder().encode(raw), context(), bytes(golden.example.envelope))).rejects.toMatchObject(rejection);
    }
    await expect(api!.prepareEmployeeReceivedCommand(new Uint8Array([0xff]), context(), bytes(golden.example.envelope))).rejects.toMatchObject(rejection);
    for (const kind of ['envelope', 'local', 'receipt'] as const) {
      const source = kind === 'envelope' ? golden.example.envelope : kind === 'local' ? golden.example.local_receipt : golden.example.receipt;
      const raw = new TextEncoder().encode('{"schema_version":1,' + new TextDecoder().decode(bytes(source)).slice(1));
      const result = kind === 'envelope' ? api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), context(), raw) :
        kind === 'local' ? api!.validateEmployeeLocalReceipt(raw, context(), bytes(golden.example.envelope)) : api!.validateEmployeeDeliveryReceipt(raw, context(), await prepared());
      await expect(result).rejects.toMatchObject({...rejection, code: 'duplicate_key'});
    }
  });
  it('enforces separate raw command and envelope/response byte ceilings', async () => {
    const pad = (value: unknown, length: number) => {const raw = bytes(value), padded = new Uint8Array(length).fill(32); padded.set(raw); return padded;};
    await expect(api!.prepareEmployeeReceivedCommand(pad(golden.example.command, 32768), context(), bytes(golden.example.envelope))).resolves.toHaveProperty('executable', false);
    await expect(api!.prepareEmployeeReceivedCommand(pad(golden.example.command, 32769), context(), bytes(golden.example.envelope))).rejects.toMatchObject({code: 'wire_limit'});
    await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), context(), pad(golden.example.envelope, 262144))).resolves.toHaveProperty('executable', false);
    await expect(api!.prepareEmployeeReceivedCommand(bytes(golden.example.command), context(), pad(golden.example.envelope, 262145))).rejects.toMatchObject({code: 'wire_limit'});
    await expect(api!.validateEmployeeDeliveryReceipt(pad(golden.example.receipt, 262144), context(), await prepared())).resolves.toHaveProperty('stage', 'received');
    await expect(api!.validateEmployeeDeliveryReceipt(pad(golden.example.receipt, 262145), context(), await prepared())).rejects.toMatchObject({code: 'wire_limit'});
  });
  it('captures every caller-owned value before hashing can yield', async () => {
    const value = example(), expected = context(), raw = bytes(value.command), envelopeRaw = bytes(value.envelope);
    const promise = api!.prepareEmployeeReceivedCommand(raw, expected, envelopeRaw);
    raw.fill(0); envelopeRaw.fill(0); expected.recipient.generation = 2;
    const retained = await promise;
    expect(retained.command).toEqual(golden.example.command);
    const receiptRaw = bytes(golden.example.receipt), receiptContext = context(), mutablePrepared = clone(retained);
    const receiptPromise = api!.validateEmployeeDeliveryReceipt(receiptRaw, receiptContext, mutablePrepared);
    receiptRaw.fill(0); receiptContext.machine_principal_id = 'foreign'; mutablePrepared.envelope.delivery.state = 'forged' as never;
    await expect(receiptPromise).resolves.toEqual(golden.example.receipt);
    const localRaw = bytes(value.local_receipt), localEnvelope = bytes(value.envelope), localContext = context();
    const localPromise = api!.validateEmployeeLocalReceipt(localRaw, localContext, localEnvelope);
    localRaw.fill(0); localEnvelope.fill(0); localContext.journal_owner_id = 'foreign';
    await expect(localPromise).resolves.toEqual(golden.example.local_receipt);
  });
});
