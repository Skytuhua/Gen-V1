import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import examples from '../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/examples.json';
import manifest from '../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/manifest.json';

type Data = Record<string, any>;
const load = () => import('../../packages/company-contracts/communications/owner-discussion-stream.ts');
const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
const fixtures = examples.examples as Data[];
const clone = <T>(value: T): T => structuredClone(value);
const hash = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
const rehash = (value: Data) => {value.digest = hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest')))); return value;};
const ref = (record: Data) => ({kind: record.record_type, id: record.id, company_id: record.company_id, scope: clone(record.scope), availability: 'available', revision: record.revision, digest: record.digest, unavailable_reason: null});
function bind(item: Data) {
  const record = item.record; rehash(record.conversation); record.receipt.conversation_ref = ref(record.conversation);
  record.message.conversation_ref = clone(record.receipt.conversation_ref); rehash(record.message); record.receipt.message_ref = ref(record.message);
  const command = {schema_version: 1, action: record.receipt.action, command_id: record.receipt.command_id, summary: record.message.summary, body: record.message.body};
  record.receipt.request_digest = hash(canonicalBytes({contract: 'maritime-owner-discussion', version: 1, ...context, command}));
  rehash(record); item.event.conversation_ref = clone(record.receipt.conversation_ref); item.event.message_ref = clone(record.receipt.message_ref);
  for (const key of ['action', 'principal_id', 'command_id', 'request_digest']) item.event.accepted_command[key] = record.receipt[key];
  rehash(item.event); return rehash(item);
}
const page = (n: number) => clone(fixtures[n].page) as Data;
const frozen = (value: unknown): void => {if (value && typeof value === 'object') {expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(frozen);}};
async function start() {
  const api = await load();
  return api.validateOwnerDiscussionSnapshot(canonicalBytes(page(0)), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 1));
}
async function baseline() {
  const api = await load(), initial = await start();
  return api.validateOwnerDiscussionSnapshot(canonicalBytes(page(1)), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 1, initial.state.nextCursor), initial.state as any);
}
async function through(n: number) {
  const api = await load(); let result: any = await baseline();
  for (let index = 2; index <= n; index++) result = await api.validateOwnerDiscussionChanges(canonicalBytes(page(index)), context,
    api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, result.state.nextCursor), result.state);
  return result;
}

it('pins the exact stream tuple and byte-preserved assets/imports', async () => {
  const {OWNER_DISCUSSION_STREAM_PIN: pin} = await load();
  expect(pin).toMatchObject({contract: manifest.contract, version: manifest.version, backendCheckpoint: '10bc0d8d20ba55f95130bdb0724800850cbb0c06',
    manifestSHA256: '173f068fc1a01ad5e01c8f4a2d035a324ccc66508ee20af5cb612dbf55b6de30', schemaSHA256: manifest.assets[0].sha256,
    examplesSHA256: manifest.assets[1].sha256, maximumRawBytes: 262144, maximumEventBytes: 65536, maximumItems: 50, maximumCursorChars: 4096, executable: false});
  expect(hash(readFileSync(new URL('../../packages/company-contracts/communications/owner-discussion-stream-candidate.1/manifest.json', import.meta.url)))).toBe(pin.manifestSHA256);
  for (const asset of [...manifest.assets, ...manifest.frozen_imports]) expect(hash(readFileSync(new URL('../../packages/company-contracts/' + asset.path.replace('contracts/', ''), import.meta.url)))).toBe(asset.sha256);
  frozen(pin);
});
it('normalizes only explicit snapshot/changes operations and opaque canonical tokens', async () => {
  const api = await load(), expected = clone(context), request = api.normalizeOwnerDiscussionStreamRequest('snapshot', expected);
  expected.scope.id = 'beta'; expect(request).toEqual({operation: 'snapshot', project_id: 'alpha', limit: 20, cursor: null}); frozen(request);
  for (const limit of [1, 50]) expect(api.normalizeOwnerDiscussionStreamRequest('changes', context, limit, '_w').cursor).toBe('_w');
  for (const limit of [0, 51, 1.2, NaN, Infinity, '1', true, null]) expect(() => api.normalizeOwnerDiscussionStreamRequest('snapshot', context, limit as any)).toThrow();
  for (const cursor of ['', 'A', 'AB', 'AAB', 'AA=', '+w', 'AA\n', 'AAA\n', 'AAA\r', 'A'.repeat(4097), 3]) expect(() => api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 20, cursor as any)).toThrow();
  expect(() => api.normalizeOwnerDiscussionStreamRequest('changes', context)).toThrow();
  expect(() => api.normalizeOwnerDiscussionStreamRequest('other' as any, context)).toThrow();
  for (const id of ['Alpha', 'company-ops', '%61lpha', 'alpha/beta', 'alpha\n']) expect(() => api.normalizeOwnerDiscussionStreamRequest('snapshot', {...context, scope: {kind: 'project', id}})).toThrow();
});
it('validates every pinned producer page, complete baseline handoff, ascending changes and idle', async () => {
  const api = await load(); let result: any;
  for (let n = 0; n <= 5; n++) {
    const value = page(n), raw = canonicalBytes(value);
    expect(raw.byteLength).toBe(fixtures[n].canonical_utf8_bytes); expect(hash(raw)).toBe(fixtures[n].canonical_sha256);
    const request = api.normalizeOwnerDiscussionStreamRequest(n < 2 ? 'snapshot' : 'changes', context, 1, result?.state.nextCursor ?? null);
    result = n < 2 ? await api.validateOwnerDiscussionSnapshot(raw, context, request, result?.state) : await api.validateOwnerDiscussionChanges(raw, context, request, result.state);
    expect(canonicalBytes(result.page)).toEqual(raw); frozen(result);
    expect(result.state.mode).toBe(n === 0 ? 'snapshot' : 'changes');
    if (n === 0) expect((result.state as any).position).toBeUndefined();
    if (n >= 1) expect(result.state.baseline.map((x: Data) => x.message.conversation_sequence)).toEqual([2, 1]);
    if (n >= 2) expect(result.applied).toHaveLength(n === 5 ? 0 : 1);
  }
});
it('replays an older cursor with changed observed boundary, projects once and never rolls back', async () => {
  const api = await load(), old = (await baseline()).state as any, latest = await through(4);
  const replay = await api.validateOwnerDiscussionChanges(canonicalBytes(page(6)), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, old.nextCursor), old);
  expect(replay.page.digest).not.toBe(page(2).digest); expect(replay.page.items[0]).toEqual(page(2).items[0]);
  const merged = await api.projectOwnerDiscussionChanges(latest.state, replay);
  expect(merged.applied).toEqual([]); expect(merged.state).toEqual(latest.state); frozen(merged);
  const once = await api.projectOwnerDiscussionChanges(old, replay); expect(once.applied).toHaveLength(1);
  const twice = await api.projectOwnerDiscussionChanges(once.state, replay); expect(twice.applied).toEqual([]);
  const idle = await through(5), idleProjection = await api.projectOwnerDiscussionChanges(latest.state, idle);
  expect(idleProjection.applied).toEqual([]); expect(idleProjection.state).toEqual(latest.state);
});
it('rejects cross-page, query, context, range and immutable snapshot changes even with rehashed page', async () => {
  const api = await load(), old = (await baseline()).state as any;
  const request = api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, old.nextCursor);
  const mutations = [(v: Data) => {v.snapshot.incarnation = '20000000-0000-4000-8000-000000000999';},
    (v: Data) => {v.snapshot.coverage_floor.message_ref.digest = '0'.repeat(64);}, (v: Data) => {v.requested_limit = 2;},
    (v: Data) => {v.range.after_position = 0;}, (v: Data) => {v.range.end_position = 9;}, (v: Data) => {v.range.observed_through_position = 0;},
    (v: Data) => {v.caught_up = false;}, (v: Data) => {v.items[0].event.stream_epoch = '20000000-0000-4000-8000-000000000999';},
    (v: Data) => {v.items[0].event.message_ref.digest = '0'.repeat(64);}, (v: Data) => {v.scope.id = 'beta';},
    (v: Data) => {v.items[0].record.message.recorded_author.scope.id = 'beta';}];
  for (const mutate of mutations) {const value = page(2); mutate(value); await expect(api.validateOwnerDiscussionChanges(canonicalBytes(rehash(value)), context, request, old)).rejects.toThrow();}
  await expect(api.validateOwnerDiscussionChanges(canonicalBytes(page(2)), context, {...request, cursor: 'AA'}, old)).rejects.toThrow();
  await expect(api.validateOwnerDiscussionChanges(canonicalBytes(page(2)), {...context, company_id: 'other'}, request, old)).rejects.toThrow();
});
for (const vector of examples.mutation_vectors) it(`rejects pinned mutation ${vector.reason}`, async () => {
  const api = await load(), n = vector.example, value = page(n);
  const parts = vector.pointer.slice(1).split('/'); let parent: any = value;
  for (const key of parts.slice(0, -1)) parent = parent[key]; parent[parts.at(-1)!] = vector.value;
  rehash(value);
  const prior: any = n === 0 ? undefined : n === 1 ? (await start()).state : (await baseline()).state;
  const request = api.normalizeOwnerDiscussionStreamRequest(n < 2 ? 'snapshot' : 'changes', context, 1, prior?.nextCursor ?? null);
  await expect(n < 2 ? api.validateOwnerDiscussionSnapshot(canonicalBytes(value), context, request, prior) : api.validateOwnerDiscussionChanges(canonicalBytes(value), context, request, prior)).rejects.toThrow();
});
it('rejects incomplete baseline handoff, floor/watermark/event anchors and head substitution', async () => {
  const api = await load(), request = api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 1);
  const mutations = [(v: Data) => {v.changes_cursor = 'AA';}, (v: Data) => {v.snapshot.watermark.event_ref.digest = '0'.repeat(64);},
    (v: Data) => {v.snapshot.watermark.message_ref.digest = '0'.repeat(64);}, (v: Data) => {v.snapshot.coverage_floor.sequence = 0;},
    (v: Data) => {v.room_head.revision = 3;}, (v: Data) => {v.range.start_sequence = 1;}];
  for (const mutate of mutations) {const value = page(0); mutate(value); await expect(api.validateOwnerDiscussionSnapshot(canonicalBytes(rehash(value)), context, request)).rejects.toThrow();}
  const initial = await start();
  await expect(api.validateOwnerDiscussionChanges(canonicalBytes(page(2)), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, 'AA'), initial.state as any)).rejects.toThrow();
});
it('captures all caller data before the first await and rejects malformed local state synchronously', async () => {
  const api = await load(), expected = clone(context), prior: any = clone((await baseline()).state), request = clone(api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, prior.nextCursor)), raw = canonicalBytes(page(2));
  const pending = api.validateOwnerDiscussionChanges(raw, expected, request, prior);
  expected.scope.id = 'beta'; Object.assign(request, {limit: 50}); raw.fill(0); prior.baseline[0].message.body = 'private'; prior.snapshot.id = 'private';
  const result = await pending; expect(result.state.context).toEqual(context); expect(result.page.items[0].record.message.body).toBe(page(2).items[0].record.message.body);
  const captured: any = api.captureOwnerDiscussionStreamState(result.state, context); frozen(captured);
  for (const mutate of [(v: Data) => {v.extra = true;}, (v: Data) => {v.position++;}, (v: Data) => {v.baseline.pop();}, (v: Data) => {v.seenEvents[0].sequence++;}, (v: Data) => {v.nextCursor = 'AB';}]) {
    const value = clone(captured); mutate(value); expect(() => api.captureOwnerDiscussionStreamState(value, context)).toThrow();
  }
});
it('rejects malformed raw JSON, canonical overflow and EventItem overflow without advancing input', async () => {
  const api = await load(), prior = (await baseline()).state as any, before = clone(prior), request = api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, prior.nextCursor);
  for (const raw of [new Uint8Array(262145), new Uint8Array([255]), new TextEncoder().encode('{"a":1,"a":2}'), new TextEncoder().encode('{"a":1e1}'), new TextEncoder().encode('{"a":"\\ud800"}')]) {
    await expect(api.validateOwnerDiscussionChanges(raw, context, request, prior)).rejects.toThrow(); expect(prior).toEqual(before);
  }
  const value = page(2); value.items[0].record.message.body = '\u0001'.repeat(12000);
  await expect(api.validateOwnerDiscussionChanges(canonicalBytes(rehash(value)), context, request, prior)).rejects.toThrow();
});
it('revalidates purported projection results and rejects forged state, gaps and identity conflicts', async () => {
  const api = await load(), first = await through(2), latest = await through(4), old = (await baseline()).state as any;
  for (const mutate of [(v: Data) => {v.page.items[0].event.digest = '0'.repeat(64);}, (v: Data) => {v.state.position++;}, (v: Data) => {v.page.items[0].record.message.body = 'forged';}]) {
    const value = clone(first); mutate(value); await expect(api.projectOwnerDiscussionChanges(latest.state, value)).rejects.toThrow();
  }
  await expect(api.projectOwnerDiscussionChanges(old, latest)).rejects.toThrow();
  const conflict: any = clone(latest.state); conflict.seenEvents[0].digest = '0'.repeat(64);
  await expect(api.projectOwnerDiscussionChanges(conflict, first)).rejects.toThrow();
  const changed = page(2); changed.items[0].event.id = '30000000-0000-4000-8000-000000000999'; rehash(changed.items[0].event); rehash(changed.items[0]); rehash(changed);
  const divergent = await api.validateOwnerDiscussionChanges(canonicalBytes(changed), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 1, old.nextCursor), old);
  await expect(api.projectOwnerDiscussionChanges(latest.state, divergent)).rejects.toThrow('event_conflict');
});
it('accepts floor0 and W0 cuts while requiring both exact historical floor anchors', async () => {
  const api = await load();
  for (const zero of ['floor', 'watermark']) {
    const initial = page(0), terminal = page(1), snapshot = clone(initial.snapshot);
    if (zero === 'watermark') {
      snapshot.coverage_floor = {sequence: 2, conversation_ref: snapshot.watermark.conversation_ref, message_ref: snapshot.watermark.message_ref};
      snapshot.watermark.position = 0; snapshot.watermark.event_ref = null;
    } else {
      snapshot.coverage_floor = {sequence: 0, conversation_ref: null, message_ref: null}; snapshot.watermark.position = 2;
      const event = clone(page(2).items[0]); event.record = clone(initial.items[0]); event.event.id = snapshot.watermark.event_ref.id; event.event.sequence = 2; bind(event);
      snapshot.watermark.event_ref.digest = event.event.digest;
    }
    initial.snapshot = snapshot; terminal.snapshot = clone(snapshot); rehash(initial); rehash(terminal);
    const first = await api.validateOwnerDiscussionSnapshot(canonicalBytes(initial), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 1));
    const result = await api.validateOwnerDiscussionSnapshot(canonicalBytes(terminal), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 1, first.state.nextCursor), first.state as any);
    expect(result.state.mode).toBe('changes'); expect((result.state as any).position).toBe(zero === 'watermark' ? 0 : 2);
  }
});
it('replays a full immutable overlap plus newly committed tail once', async () => {
  const api = await load(), cut = page(0); Object.assign(cut, {requested_limit: 2, items: [...cut.items, ...page(1).items], has_more: false,
    next_snapshot_cursor: null, changes_cursor: page(1).changes_cursor, range: {start_sequence: 2, end_sequence: 1, next_sequence: null}, coverage: {status: 'complete_for_cut', truncation: 'none', total_count: null}});
  const old = (await api.validateOwnerDiscussionSnapshot(canonicalBytes(rehash(cut)), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 2))).state as any;
  const first = page(2); Object.assign(first, {requested_limit: 2, next_cursor: 'Ag'});
  const latest = await api.validateOwnerDiscussionChanges(canonicalBytes(rehash(first)), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 2, old.nextCursor), old);
  const replay = clone(first); replay.items.push(page(3).items[0]); replay.range.end_position = 3; replay.range.observed_through_position = 3; replay.next_cursor = 'Aw';
  const validated = await api.validateOwnerDiscussionChanges(canonicalBytes(rehash(replay)), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 2, old.nextCursor), old);
  const projected = await api.projectOwnerDiscussionChanges(latest.state, validated);
  expect(projected.applied.map(item => item.event.sequence)).toEqual([3]); expect(projected.state.position).toBe(3); expect(projected.state.seenEvents).toHaveLength(2);
});
it('keeps whole escaped byte-limited prefixes, enforces raw262144 and rejects oversized events', async () => {
  const api = await load(), cut = page(0); Object.assign(cut, {requested_limit: 50, items: [...cut.items, ...page(1).items], has_more: false,
    next_snapshot_cursor: null, changes_cursor: page(1).changes_cursor, range: {start_sequence: 2, end_sequence: 1, next_sequence: null}, coverage: {status: 'complete_for_cut', truncation: 'none', total_count: null}});
  const old = (await api.validateOwnerDiscussionSnapshot(canonicalBytes(rehash(cut)), context, api.normalizeOwnerDiscussionStreamRequest('snapshot', context, 50))).state as any;
  const items = Array.from({length: 12}, (_, index) => {
    const item = clone(page(2).items[0]), n = index + 3, suffix = String(n).padStart(12, '0');
    item.record.conversation.revision = n; Object.assign(item.record.message, {id: `40000000-0000-4000-8000-${suffix}`, conversation_sequence: n, summary: 'é'.repeat(512), body: '\u0001'.repeat(4000)});
    item.record.receipt.command_id = `50000000-0000-4000-8000-${suffix}`; item.event.id = `60000000-0000-4000-8000-${suffix}`; item.event.sequence = n - 1; return bind(item);
  });
  const first = page(2); Object.assign(first, {requested_limit: 50, items: items.slice(0, 8), caught_up: false, next_cursor: 'Ag',
    range: {after_position: 1, start_position: 2, end_position: 9, observed_through_position: 13}, coverage: {status: 'partial', truncation: 'byte_limit', total_count: null}}); rehash(first);
  expect(canonicalBytes(first).byteLength).toBeLessThan(262144); expect(canonicalBytes({...first, items}).byteLength).toBeGreaterThan(262144);
  const query = api.normalizeOwnerDiscussionStreamRequest('changes', context, 50, old.nextCursor);
  const padded = Buffer.concat([canonicalBytes(first), Buffer.alloc(262144 - canonicalBytes(first).byteLength, 32)]);
  const accepted = await api.validateOwnerDiscussionChanges(padded, context, query, old); expect(accepted.state.position).toBe(9);
  await expect(api.validateOwnerDiscussionChanges(Buffer.concat([padded, Buffer.from(' ')]), context, query, old)).rejects.toThrow('wire_limit');
  const terminal = page(2); Object.assign(terminal, {requested_limit: 50, items: items.slice(8), next_cursor: 'Aw', range: {after_position: 9, start_position: 10, end_position: 13, observed_through_position: 13}}); rehash(terminal);
  const completed = await api.validateOwnerDiscussionChanges(canonicalBytes(terminal), context, api.normalizeOwnerDiscussionStreamRequest('changes', context, 50, accepted.state.nextCursor), accepted.state);
  expect(completed.state.seenEvents.map(item => item.event.sequence)).toEqual(Array.from({length: 12}, (_, i) => i + 2));
  const oversized = clone(first); oversized.items = [clone(items[0])]; oversized.items[0].record.message.body = '\u0001'.repeat(8192);
  oversized.items[0].record.message.summary = '\u0001'.repeat(1024); oversized.items[0].record.conversation.title = '\u0001'.repeat(1024);
  expect(canonicalBytes(oversized.items[0]).byteLength).toBeGreaterThan(65536); rehash(oversized);
  // This deliberately oversized object also violates the frozen fixed title;
  // the closed schema may reject it before the supplemental event byte guard.
  await expect(api.validateOwnerDiscussionChanges(canonicalBytes(oversized), context, query, old)).rejects.toThrow();
});
