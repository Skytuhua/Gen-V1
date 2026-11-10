import {createHash, createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import {parseOwnerDiscussionCommand} from '../../packages/company-contracts/communications/owner-discussion.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-history-candidate.1/examples.json';
import manifest from '../../packages/company-contracts/communications/owner-discussion-history-candidate.1/manifest.json';

type Data = Record<string, any>;
const load = () => import('../../packages/company-contracts/communications/owner-discussion-history.ts');
const fixtures = examples.examples as Data[];
const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
const clone = <T>(value: T): T => structuredClone(value);
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const ownDigest = (value: Data) => hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'))));
const rehash = (value: Data) => {value.digest = ownDigest(value); return value;};
const initial = () => clone(fixtures[1].page) as Data;
const terminal = () => clone(fixtures[2].page) as Data;
const ref = (record: Data) => ({kind: record.record_type, id: record.id, company_id: record.company_id, scope: clone(record.scope), availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
const command = (item: Data) => ({schema_version: 1, action: item.receipt.action, command_id: item.receipt.command_id, summary: item.message.summary, body: item.message.body});
function bind(item: Data, request = false) {
  rehash(item.conversation); item.receipt.conversation_ref = ref(item.conversation);
  item.message.conversation_ref = clone(item.receipt.conversation_ref); rehash(item.message);
  item.receipt.message_ref = ref(item.message);
  if (request) item.receipt.request_digest = hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1, ...context, command: command(item)}));
  return rehash(item);
}
const frozen = (value: unknown): void => {
  if (value && typeof value === 'object') {expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen);}
};
async function first(value = initial(), expected = context) {
  const api = await load();
  return api.validateOwnerDiscussionHistory(canonicalBytes(value), expected, {project_id: expected.scope.id, limit: value.requested_limit, cursor: null});
}
async function reject(value: Data, request = fixtures[1].request, previous?: any, expected: any = context) {
  const api = await load();
  await expect(api.validateOwnerDiscussionHistory(canonicalBytes(value), expected, request as any, previous)).rejects.toThrow();
}
function slicePage(base: Data, items: Data[], cursor: string | null, truncation = 'item_limit'): Data {
  const value = clone(base), start = items[0].message.conversation_sequence, end = items.at(-1)!.message.conversation_sequence;
  Object.assign(value, {items: clone(items), range: {start_sequence: start, end_sequence: end, next_sequence: cursor ? end - 1 : null}, has_more: cursor !== null, next_cursor: cursor,
    coverage: {status: cursor ? 'partial' : 'complete_for_cut', truncation: cursor ? truncation : 'none', total_count: null}});
  return rehash(value);
}
function traversal() {
  const cut = clone(fixtures[3].page) as Data;
  const items = [cut.items[0], ...initial().items, terminal().items[0]];
  cut.requested_limit = 1;
  return items.map((item, index) => slicePage(cut, [item], index === 3 ? null : Buffer.from(`opaque-page-${index + 2}`).toString('base64url')));
}
function byteRecipe() {
  const recipe = examples.generated_recipes[0], base = initial(), items: Data[] = [];
  const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  for (let n = 1; n <= recipe.command_count; n++) {
    const item = clone(base.items[0]);
    Object.assign(item.conversation, {id: recipe.room_id, revision: n});
    Object.assign(item.message, {id: uuid(100 + n), conversation_sequence: n, summary: recipe.summary.repeat.repeat(recipe.summary.count), body: recipe.body.repeat.repeat(recipe.body.count)});
    item.receipt.command_id = `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    bind(item, true); items.unshift(item);
  }
  const access = {kind: 'owner', principal_id: recipe.principal_id, permissions: [...recipe.permissions].sort(), project_ids: ['alpha', 'beta'],
    store_principal: {id: 'control', kind: 'coordinator', employee_id: null, machine_id: null, revoked: 0},
    audience: {kind: 'owner_self', owner_principal_id: 'control', room_id: recipe.room_id}, visibility_policy: {policy: 'owner_project_discussion_v1', revision: 1}};
  Object.assign(base, {watermark_head: clone(items[0].conversation), requested_limit: recipe.fixed_limit});
  Object.assign(base.snapshot, {id: recipe.snapshot_id, access_digest: hash(canonicalBytes(access)), watermark_message_ref: ref(items[0].message)});
  // Only this public deterministic producer recipe constructs a test cursor. The
  // consumer treats every cursor as opaque and never verifies a host signature.
  const payload = canonicalBytes({version: 1, principal_id: recipe.principal_id, company_id: recipe.company_id, scope: recipe.scope, room_id: recipe.room_id,
    limit: recipe.fixed_limit, order: base.order, access_digest: base.snapshot.access_digest, snapshot_id: recipe.snapshot_id, incarnation: recipe.incarnation,
    issued_at_utc_epoch_ms: recipe.clock_utc_epoch_ms, expires_at_utc_epoch_ms: base.snapshot.expires_at_utc_epoch_ms,
    monotonic_deadline_ms: recipe.monotonic_seconds * 1000 + base.snapshot.expires_at_utc_epoch_ms - recipe.clock_utc_epoch_ms,
    watermark_conversation_ref: ref(base.watermark_head), watermark_message_ref: base.snapshot.watermark_message_ref, next_sequence: 3});
  const signature = createHmac('sha256', Buffer.from(recipe.public_test_key_hex, 'hex')).update('maritime-owner-discussion-history-cursor\0v1\0').update(payload).digest();
  const cursor = Buffer.concat([payload, signature]).toString('base64url');
  return {recipe, items, first: slicePage(base, items.slice(0, recipe.first_items), cursor, 'byte_limit'), terminal: slicePage(base, items.slice(recipe.first_items), null), full: slicePage(base, items, null)};
}

it('pins the exact history tuple and all unchanged frozen schema imports', async () => {
  const {OWNER_DISCUSSION_HISTORY_PIN: pin} = await load();
  expect(pin).toMatchObject({contract: manifest.contract, version: manifest.version, backendCheckpoint: 'd824991f24b5fd31805f90e528cefb1e05a126ae', maximumRawBytes: 262144, maximumItems: 50, maximumCursorChars: 4096, executable: false});
  const base = new URL('../../packages/company-contracts/communications/owner-discussion-history-candidate.1/', import.meta.url);
  expect(hash(readFileSync(new URL('manifest.json', base)))).toBe('59cecb824713b945f54f20d0cee595ff5300fc6542754c9c99228e8cf512c323');
  expect(pin.manifestSHA256).toBe('59cecb824713b945f54f20d0cee595ff5300fc6542754c9c99228e8cf512c323');
  expect(pin.schemaSHA256).toBe(manifest.assets[0].sha256); expect(pin.examplesSHA256).toBe(manifest.assets[1].sha256);
  for (const asset of [...manifest.assets, ...manifest.frozen_imports]) {
    expect(hash(readFileSync(new URL('../../packages/company-contracts/' + asset.path.replace('contracts/', ''), import.meta.url)))).toBe(asset.sha256);
  }
  frozen(pin);
});
it('normalizes an immutable closed request before credential work, with independent default20 and opaque canonical tokens', async () => {
  const api = await load(), retained = clone(context);
  const request = api.normalizeOwnerDiscussionHistoryRequest(retained);
  retained.scope.id = 'beta'; expect(request).toEqual({project_id: 'alpha', limit: 20, cursor: null}); frozen(request);
  expect(api.normalizeOwnerDiscussionHistoryRequest(context, 20, null)).toEqual(request);
  for (const limit of [1, 50]) expect(api.normalizeOwnerDiscussionHistoryRequest(context, limit, 'AA')).toEqual({project_id: 'alpha', limit, cursor: 'AA'});
  expect(api.normalizeOwnerDiscussionHistoryRequest(context, 1, 'A'.repeat(4096)).cursor).toHaveLength(4096);
  // These tokens contain arbitrary bytes, without a JSON payload or valid signature.
  expect(api.normalizeOwnerDiscussionHistoryRequest(context, 1, '_w').cursor).toBe('_w');
});
it.each([0, 51, -1, 1.5, NaN, Infinity, '20', true, null])('rejects independent invalid limit %s synchronously', async limit => {
  const api = await load(); expect(() => api.normalizeOwnerDiscussionHistoryRequest(context, limit as any)).toThrow();
});
it.each(['', 'A', 'AB', 'AAB', 'AA=', '+w', '/w', ' AA', 'AA\n', 'AAA\n', 'AAA\r', 'é', 'A'.repeat(4097), 12, false])('rejects noncanonical cursor %s synchronously', async cursor => {
  const api = await load(); expect(() => api.normalizeOwnerDiscussionHistoryRequest(context, 20, cursor as any)).toThrow();
});
it.each([
  {kind: 'company_ops', id: 'company-ops'}, {kind: 'project', id: 'company-ops'},
  {kind: 'project', id: 'Alpha'}, {kind: 'project', id: '%61lpha'},
  {kind: 'project', id: 'alpha/beta'}, {kind: 'project', id: 'alpha?limit=1'},
  {kind: 'project', id: 'alpha\n'},
])('rejects noncanonical independently retained project $id', async scope => {
  const api = await load(); expect(() => api.normalizeOwnerDiscussionHistoryRequest({...context, scope} as any)).toThrow('read_context');
});
it('rejects untrusted context shape and request members, company, project, limit and token mismatch', async () => {
  const api = await load();
  expect(() => api.normalizeOwnerDiscussionHistoryRequest({...context, room_id: 'private'} as any)).toThrow('read_context');
  for (const request of [{...fixtures[1].request, extra: true}, {...fixtures[1].request, project_id: 'beta'}, {...fixtures[1].request, limit: 20}, {project_id: 'alpha', limit: 2}]) await reject(initial(), request);
  await reject(initial(), fixtures[1].request, undefined, {...context, company_id: 'other-company'});
  await reject(initial(), fixtures[1].request, undefined, {...context, scope: {kind: 'project', id: 'beta'}});
});
for (const [index, fixture] of fixtures.entries()) it(`validates exact pinned producer sample ${fixture.name}`, async () => {
  const api = await load(), raw = canonicalBytes(fixture.page);
  expect(raw.byteLength).toBe(fixture.canonical_utf8_bytes); expect(hash(raw)).toBe(fixture.canonical_sha256);
  const prior = index === 2 ? (await first()).continuation! : undefined;
  const result = await api.validateOwnerDiscussionHistory(raw, context, fixture.request as any, prior);
  expect(canonicalBytes(result.page)).toEqual(raw); frozen(result);
  if (!fixture.page.has_more) expect(result.continuation).toBeNull();
  else expect(result.continuation).toMatchObject({context, requestedLimit: fixture.request.limit, snapshot: fixture.page.snapshot, watermarkHead: fixture.page.watermark_head, nextSequence: fixture.page.range.next_sequence, nextCursor: fixture.page.next_cursor, seenMessageIds: fixture.page.items.map((item: Data) => item.message.id)});
});
it('retains the original cut after a later append and permits replay of the same continuation', async () => {
  const api = await load(), prior = (await first()).continuation!;
  expect(fixtures[3].page.watermark_head!.revision).toBe(4);
  const raw = canonicalBytes(terminal()), request = fixtures[2].request;
  const left = await api.validateOwnerDiscussionHistory(raw, context, request, prior);
  const right = await api.validateOwnerDiscussionHistory(raw, context, request, prior);
  expect(left).toEqual(right); expect(left.page.watermark_head!.revision).toBe(3); expect(left.page.range).toEqual({start_sequence: 1, end_sequence: 1, next_sequence: null});
  expect(left.continuation).toBeNull();
});
it('captures caller context, raw response, normalized request and all retained continuation data before its first await', async () => {
  const api = await load(), expected = clone(context), request = clone(fixtures[2].request), prior: any = clone((await first()).continuation!), raw = canonicalBytes(terminal());
  const pending = api.validateOwnerDiscussionHistory(raw, expected, request, prior);
  expected.company_id = 'private-company'; expected.scope.id = 'private-project'; request.limit = 50; request.cursor = 'private-token';
  prior.snapshot.id = 'private-snapshot'; prior.watermarkHead.title = 'private-room'; prior.seenMessageIds.fill('private-id'); prior.context.scope.id = 'private-project'; raw.fill(0);
  await expect(pending).resolves.toMatchObject({page: {company_id: context.company_id, scope: context.scope, snapshot: fixtures[1].page.snapshot}, continuation: null});
});
it('captures a closed deeply immutable continuation synchronously without a wire-size cap on local seen IDs', async () => {
  const api = await load(), prior: any = clone((await first()).continuation!), retained = api.captureOwnerDiscussionHistoryContinuation(prior, context);
  prior.seenMessageIds[0] = 'private'; prior.snapshot.access_digest = 'private'; prior.watermarkHead.scope.id = 'beta';
  expect(retained.seenMessageIds[0]).toBe(initial().items[0].message.id); frozen(retained);
  const growing: any = clone(retained); growing.seenMessageIds = [retained.seenMessageIds[0], ...Array.from({length: 7999}, (_, n) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`)];
  growing.watermarkHead.revision = 8001; growing.nextSequence = 1;
  expect(canonicalBytes(growing).byteLength).toBeGreaterThan(262144);
  expect(api.captureOwnerDiscussionHistoryContinuation(growing, context).seenMessageIds).toHaveLength(8000);
});
it.each(['extra', 'company', 'scope', 'limit', 'cursor', 'snapshot', 'head', 'head_company', 'anchor_scope', 'anchor_revision', 'seen_uuid', 'seen_newline', 'seen_duplicate', 'seen_length', 'next_zero', 'next_head', 'observation', 'ttl'])('rejects malformed retained continuation %s before await', async target => {
  const api = await load(), prior: any = clone((await first()).continuation!);
  if (target === 'extra') prior.authority = true;
  if (target === 'company') prior.context.company_id = 'other-company';
  if (target === 'scope') prior.context.scope.id = 'beta';
  if (target === 'limit') prior.requestedLimit = 51;
  if (target === 'cursor') prior.nextCursor = 'AB';
  if (target === 'snapshot') prior.snapshot.extra = true;
  if (target === 'head') prior.watermarkHead = null;
  if (target === 'head_company') prior.watermarkHead.company_id = 'other-company';
  if (target === 'anchor_scope') prior.snapshot.watermark_message_ref.scope.id = 'beta';
  if (target === 'anchor_revision') prior.snapshot.watermark_message_ref.revision = 2;
  if (target === 'seen_uuid') prior.seenMessageIds[1] = 'private-not-uuid';
  if (target === 'seen_newline') prior.seenMessageIds[1] += '\n';
  if (target === 'seen_duplicate') prior.seenMessageIds[1] = prior.seenMessageIds[0];
  if (target === 'seen_length') prior.seenMessageIds.pop();
  if (target === 'next_zero') prior.nextSequence = 0;
  if (target === 'next_head') prior.nextSequence = prior.watermarkHead.revision;
  if (target === 'observation') prior.watermarkHead.observation.live_verified = true;
  if (target === 'ttl') prior.snapshot.expires_at_utc_epoch_ms = prior.snapshot.issued_at_utc_epoch_ms;
  expect(() => api.captureOwnerDiscussionHistoryContinuation(prior, context)).toThrow();
});
it('requires a retained continuation only for a continuation request and binds its exact token and fixed limit', async () => {
  const prior = (await first()).continuation!;
  await reject(initial(), fixtures[1].request, prior); await reject(terminal(), fixtures[2].request);
  await reject(terminal(), {...fixtures[2].request, cursor: 'AA'}, prior);
  const changed: any = clone(prior); changed.requestedLimit = 1;
  await reject(terminal(), fixtures[2].request, changed);
});
it('maintains contiguous sequences and rejects nonadjacent repeated IDs across a full four-page traversal', async () => {
  const api = await load(), pages = traversal(); let prior: any;
  for (let index = 0; index < pages.length; index++) {
    const request = {project_id: 'alpha', limit: 1, cursor: prior?.nextCursor ?? null};
    const result = await api.validateOwnerDiscussionHistory(canonicalBytes(pages[index]), context, request, prior);
    if (index === 2) {
      const bad = clone(pages[3]); bad.items[0].message.id = pages[0].items[0].message.id; bind(bad.items[0]); rehash(bad);
      await reject(bad, {project_id: 'alpha', limit: 1, cursor: result.continuation!.nextCursor}, result.continuation);
    }
    prior = result.continuation;
  }
  expect(prior).toBeNull();
});
it.each(['gap', 'overlap', 'end', 'next', 'sequence', 'repeat_token'])('rejects cross-page range/nonprogress %s after recomputing digests', async target => {
  const api = await load(), pages = traversal(), prior = (await first(pages[0])).continuation!, value = clone(pages[1]);
  if (target === 'gap') value.range.start_sequence--;
  if (target === 'overlap') value.range.start_sequence++;
  if (target === 'end') value.range.end_sequence--;
  if (target === 'next') value.range.next_sequence--;
  if (target === 'sequence') {value.items[0].message.conversation_sequence--; bind(value.items[0]);}
  if (target === 'repeat_token') value.next_cursor = prior.nextCursor;
  rehash(value); await expect(api.validateOwnerDiscussionHistory(canonicalBytes(value), context, {project_id: 'alpha', limit: 1, cursor: prior.nextCursor}, prior)).rejects.toThrow();
});
it.each(['id', 'incarnation', 'access_digest', 'issued_at_utc_epoch_ms', 'expires_at_utc_epoch_ms', 'head', 'message_kind', 'message_id', 'message_company', 'message_scope', 'message_revision', 'message_digest', 'message_availability', 'message_reason'])('retains the complete cut and typed anchor %s across pages', async target => {
  const prior = (await first()).continuation!, value = terminal();
  if (target === 'id' || target === 'incarnation') value.snapshot[target] = '70000000-0000-4000-8000-000000000001';
  if (target === 'access_digest') value.snapshot.access_digest = '0'.repeat(64);
  if (target === 'issued_at_utc_epoch_ms') {value.snapshot.issued_at_utc_epoch_ms++; value.observed_at_utc_epoch_ms++;}
  if (target === 'expires_at_utc_epoch_ms') value.snapshot.expires_at_utc_epoch_ms++;
  if (target === 'head') {value.watermark_head.revision++; rehash(value.watermark_head);}
  const mutations: Data = {kind: 'conversation', id: value.items[0].message.id, company: 'other-company', scope: {kind: 'project', id: 'beta'}, revision: 2, digest: '0'.repeat(64), availability: 'unavailable', reason: 'linked_record_metadata_unavailable'};
  if (target.startsWith('message_')) {const key = target.slice(8); value.snapshot.watermark_message_ref[key === 'company' ? 'company_id' : key === 'reason' ? 'unavailable_reason' : key] = mutations[key];}
  rehash(value); await reject(value, fixtures[2].request, prior);
});
it.each(['head', 'message', 'revision', 'range'])('binds initial start and exact watermark pair %s', async target => {
  const value = initial();
  if (target === 'head') {value.watermark_head.id = '70000000-0000-4000-8000-000000000001'; rehash(value.watermark_head);}
  if (target === 'message') value.snapshot.watermark_message_ref.digest = '0'.repeat(64);
  if (target === 'revision') value.snapshot.watermark_message_ref.revision = 2;
  if (target === 'range') value.range.start_sequence--;
  rehash(value); await reject(value);
});
it.each(['snapshot_id', 'incarnation', 'access_digest', 'head_id', 'message_id', 'command_id'])('rejects final newlines in canonical identity %s despite permissive regex anchors', async target => {
  const value = initial(), item = value.items[1];
  if (target === 'snapshot_id') value.snapshot.id += '\n';
  if (target === 'incarnation') value.snapshot.incarnation += '\n';
  if (target === 'access_digest') value.snapshot.access_digest += '\n';
  if (target === 'head_id') {
    value.watermark_head.id += '\n'; rehash(value.watermark_head);
    for (const record of value.items) {record.conversation.id = value.watermark_head.id; bind(record);}
    value.snapshot.watermark_message_ref = ref(value.items[0].message);
  }
  if (target === 'message_id') {item.message.id += '\n'; bind(item);}
  if (target === 'command_id') {item.receipt.command_id += '\n'; bind(item, true);}
  rehash(value); await reject(value);
});
it.each([0, -1, 900001])('rejects invalid cut lifetime delta%s without consulting local wall time', async delta => {
  const value = initial(); value.snapshot.expires_at_utc_epoch_ms = value.snapshot.issued_at_utc_epoch_ms + delta; rehash(value); await reject(value);
});
it('accepts positive cut lifetime boundaries and past timestamps while requiring observation to equal issue', async () => {
  for (const delta of [1, 900000]) {
    const value = initial(); value.snapshot.issued_at_utc_epoch_ms = value.observed_at_utc_epoch_ms = 946684800000; value.snapshot.expires_at_utc_epoch_ms = 946684800000 + delta; rehash(value);
    await expect(first(value)).resolves.toBeDefined();
  }
  const value = initial(); value.observed_at_utc_epoch_ms++; rehash(value); await reject(value);
});
it.each(['head', 'conversation', 'message', 'item', 'page'])('recomputes %s SHA independently', async target => {
  const value = initial();
  if (target === 'head') value.watermark_head.digest = '0'.repeat(64);
  if (target === 'conversation') value.items[1].conversation.digest = '0'.repeat(64);
  if (target === 'message') value.items[1].message.digest = '0'.repeat(64);
  if (target === 'item') value.items[1].digest = '0'.repeat(64);
  if (target === 'page') value.digest = '0'.repeat(64); else rehash(value);
  await reject(value);
});
it.each(['kind', 'id', 'company_id', 'scope', 'revision', 'digest', 'availability', 'unavailable_reason'])('checks every historical reference member %s with valid outer hashes', async key => {
  const value = initial(), item = value.items[1];
  const changes: Data = {kind: 'message', id: value.items[0].message.id, company_id: 'other-company', scope: {kind: 'project', id: 'beta'}, revision: 3, digest: '0'.repeat(64), availability: 'unavailable', unavailable_reason: 'linked_record_metadata_unavailable'};
  item.message.conversation_ref[key] = changes[key]; rehash(item.message); item.receipt.message_ref = ref(item.message); rehash(item); rehash(value); await reject(value);
});
it.each(['action', 'outcome', 'principal', 'request_digest', 'timestamp', 'author_scope', 'company', 'scope', 'room', 'visibility', 'text'])('rejects inconsistent stored %s after nested digest rebinding', async target => {
  const value = initial(), item = value.items[1];
  if (target === 'action') item.receipt.action = 'owner_note.append';
  if (target === 'outcome') item.receipt.outcome = 'approved';
  if (target === 'principal') item.receipt.principal_id = 'private-author';
  if (target === 'request_digest') item.receipt.request_digest = '0'.repeat(64);
  if (target === 'timestamp') item.receipt.recorded_at_utc_epoch_ms++;
  if (target === 'author_scope') item.message.recorded_author.scope.id = 'beta';
  if (target === 'company') item.company_id = 'other-company';
  if (target === 'scope') item.scope.id = 'beta';
  if (target === 'room') item.conversation.id = '70000000-0000-4000-8000-000000000001';
  if (target === 'visibility') {item.conversation.visibility_revision = 2; item.message.visibility_revision = 2;}
  if (target === 'text') item.message.body += 'changed';
  bind(item); rehash(value); await reject(value);
});
it('uses response-derived append input for internal consistency only, without asserting independently retained append proof', async () => {
  const value = initial(), item = value.items[1]; item.message.body = 'A different self-consistent stored text'; bind(item, true); rehash(value);
  await expect(first(value)).resolves.toBeDefined();
});
it.each(['page', 'head', 'item', 'conversation', 'message'])('requires stored-record observation on %s', async target => {
  const value = initial(), item = value.items[1], observation = {source: 'synthetic_fixture', evidence_scope: 'synthetic_contract', live_verified: false};
  if (target === 'page') value.observation = observation;
  if (target === 'head') {value.watermark_head.observation = observation; rehash(value.watermark_head);}
  if (target === 'item') item.observation = observation;
  if (target === 'conversation') item.conversation.observation = observation;
  if (target === 'message') item.message.observation = observation;
  bind(item); rehash(value); await reject(value);
});
it.each(['empty_present', 'null_nonempty', 'null_anchor', 'empty_range', 'empty_more', 'initial_empty_continuation', 'premature_terminal', 'terminal_more', 'terminal_cursor', 'terminal_next', 'terminal_partial', 'total', 'extra', 'limit', 'item_short', 'byte_at_limit', 'item_over_limit'])('rejects invalid empty/terminal/coverage shape %s', async target => {
  const empty = target.startsWith('empty') || target === 'initial_empty_continuation', isTerminal = target.startsWith('terminal');
  const value = empty ? clone(fixtures[0].page) as Data : isTerminal ? terminal() : initial();
  const prior = isTerminal || target === 'initial_empty_continuation' ? (await first()).continuation! : undefined;
  const request = isTerminal || target === 'initial_empty_continuation' ? fixtures[2].request : {project_id: 'alpha', limit: value.requested_limit, cursor: null};
  if (target === 'empty_present') value.watermark_head = initial().watermark_head;
  if (target === 'null_nonempty') value.watermark_head = null;
  if (target === 'null_anchor') value.snapshot.watermark_message_ref = null;
  if (target === 'empty_range') value.range.start_sequence = 1;
  if (target === 'empty_more') {value.has_more = true; value.next_cursor = 'AA'; value.range.next_sequence = 1; value.coverage = {status: 'partial', truncation: 'item_limit', total_count: null};}
  if (target === 'premature_terminal') {value.has_more = false; value.next_cursor = null; value.range.next_sequence = null; value.coverage = {status: 'complete_for_cut', truncation: 'none', total_count: null};}
  if (target === 'terminal_more') {value.has_more = true; value.next_cursor = 'AA'; value.range.next_sequence = 1; value.coverage = {status: 'partial', truncation: 'item_limit', total_count: null};}
  if (target === 'terminal_cursor') value.next_cursor = 'AA';
  if (target === 'terminal_next') value.range.next_sequence = 1;
  if (target === 'terminal_partial') value.coverage.status = 'partial';
  if (target === 'total') value.coverage.total_count = 3;
  if (target === 'extra') value.grant = 'private';
  if (target === 'limit') value.limits.max_cursor_chars++;
  if (target === 'item_short') {value.items.pop(); value.range.end_sequence = 3; value.range.next_sequence = 2;}
  if (target === 'byte_at_limit') value.coverage.truncation = 'byte_limit';
  if (target === 'item_over_limit') value.requested_limit = 1;
  rehash(value); await reject(value, request, prior);
});
it('allows byte coverage only for a positive whole prefix shorter than min(start, limit)', async () => {
  const value = initial(); value.items.pop(); value.range.end_sequence = 3; value.range.next_sequence = 2; value.coverage.truncation = 'byte_limit'; rehash(value);
  await expect(first(value)).resolves.toMatchObject({page: {coverage: {truncation: 'byte_limit'}}, continuation: {nextSequence: 2}});
});
it('reproduces both exact producer byte-recipe hashes and traverses all12 escaped records without skipping byte omissions', async () => {
  const api = await load(), generated = byteRecipe(), recipe = generated.recipe;
  for (const [label, value] of [['first', generated.first], ['terminal', generated.terminal]] as const) {
    const raw = canonicalBytes(value); expect(raw.byteLength).toBe(label === 'first' ? recipe.first_bytes : recipe.terminal_bytes);
    expect(hash(raw)).toBe(label === 'first' ? recipe.first_sha256 : recipe.terminal_sha256);
  }
  for (const item of generated.items) {const raw = canonicalBytes(command(item)); expect(raw.byteLength).toBe(recipe.maximum_command_bytes); expect(() => parseOwnerDiscussionCommand(raw)).not.toThrow();}
  expect(canonicalBytes(generated.full).byteLength).toBeGreaterThan(recipe.maximum_response_bytes);
  const firstResult = await first(generated.first), prior = firstResult.continuation!;
  expect(prior.nextSequence).toBe(3); expect(prior.seenMessageIds).toHaveLength(9);
  const result = await api.validateOwnerDiscussionHistory(canonicalBytes(generated.terminal), context, {project_id: 'alpha', limit: 50, cursor: prior.nextCursor}, prior);
  expect([...firstResult.page.items, ...result.page.items].map(item => item.message.conversation_sequence)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  expect(result.continuation).toBeNull();
  await expect(api.validateOwnerDiscussionHistory(canonicalBytes(generated.full), context, {project_id: 'alpha', limit: 50, cursor: null})).rejects.toThrow('wire_limit');
});
it('accepts output262144, rejects262145 and preserves command32768', async () => {
  const api = await load(), value = initial(), raw = canonicalBytes(value);
  const padded = (bytes: Uint8Array, cap: number) => Buffer.concat([bytes, Buffer.alloc(cap - bytes.byteLength, 32)]);
  await expect(api.validateOwnerDiscussionHistory(padded(raw, 262144), context, fixtures[1].request)).resolves.toBeDefined();
  await expect(api.validateOwnerDiscussionHistory(padded(raw, 262145), context, fixtures[1].request)).rejects.toThrow('wire_limit');
  const commandRaw = canonicalBytes(command(value.items[0]));
  expect(() => parseOwnerDiscussionCommand(padded(commandRaw, 32768))).not.toThrow(); expect(() => parseOwnerDiscussionCommand(padded(commandRaw, 32769))).toThrow('wire_limit');
});
it.each([
  ['duplicate', '{"schema_version":1,"schema_version":1}'], ['bom', '\ufeff{}'], ['surrogate', '{"body":"\\ud800"}'],
  ['float', '{"schema_version":1.0}'], ['exponent', '{"schema_version":1e0}'], ['negative zero', '{"schema_version":-0}'],
  ['unsafe integer', '{"schema_version":9007199254740992}'], ['trailing', '{}x'], ['depth', '['.repeat(66) + '0' + ']'.repeat(66)],
])('rejects strict codec %s', async (_name, source) => {
  const api = await load(); await expect(api.validateOwnerDiscussionHistory(new TextEncoder().encode(source), context, fixtures[1].request)).rejects.toThrow();
});
it('rejects invalid UTF8 and nonbyte input with fixed bounded errors', async () => {
  const api = await load();
  await expect(api.validateOwnerDiscussionHistory(new Uint8Array([0xc0, 0xaf]), context, fixtures[1].request)).rejects.toThrow('invalid_utf8');
  await expect(api.validateOwnerDiscussionHistory('private-value' as any, context, fixtures[1].request)).rejects.toThrow('invalid_json_type');
  const hostile = {get company_id() {throw new Error('private-wire-secret');}};
  expect(() => api.normalizeOwnerDiscussionHistoryRequest(hostile as any)).toThrow('read_context');
});
it('rejects producer error envelopes as successful history pages', async () => {
  for (const error of examples.errors) await reject(error.value);
});
