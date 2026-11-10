import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-candidate.1/examples.json';
import manifest from '../../packages/company-contracts/communications/owner-discussion-candidate.1/manifest.json';

type Data = Record<string, any>;
const load = () => import('../../packages/company-contracts/communications/owner-discussion.ts');
const fixtures = examples.examples as Data[];
const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const ownDigest = (value: Data) => hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'))));
const clone = (value: Data) => structuredClone(value);
const encoder = new TextEncoder();
function rehash(value: Data) {
  value.conversation.digest = ownDigest(value.conversation);
  value.message.digest = ownDigest(value.message);
  value.digest = ownDigest(value);
}
function bindRefs(value: Data) {
  value.conversation.digest = ownDigest(value.conversation);
  value.receipt.conversation_ref.digest = value.conversation.digest;
  value.receipt.conversation_ref.revision = value.conversation.revision;
  value.message.conversation_ref = clone(value.receipt.conversation_ref);
  value.message.digest = ownDigest(value.message);
  value.receipt.message_ref.digest = value.message.digest;
  value.digest = ownDigest(value);
}
function fixedError(error: unknown) {
  expect(error).toMatchObject({name: 'OwnerDiscussionValidationError', code: expect.any(String)});
  expect(String(error)).not.toContain('private');
}

it('pins exact raw producer assets and frozen imports', async () => {
  const {OWNER_DISCUSSION_PIN: pin} = await load();
  expect(pin).toMatchObject({contract: manifest.contract, version: manifest.version, backendCheckpoint: '111214f5f535f982799fe9f1c178887a7b1dd385', executable: false});
  const base = new URL('../../packages/company-contracts/communications/owner-discussion-candidate.1/', import.meta.url);
  expect(hash(readFileSync(new URL('manifest.json', base)))).toBe(pin.manifestSHA256);
  expect(pin.schemaSHA256).toBe(manifest.assets[0].sha256);
  expect(pin.examplesSHA256).toBe(manifest.assets[1].sha256);
  for (const asset of [...manifest.assets, ...manifest.frozen_imports]) {
    const url = new URL('../../packages/company-contracts/' + asset.path.replace('contracts/', ''), import.meta.url);
    expect(hash(readFileSync(url))).toBe(asset.sha256);
  }
});
for (const fixture of fixtures) it(`validates complete historical producer example ${fixture.name}`, async () => {
  const api = await load(), command = api.parseOwnerDiscussionCommand(canonicalBytes(fixture.command));
  expect(await api.ownerDiscussionRequestDigest(command, context)).toBe(fixture.receipt.request_digest);
  const receipt = await api.validateOwnerDiscussionReceipt(canonicalBytes(fixture.receipt), context, command);
  const result = await api.validateOwnerDiscussionReadBack(canonicalBytes(fixture.read_back), context, command, receipt);
  expect(canonicalBytes(result)).toEqual(canonicalBytes(fixture.read_back));
  expect(Object.isFrozen(command)).toBe(true);
  for (const value of [receipt, receipt.conversation_ref.scope, result, result.conversation, result.message.recorded_author, result.receipt.message_ref]) expect(Object.isFrozen(value)).toBe(true);
});
it.each(examples.byte_recipes)('enforces decoded and raw byte recipe $field/$count', async recipe => {
  const api = await load(), command = clone(fixtures[0].command);
  command[recipe.field] = recipe.repeat.repeat(recipe.count);
  const parse = () => api.parseOwnerDiscussionCommand(canonicalBytes(command));
  if (recipe.command === 'accept') expect(parse).not.toThrow(); else expect(parse).toThrow();
});
it('keeps command32768 and output262144 boundaries distinct', async () => {
  const api = await load(), fixture = fixtures[0], raw = canonicalBytes(fixture.command);
  const padded = (value: Uint8Array, cap: number) => Buffer.concat([value, Buffer.alloc(cap - value.byteLength, 32)]);
  expect(() => api.parseOwnerDiscussionCommand(padded(raw, 32768))).not.toThrow();
  expect(() => api.parseOwnerDiscussionCommand(padded(raw, 32769))).toThrow('wire_limit');
  const command = api.parseOwnerDiscussionCommand(raw), receiptRaw = canonicalBytes(fixture.receipt);
  const receipt = await api.validateOwnerDiscussionReceipt(padded(receiptRaw, 262144), context, command);
  await expect(api.validateOwnerDiscussionReceipt(padded(receiptRaw, 262145), context, command)).rejects.toThrow('wire_limit');
  await expect(api.validateOwnerDiscussionReadBack(padded(canonicalBytes(fixture.read_back), 262144), context, command, receipt)).resolves.toBeDefined();
  await expect(api.validateOwnerDiscussionReadBack(padded(canonicalBytes(fixture.read_back), 262145), context, command, receipt)).rejects.toThrow('wire_limit');
});
it.each([
  ['duplicate', '{"schema_version":1,"schema_version":1}'], ['bom', '\ufeff{}'],
  ['surrogate', '{"body":"\\ud800"}'], ['float', '{"schema_version":1.0}'],
  ['exponent', '{"schema_version":1e0}'], ['negative zero', '{"schema_version":-0}'],
  ['unsafe integer', '{"schema_version":9007199254740992}'], ['trailing', '{}x'],
])('rejects strict codec %s with bounded diagnostics', async (_name, raw) => {
  const api = await load();
  try {api.parseOwnerDiscussionCommand(encoder.encode(raw)); throw new Error('accepted');} catch (error) {fixedError(error);}
});
it('rejects malformed UTF8 and capabilities in all closed envelopes', async () => {
  const api = await load(), fixture = fixtures[0], command = api.parseOwnerDiscussionCommand(canonicalBytes(fixture.command));
  expect(() => api.parseOwnerDiscussionCommand(new Uint8Array([0xc0, 0xaf]))).toThrow('invalid_utf8');
  for (const field of ['actor', 'audience', 'company_id', 'scope', 'approval', 'token', 'permission', 'head', 'cursor']) {
    expect(() => api.parseOwnerDiscussionCommand(canonicalBytes({...fixture.command, [field]: 'private'}))).toThrow('fields');
    await expect(api.validateOwnerDiscussionReceipt(canonicalBytes({...fixture.receipt, [field]: 'private'}), context, command)).rejects.toThrow(field === 'company_id' ? 'company_mismatch' : 'fields');
    await expect(api.validateOwnerDiscussionReadBack(canonicalBytes({...fixture.read_back, [field]: 'private'}), context, command, fixture.receipt)).rejects.toThrow(field === 'company_id' ? 'company_mismatch' : 'fields');
  }
});
it('requires independently valid project context and command for request digests', async () => {
  const api = await load(), command = fixtures[0].command;
  for (const expected of [{...context, scope: {kind: 'company_ops', id: 'company-ops'}}, {...context, scope: {kind: 'project', id: 'company-ops'}}, {...context, scope: {kind: 'project', id: 'Alpha'}}, {...context, scope: {kind: 'project', id: '%61lpha'}}, {...context, token: 'private'}]) {
    await expect(api.ownerDiscussionRequestDigest(command as any, expected as any)).rejects.toThrow('read_context');
  }
  await expect(api.ownerDiscussionRequestDigest({...command, actor: 'private'} as any, context)).rejects.toThrow('fields');
});
it.each(['command_id', 'action', 'company_id', 'scope', 'request_digest', 'ref_company', 'ref_scope', 'message_revision', 'unavailable'])('rejects receipt mismatch %s', async key => {
  const api = await load(), fixture = fixtures[0], receipt = clone(fixture.receipt);
  if (key === 'command_id') receipt.command_id = fixtures[1].command.command_id;
  if (key === 'action') receipt.action = 'owner_note.append';
  if (key === 'company_id') receipt.company_id = 'private-company';
  if (key === 'scope') receipt.scope.id = 'private-project';
  if (key === 'request_digest') receipt.request_digest = fixtures[1].receipt.request_digest;
  if (key === 'ref_company') receipt.message_ref.company_id = 'private-company';
  if (key === 'ref_scope') receipt.conversation_ref.scope.id = 'private-project';
  if (key === 'message_revision') receipt.message_ref.revision = 2;
  if (key === 'unavailable') Object.assign(receipt.message_ref, {availability: 'unavailable', revision: null, digest: null, unavailable_reason: 'linked_record_metadata_unavailable'});
  await api.validateOwnerDiscussionReceipt(canonicalBytes(receipt), context, fixture.command).then(() => {throw new Error('accepted');}, fixedError);
});
it('does not bind receipt from a response-provided request digest', async () => {
  const api = await load(), fixture = fixtures[0], command = {...fixture.command, body: 'private changed body'};
  await expect(api.validateOwnerDiscussionReceipt(canonicalBytes(fixture.receipt), context, command)).rejects.toThrow('request_mismatch');
});
it('enforces the frozen principal UTF8 byte limit on receipt metadata', async () => {
  const api = await load(), fixture = fixtures[0];
  await expect(api.validateOwnerDiscussionReceipt(canonicalBytes({...fixture.receipt, principal_id: 'é'.repeat(64)}), context, fixture.command)).resolves.toMatchObject({principal_id: 'é'.repeat(64)});
  for (const count of [65, 128]) await expect(api.validateOwnerDiscussionReceipt(canonicalBytes({...fixture.receipt, principal_id: 'é'.repeat(count)}), context, fixture.command)).rejects.toThrow('text_byte_limit');
});
it.each(['author', 'sequence', 'summary', 'body', 'timestamp', 'observation', 'author_scope'])('rejects semantically malicious %s despite recomputed nested and aggregate digests', async key => {
  const api = await load(), fixture = fixtures[0], value = clone(fixture.read_back);
  if (key === 'author') value.message.recorded_author.principal_id = 'private-author';
  if (key === 'sequence') value.message.conversation_sequence = 2;
  if (key === 'summary') value.message.summary = 'private-summary';
  if (key === 'body') value.message.body = 'private-body';
  if (key === 'timestamp') value.message.recorded_at_utc_epoch_ms++;
  if (key === 'observation') value.message.observation = {source: 'synthetic_fixture', evidence_scope: 'synthetic_contract', live_verified: false};
  if (key === 'author_scope') value.message.recorded_author.scope.id = 'private-project';
  bindRefs(value);
  // Independently passed receipt matches altered digests; semantic checks must still reject.
  await api.validateOwnerDiscussionReadBack(canonicalBytes(value), context, fixture.command, value.receipt).then(() => {throw new Error('accepted');}, fixedError);
});
it.each(['id', 'revision', 'digest', 'company_id', 'scope', 'kind', 'availability', 'unavailable_reason'])('compares full typed references including %s', async key => {
  const api = await load(), fixture = fixtures[0], value = clone(fixture.read_back), ref = value.message.conversation_ref;
  const changes: Data = {id: fixtures[1].receipt.message_ref.id, revision: 2, digest: '0'.repeat(64), company_id: 'private-company', scope: {kind: 'project', id: 'private-project'}, kind: 'message', availability: 'unavailable', unavailable_reason: 'linked_record_metadata_unavailable'};
  ref[key] = changes[key]; rehash(value);
  value.receipt.message_ref.digest = value.message.digest; value.digest = ownDigest(value);
  await expect(api.validateOwnerDiscussionReadBack(canonicalBytes(value), context, fixture.command, value.receipt)).rejects.toThrow();
});
it('rejects a current-head substitution and a nested receipt differing from retained receipt', async () => {
  const api = await load(), fixture = fixtures[0], value = clone(fixture.read_back);
  value.conversation = clone(fixtures[1].read_back.conversation); value.digest = ownDigest(value);
  await expect(api.validateOwnerDiscussionReadBack(canonicalBytes(value), context, fixture.command, fixture.receipt)).rejects.toThrow('reference_mismatch');
  const changed = clone(fixture.read_back); changed.receipt.principal_id = 'private-author'; changed.digest = ownDigest(changed);
  await expect(api.validateOwnerDiscussionReadBack(canonicalBytes(changed), context, fixture.command, fixture.receipt)).rejects.toThrow('receipt_mismatch');
  await expect(api.validateOwnerDiscussionReadBack(canonicalBytes(fixture.read_back), context, fixture.command, {...fixture.receipt, permission: 'private'} as any)).rejects.toThrow('fields');
});
it('independently validates nested records and wrapper digests', async () => {
  const api = await load(), fixture = fixtures[0];
  for (const target of ['conversation', 'message', 'wrapper']) {
    const value = clone(fixture.read_back);
    if (target === 'wrapper') value.digest = '0'.repeat(64);
    else {value[target].digest = '0'.repeat(64); value.digest = ownDigest(value);}
    await expect(api.validateOwnerDiscussionReadBack(canonicalBytes(value), context, fixture.command, fixture.receipt)).rejects.toThrow('digest_mismatch');
  }
});
it('captures context, command and retained receipt before asynchronous hashing', async () => {
  const api = await load(), fixture = fixtures[0];
  const expected = structuredClone(context), command = clone(fixture.command), receipt = clone(fixture.receipt);
  const pending = api.validateOwnerDiscussionReadBack(canonicalBytes(fixture.read_back), expected, command as any, receipt as any);
  expected.scope.id = 'private-project'; command.body = 'private-body'; receipt.principal_id = 'private-author'; receipt.conversation_ref.revision = 99;
  await expect(pending).resolves.toMatchObject({scope: context.scope, receipt: fixture.receipt});
  const digestContext = structuredClone(context), digestCommand = clone(fixture.command);
  const pendingDigest = api.ownerDiscussionRequestDigest(digestCommand as any, digestContext);
  digestContext.scope.id = 'private-project'; digestCommand.body = 'private-body';
  await expect(pendingDigest).resolves.toBe(fixture.receipt.request_digest);
});
