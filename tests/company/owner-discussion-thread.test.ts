import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import {parseOwnerDiscussionCommand} from '../../packages/company-contracts/communications/owner-discussion.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-thread-candidate.1/examples.json';
import manifest from '../../packages/company-contracts/communications/owner-discussion-thread-candidate.1/manifest.json';

type Data = Record<string, any>;
const load = () => import('../../packages/company-contracts/communications/owner-discussion-thread.ts');
const fixtures = examples.examples as Data[];
const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const ownDigest = (value: Data) => hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'))));
const clone = <T>(value: T): T => structuredClone(value);
const page = () => clone(fixtures[1].page) as Data;
const encoder = new TextEncoder();
const ref = (record: Data) => ({kind: record.record_type, id: record.id, company_id: record.company_id, scope: clone(record.scope), availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
function command(item: Data) {
  return {schema_version: 1, action: item.receipt.action, command_id: item.receipt.command_id, summary: item.message.summary, body: item.message.body};
}
function bind(item: Data, request = false) {
  item.conversation.digest = ownDigest(item.conversation);
  item.receipt.conversation_ref = ref(item.conversation);
  item.message.conversation_ref = clone(item.receipt.conversation_ref);
  item.message.digest = ownDigest(item.message);
  item.receipt.message_ref = ref(item.message);
  if (request) item.receipt.request_digest = hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1, ...context, command: command(item)}));
  item.digest = ownDigest(item);
}
function rehash(value: Data) {value.digest = ownDigest(value); return value;}
function encodedRecipe() {
  const recipe = examples.generated_recipes[0], value = page(), items: Data[] = [];
  const summary = recipe.summary.repeat.repeat(recipe.summary.count), body = recipe.body.repeat.repeat(recipe.body.count);
  const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  for (let n = 1; n <= recipe.command_count; n++) {
    const item = clone(value.items[0]);
    Object.assign(item.conversation, {id: recipe.room_uuid, revision: n});
    Object.assign(item.message, {id: uuid(100 + n), conversation_sequence: n, summary, body, recorded_at_utc_epoch_ms: recipe.observed_at_utc_epoch_ms});
    Object.assign(item.receipt, {command_id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, recorded_at_utc_epoch_ms: recipe.observed_at_utc_epoch_ms});
    bind(item, true); items.unshift(item);
  }
  Object.assign(value, {room_head: clone(items[0].conversation), items, requested_limit: recipe.requested_limit, observed_at_utc_epoch_ms: recipe.observed_at_utc_epoch_ms});
  value.coverage.truncation = recipe.expected_truncation;
  const full = rehash(clone(value));
  value.items = items.slice(0, recipe.expected_item_count);
  return {value: rehash(value), full, recipe};
}
async function reject(value: Data, expected = context, limit = value.requested_limit) {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(value), expected, limit)).rejects.toThrow();
}

it('pins exact raw thread assets and frozen imports without widening command bounds', async () => {
  const {OWNER_DISCUSSION_THREAD_PIN: pin} = await load();
  expect(pin).toMatchObject({contract: manifest.contract, version: manifest.version, backendCheckpoint: '06dd3273f9238b830fed0a6e65b08eb9f1cc73fa', maximumRawBytes: 262144, maximumItems: 50, executable: false});
  const base = new URL('../../packages/company-contracts/communications/owner-discussion-thread-candidate.1/', import.meta.url);
  expect(hash(readFileSync(new URL('manifest.json', base)))).toBe(pin.manifestSHA256);
  expect(pin.manifestSHA256).toBe('cd386b8a084f2619868219a673be2b718802be95bc90cfca96258e13e5c0f6d8');
  expect(pin.schemaSHA256).toBe(manifest.assets[0].sha256);
  expect(pin.examplesSHA256).toBe(manifest.assets[1].sha256);
  for (const asset of [...manifest.assets, ...manifest.frozen_imports]) {
    expect(hash(readFileSync(new URL('../../packages/company-contracts/' + asset.path.replace('contracts/', ''), import.meta.url)))).toBe(asset.sha256);
  }
  expect(Object.isFrozen(pin)).toBe(true);
});
for (const fixture of fixtures) it(`validates exact producer sample ${fixture.name}`, async () => {
  const api = await load(), raw = canonicalBytes(fixture.page);
  expect(raw.byteLength).toBe(fixture.canonical_utf8_bytes);
  expect(hash(raw)).toBe(fixture.canonical_sha256);
  const value = await api.validateOwnerDiscussionThread(raw, {company_id: fixture.expected_company_id, scope: fixture.expected_scope}, fixture.expected_limit);
  expect(canonicalBytes(value)).toEqual(raw);
  const frozen = (node: unknown) => {
    if (node && typeof node === 'object') {expect(Object.isFrozen(node)).toBe(true); Object.values(node).forEach(frozen);}
  };
  frozen(value);
});
it('reproduces the complete canonical escaped byte-limit recipe and whole-prefix output', async () => {
  const api = await load(), {value, full, recipe} = encodedRecipe(), raw = canonicalBytes(value);
  expect(raw.byteLength).toBe(recipe.expected_canonical_utf8_bytes);
  expect(hash(raw)).toBe(recipe.expected_canonical_sha256);
  expect(canonicalBytes(full).byteLength).toBeGreaterThan(262144);
  expect(value.items.map((item: Data) => item.message.conversation_sequence)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4]);
  for (const item of full.items) {
    const commandRaw = canonicalBytes(command(item));
    expect(commandRaw.byteLength).toBe(recipe.max_command_canonical_utf8_bytes);
    expect(() => parseOwnerDiscussionCommand(commandRaw)).not.toThrow();
  }
  await expect(api.validateOwnerDiscussionThread(raw, context, recipe.requested_limit)).resolves.toMatchObject({coverage: {truncation: 'byte_limit'}});
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(full), context, recipe.requested_limit)).rejects.toThrow('wire_limit');
  expect(() => parseOwnerDiscussionCommand(raw)).toThrow('wire_limit');
});
it('accepts output262144 and rejects262145 while preserving command32768', async () => {
  const api = await load(), raw = canonicalBytes(page());
  const padded = (bytes: Uint8Array, cap: number) => Buffer.concat([bytes, Buffer.alloc(cap - bytes.byteLength, 32)]);
  await expect(api.validateOwnerDiscussionThread(padded(raw, 262144), context, 20)).resolves.toBeDefined();
  await expect(api.validateOwnerDiscussionThread(padded(raw, 262145), context, 20)).rejects.toThrow('wire_limit');
  const commandRaw = canonicalBytes(command(page().items[0]));
  expect(() => parseOwnerDiscussionCommand(padded(commandRaw, 32768))).not.toThrow();
  expect(() => parseOwnerDiscussionCommand(padded(commandRaw, 32769))).toThrow('wire_limit');
});
it.each([
  ['duplicate', '{"schema_version":1,"schema_version":1}'], ['bom', '\ufeff{}'],
  ['surrogate', '{"body":"\\ud800"}'], ['float', '{"schema_version":1.0}'],
  ['exponent', '{"schema_version":1e0}'], ['negative zero', '{"schema_version":-0}'],
  ['unsafe integer', '{"schema_version":9007199254740992}'], ['trailing', '{}x'],
  ['depth', '['.repeat(66) + '0' + ']'.repeat(66)],
])('rejects strict codec %s', async (_name, raw) => {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(encoder.encode(raw), context, 20)).rejects.toThrow();
});
it('rejects invalid UTF8 and nonbyte input', async () => {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(new Uint8Array([0xc0, 0xaf]), context, 20)).rejects.toThrow('invalid_utf8');
  await expect(api.validateOwnerDiscussionThread('{}' as any, context, 20)).rejects.toThrow('invalid_json_type');
});
it.each([0, 51, -1, 1.5, NaN, Infinity, '20', true, null, undefined])('requires independently valid exact limit %s', async limit => {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(page()), context, limit as any)).rejects.toThrow();
});
it('binds response1 to independently retained expected20 even for empty and byte pages', async () => {
  const api = await load();
  const one = clone(fixtures.find(fixture => fixture.expected_limit === 1)!.page);
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(one), context, 20)).rejects.toThrow('limit_mismatch');
  for (const value of [clone(fixtures[0].page), encodedRecipe().value]) {
    value.requested_limit = 1; rehash(value);
    await expect(api.validateOwnerDiscussionThread(canonicalBytes(value), context, 20)).rejects.toThrow('limit_mismatch');
  }
});
it('snapshots complete company/project and raw page before its first asynchronous digest', async () => {
  const api = await load(), expected = clone(context), raw = canonicalBytes(page());
  const pending = api.validateOwnerDiscussionThread(raw, expected, 20);
  expected.company_id = 'private-company'; expected.scope.id = 'private-project'; raw.fill(0);
  await expect(pending).resolves.toMatchObject(context);
});
it.each([
  {kind: 'company_ops', id: 'company-ops'}, {kind: 'project', id: 'company-ops'},
  {kind: 'project', id: 'Alpha'}, {kind: 'project', id: '%61lpha'},
  {kind: 'project', id: 'alpha/beta'}, {kind: 'project', id: 'alpha?limit=1'},
])('rejects noncanonical discovery project $id', async scope => {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(page()), {...context, scope} as any, 20)).rejects.toThrow('read_context');
});
it('rejects unexpected caller context members and independent company/project mismatch', async () => {
  const api = await load();
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(page()), {...context, room_id: 'private'} as any, 20)).rejects.toThrow('read_context');
  await reject(page(), {...context, company_id: 'other-company'});
  await reject(page(), {...context, scope: {kind: 'project', id: 'beta'}});
});
it('keeps historical revisions separate instead of comparing older pairs to the current head', async () => {
  const api = await load(), value = page();
  expect(value.items.map((item: Data) => item.conversation.revision)).toEqual([3, 2, 1]);
  expect(new Set(value.items.map((item: Data) => item.conversation.id)).size).toBe(1);
  await expect(api.validateOwnerDiscussionThread(canonicalBytes(value), context, 20)).resolves.toBeDefined();
});
it.each(['head', 'conversation', 'message', 'item', 'page'])('recomputes %s digest independently', async target => {
  const value = page();
  if (target === 'head') value.room_head.digest = '0'.repeat(64);
  if (target === 'conversation') value.items[1].conversation.digest = '0'.repeat(64);
  if (target === 'message') value.items[1].message.digest = '0'.repeat(64);
  if (target === 'item') value.items[1].digest = '0'.repeat(64);
  if (target !== 'page') rehash(value); else value.digest = '0'.repeat(64);
  await reject(value);
});
it.each(['kind', 'id', 'company_id', 'scope', 'revision', 'digest', 'availability', 'unavailable_reason'])('compares complete historical reference %s', async key => {
  const value = page(), item = value.items[1];
  const changes: Data = {kind: 'message', id: value.items[0].message.id, company_id: 'other-company', scope: {kind: 'project', id: 'beta'}, revision: 3, digest: '0'.repeat(64), availability: 'unavailable', unavailable_reason: 'linked_record_metadata_unavailable'};
  item.message.conversation_ref[key] = changes[key];
  item.message.digest = ownDigest(item.message); item.receipt.message_ref = ref(item.message); rehash(item); rehash(value);
  await reject(value);
});
it.each(['action', 'outcome', 'principal', 'request_digest', 'timestamp', 'author_scope', 'company', 'scope', 'room', 'visibility'])('rejects malicious %s with recomputed record/item/page digests', async key => {
  const value = page(), item = value.items[1];
  if (key === 'action') item.receipt.action = 'owner_note.append';
  if (key === 'outcome') item.receipt.outcome = 'approved';
  if (key === 'principal') item.receipt.principal_id = 'private-author';
  if (key === 'request_digest') item.receipt.request_digest = '0'.repeat(64);
  if (key === 'timestamp') item.receipt.recorded_at_utc_epoch_ms++;
  if (key === 'author_scope') item.message.recorded_author.scope.id = 'beta';
  if (key === 'company') item.company_id = 'other-company';
  if (key === 'scope') item.scope.id = 'beta';
  if (key === 'room') item.conversation.id = '20000000-0000-4000-8000-000000000099';
  if (key === 'visibility') {item.conversation.visibility_revision = 2; item.message.visibility_revision = 2;}
  bind(item); rehash(value); await reject(value);
});
it('checks stored principal UTF8 bytes even if receipt and message agree', async () => {
  const api = await load();
  for (const count of [64, 65]) {
    const value = page(), item = value.items[1];
    item.receipt.principal_id = item.message.recorded_author.principal_id = 'é'.repeat(count);
    bind(item); rehash(value);
    const result = api.validateOwnerDiscussionThread(canonicalBytes(value), context, 20);
    if (count === 64) await expect(result).resolves.toBeDefined(); else await expect(result).rejects.toThrow('text_byte_limit');
  }
});
it.each(['page', 'head', 'item', 'conversation', 'message'])('requires stored-record false observation on %s', async target => {
  const value = page(), item = value.items[1], observation = {source: 'synthetic_fixture', evidence_scope: 'synthetic_contract', live_verified: false};
  if (target === 'page') value.observation = observation;
  if (target === 'head') {value.room_head.observation = observation; rehash(value.room_head);}
  if (target === 'item') item.observation = observation;
  if (target === 'conversation') item.conversation.observation = observation;
  if (target === 'message') item.message.observation = observation;
  bind(item); rehash(value); await reject(value);
});
it.each(['duplicate_id', 'duplicate_sequence', 'ascending', 'gap', 'missing_newest', 'head_revision', 'head_room'])('rejects invalid newest prefix %s', async key => {
  const value = page();
  if (key === 'duplicate_id') {value.items[1].message.id = value.items[0].message.id; bind(value.items[1]);}
  if (key === 'duplicate_sequence') value.items[1] = clone(value.items[0]);
  if (key === 'ascending') value.items.reverse();
  if (key === 'gap') value.items.splice(1, 1);
  if (key === 'missing_newest') value.items.shift();
  if (key === 'head_revision') {value.room_head.revision++; rehash(value.room_head);}
  if (key === 'head_room') {value.room_head.id = '20000000-0000-4000-8000-000000000099'; rehash(value.room_head);}
  rehash(value); await reject(value);
});
it('rejects current-head substitution into a historical item even after full reference rebinding', async () => {
  const value = page(), item = value.items[1];
  item.conversation = clone(value.room_head); bind(item); rehash(value); await reject(value);
});
it.each(['nonnull_empty', 'null_nonempty', 'empty_item_limit', 'empty_byte_limit'])('preserves observed-empty distinction %s', async key => {
  const value = key.startsWith('empty') ? clone(fixtures[0].page) : page();
  if (key === 'nonnull_empty') value.items = [];
  if (key === 'null_nonempty') value.room_head = null;
  if (key === 'empty_item_limit') value.coverage.truncation = 'item_limit';
  if (key === 'empty_byte_limit') value.coverage.truncation = 'byte_limit';
  rehash(value); await reject(value);
});
it.each(['complete', 'total', 'has_more', 'cursor', 'continuation', 'snapshot', 'live', 'extra', 'limit'])('rejects fabricated coverage/authority %s', async key => {
  const value = page();
  if (key === 'complete') value.coverage.status = 'complete';
  if (key === 'total') value.coverage.total_count = 3;
  if (key === 'has_more') value.has_more = false;
  if (key === 'cursor') value.next_cursor = 'private-cursor';
  if (key === 'continuation') value.continuation.status = 'available';
  if (key === 'snapshot') value.snapshot.reason = 'private-snapshot';
  if (key === 'live') value.observation.live_verified = true;
  if (key === 'extra') value.permission = 'private-grant';
  if (key === 'limit') value.limits.max_response_utf8_bytes++;
  rehash(value); await reject(value);
});
it.each(['none_omitted', 'item_incomplete', 'item_no_omission', 'byte_no_omission', 'byte_at_limit'])('enforces supplemental truncation semantics %s', async key => {
  const value = page();
  if (key === 'none_omitted') value.items.pop();
  if (key === 'item_incomplete') value.coverage.truncation = 'item_limit';
  if (key === 'item_no_omission') {value.requested_limit = 3; value.coverage.truncation = 'item_limit';}
  if (key === 'byte_no_omission') value.coverage.truncation = 'byte_limit';
  if (key === 'byte_at_limit') {value.items.pop(); value.requested_limit = 2; value.coverage.truncation = 'byte_limit';}
  rehash(value); await reject(value);
});
it('rejects closed producer error envelopes as thread successes', async () => {
  for (const error of examples.errors) await reject(error);
});
