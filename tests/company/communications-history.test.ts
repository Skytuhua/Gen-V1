import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect, it} from 'vitest';
import {canonicalBytes, decodeJson} from '../../packages/company-contracts/communications/index.ts';
import manifest from '../../packages/company-contracts/communications/owner-note-history-candidate.1/manifest.json';
import golden from '../../packages/company-contracts/communications/owner-note-history-candidate.1/golden.json';
import readGolden from '../../packages/company-contracts/communications/reads-candidate.1/golden.json';

type ObjectValue = Record<string, any>;
const fixtures = golden as unknown as {examples: Record<string, ObjectValue>; mutations: {name: string; base: string; set: Record<string, unknown>; rehash_messages?: number[]; schema: boolean; supplemental?: boolean}[]; encoded_byte_recipe: ObjectValue};
const load = () => import('../../packages/company-contracts/communications/history.ts');
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const ownDigest = (value: ObjectValue) => hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'))));
const context = {company_id: 'leo-company', scope: {kind: 'project' as const, id: 'alpha'}};
function mutate(value: ObjectValue, pointer: string, replacement: unknown) {
  const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  let parent = value; for (const key of keys.slice(0, -1)) parent = parent[key];
  parent[keys.at(-1)!] = structuredClone(replacement);
}
function generatedHistory() {
  const value = structuredClone(fixtures.examples.two_historical_pairs), first = value.items[0];
  value.items = Array.from({length: 50}, (_, index) => {
    const sequence = 50 - index, pair = structuredClone(first);
    pair.conversation.revision = sequence; pair.conversation.digest = ownDigest(pair.conversation);
    pair.message.id = '00000000-0000-4000-8000-' + sequence.toString(16).padStart(12, '0');
    pair.message.conversation_sequence = sequence; pair.message.body = '\u0001'.repeat(8192);
    pair.message.conversation_ref.revision = sequence; pair.message.conversation_ref.digest = pair.conversation.digest;
    pair.message.digest = ownDigest(pair.message); return pair;
  });
  value.room_head = structuredClone(value.items[0].conversation); value.requested_limit = 50;
  value.digest = ownDigest(value); return value;
}

it('pins the raw additive bundle without changing the imported records contract', async () => {
  const api = await load(), base = new URL('../../packages/company-contracts/communications/owner-note-history-candidate.1/', import.meta.url);
  expect(hash(readFileSync(new URL('manifest.json', base)))).toBe(api.OWNER_NOTE_HISTORY_PIN.manifestSHA256);
  for (const file of manifest.files) {const raw = readFileSync(new URL(file.path, base)); expect(hash(raw)).toBe(file.sha256); expect(raw.byteLength).toBe(file.bytes);}
  expect(hash(readFileSync(new URL('../../packages/company-contracts/communications/reads-candidate.1/records.schema.json', import.meta.url)))).toBe(manifest.frozen_import.sha256);
});
for (const [name, value] of Object.entries(fixtures.examples)) it(`history example: ${name}`, async () => {
  const {validateOwnerNoteHistory} = await load();
  const result = await validateOwnerNoteHistory(canonicalBytes(value), context, value.requested_limit);
  expect(canonicalBytes(result)).toEqual(canonicalBytes(value)); expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.items)).toBe(true); expect(Object.isFrozen(result.coverage)).toBe(true);
});
for (const vector of fixtures.mutations) it(`history mutation: ${vector.name}`, async () => {
  const {validateOwnerNoteHistory} = await load(), value = structuredClone(fixtures.examples[vector.base]);
  for (const [pointer, replacement] of Object.entries(vector.set)) mutate(value, pointer, replacement);
  for (const index of vector.rehash_messages ?? []) value.items[index].message.digest = ownDigest(value.items[index].message);
  value.digest = ownDigest(value);
  await expect(validateOwnerNoteHistory(canonicalBytes(value), context, value.requested_limit)).rejects.toThrow();
});
for (const vector of readGolden.raw_vectors as {name: string; raw_hex?: string; raw_utf8?: string; error: string}[]) it(`history raw boundary: ${vector.name}`, async () => {
  const {validateOwnerNoteHistory} = await load();
  const raw = vector.raw_hex ? Buffer.from(vector.raw_hex, 'hex') : new TextEncoder().encode(vector.raw_utf8!);
  await expect(validateOwnerNoteHistory(raw, context, 20)).rejects.toThrow(vector.error);
});
it('reproduces encoded-byte recipes and preserves the separate command cap', async () => {
  const {validateOwnerNoteHistory} = await load(), recipe = fixtures.encoded_byte_recipe, full = generatedHistory();
  const fullRaw = canonicalBytes(full); expect(fullRaw.byteLength).toBe(recipe.full_50_pairs.raw_bytes); expect(hash(fullRaw)).toBe(recipe.full_50_pairs.sha256);
  await expect(validateOwnerNoteHistory(fullRaw, context, 50)).rejects.toThrow('wire_limit');
  const prefix = structuredClone(full); prefix.items = prefix.items.slice(0, recipe.retained_prefix_items); prefix.coverage.truncation = 'byte_limit'; prefix.digest = ownDigest(prefix);
  const raw = canonicalBytes(prefix); expect(raw.byteLength).toBe(recipe.retained_prefix.raw_bytes); expect(hash(raw)).toBe(recipe.retained_prefix.sha256);
  await expect(validateOwnerNoteHistory(raw, context, 50)).resolves.toBeDefined();
  expect(() => decodeJson(raw)).toThrow('wire_limit');
  for (const [key, accepted] of [['exact_raw_cap', true], ['one_raw_byte_over', false]] as const) {
    const expected = recipe[key], padded = Buffer.concat([raw, Buffer.alloc(expected.raw_bytes - raw.byteLength, 32)]);
    expect(hash(padded)).toBe(expected.sha256);
    const result = validateOwnerNoteHistory(padded, context, 50);
    if (accepted) await expect(result).resolves.toBeDefined(); else await expect(result).rejects.toThrow('wire_limit');
  }
});
it('binds the echoed limit to an independently retained query limit', async () => {
  const {validateOwnerNoteHistory} = await load(), raw = canonicalBytes(fixtures.examples.item_limited);
  await expect(validateOwnerNoteHistory(raw, context, 1)).resolves.toBeDefined();
  await expect(validateOwnerNoteHistory(raw, context, 20)).rejects.toMatchObject({code: 'limit_mismatch'});
  for (const limit of [0, 51, 1.5, NaN, undefined]) await expect(validateOwnerNoteHistory(raw, context, limit as number)).rejects.toThrow();
});
it('checks empty history against expected company/scope and fixed error privacy', async () => {
  const {validateOwnerNoteHistory} = await load(), raw = canonicalBytes(fixtures.examples.empty_observed);
  await expect(validateOwnerNoteHistory(raw, {...context, company_id: 'private-company'}, 20)).rejects.toMatchObject({code: 'company_mismatch'});
  const result = validateOwnerNoteHistory(raw, {...context, scope: {kind: 'project', id: 'private-project'}}, 20);
  await expect(result).rejects.toMatchObject({code: 'scope_mismatch'});
  await result.catch(error => expect(String(error)).not.toContain('private-project'));
});
it('rejects mismatched observation labels despite valid nested and outer digests', async () => {
  const {validateOwnerNoteHistory} = await load(), value = structuredClone(fixtures.examples.two_historical_pairs);
  value.items[1].message.observation = {source: 'stored_record', evidence_scope: 'stored_record', live_verified: false};
  value.items[1].message.digest = ownDigest(value.items[1].message); value.digest = ownDigest(value);
  await expect(validateOwnerNoteHistory(canonicalBytes(value), context, 20)).rejects.toMatchObject({code: 'observation_mismatch'});
});
it('rejects corrupt nested records independently of the aggregate digest', async () => {
  const {validateOwnerNoteHistory} = await load(), value = structuredClone(fixtures.examples.two_historical_pairs);
  value.items[1].message.body = 'Changed without a matching record digest'; value.digest = ownDigest(value);
  await expect(validateOwnerNoteHistory(canonicalBytes(value), context, 20)).rejects.toMatchObject({code: 'digest_mismatch'});
});
it.each([4096, 4097])('checks decoded UTF-8 bytes for a %s-character multibyte body', async count => {
  const {validateOwnerNoteHistory} = await load(), value = structuredClone(fixtures.examples.two_historical_pairs);
  value.items[1].message.body = '\u00e9'.repeat(count); value.items[1].message.digest = ownDigest(value.items[1].message); value.digest = ownDigest(value);
  const result = validateOwnerNoteHistory(canonicalBytes(value), context, value.requested_limit);
  if (count === 4096) await expect(result).resolves.toBeDefined(); else await expect(result).rejects.toMatchObject({code: 'text_byte_limit'});
});
it('snapshots expected scope before asynchronous record validation', async () => {
  const {validateOwnerNoteHistory} = await load(), expected = structuredClone(context), value = fixtures.examples.two_historical_pairs;
  const result = validateOwnerNoteHistory(canonicalBytes(value), expected, value.requested_limit);
  expected.scope.id = 'beta';
  await expect(result).resolves.toMatchObject({scope: context.scope});
});
