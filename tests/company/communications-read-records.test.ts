import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {canonicalBytes, decodeJson} from '../../packages/company-contracts/communications/index.ts';
import manifest from '../../packages/company-contracts/communications/reads-candidate.1/manifest.json';
import golden from '../../packages/company-contracts/communications/reads-candidate.1/golden.json';

type Kind = 'Conversation' | 'Message' | 'ConversationPage' | 'MessagePage';
type ObjectValue = Record<string, any>;
const fixtures = golden as unknown as {
  examples: Record<string, {schema: Kind; value: ObjectValue}>;
  cases: {name: string; base: string; set: Record<string, unknown>; recompute_own_digest: boolean; expected_read_context?: any; expected: {schema: boolean; supplemental: string}}[];
  raw_vectors: {name: string; raw_utf8?: string; raw_hex?: string; error: string}[];
  generated_vectors: {name: string; base: string; recipe: ObjectValue; expected: ObjectValue}[];
};
const load = () => import('../../packages/company-contracts/communications/reads.ts');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const ownDigest = (value: ObjectValue) => hash(canonicalBytes(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'))));
const context = (value: ObjectValue) => ({company_id: value.company_id, scope: structuredClone(value.scope)});
function mutate(value: ObjectValue, pointer: string, replacement: unknown) {
  const keys = pointer.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
  let parent = value;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  parent[keys.at(-1)!] = structuredClone(replacement);
}
function generated(base: string, recipe: ObjectValue) {
  const value = structuredClone(fixtures.examples[base].value);
  if (recipe.operation === 'repeat_text') {
    mutate(value, recipe.pointer, recipe.text.repeat(recipe.count));
    if (recipe.recompute_own_digest) value.digest = ownDigest(value);
  } else {
    value.items = Array.from({length: recipe.item_count}, (_, index) => {
      const item = structuredClone(fixtures.examples.message_present.value);
      item.id = '00000000-0000-4000-8000-' + (index + 1).toString(16).padStart(12, '0');
      item.conversation_sequence = index + 1; item.body = recipe.body_text.repeat(recipe.body_repeat);
      item.digest = ownDigest(item); return item;
    });
    value.digest = ownDigest(value);
  }
  const canonical = canonicalBytes(value);
  const raw = recipe.target_raw_bytes === undefined ? canonical : Buffer.concat([canonical, Buffer.alloc(recipe.target_raw_bytes - canonical.length, 32)]);
  return {value, canonical, raw};
}

describe('pinned output-only communication read records', () => {
  it('preserves the committed raw bundle and its exact subordinate file hashes', async () => {
    const api = await load(), root = new URL('../../packages/company-contracts/communications/reads-candidate.1/', import.meta.url);
    expect(hash(readFileSync(new URL('manifest.json', root)))).toBe(api.COMMUNICATION_READ_PIN.manifestSHA256);
    for (const [path, digest] of Object.entries(manifest.files)) expect(hash(readFileSync(new URL(path, root)))).toBe(digest);
  });
  for (const [name, example] of Object.entries(fixtures.examples)) it(`example: ${name}`, async () => {
    const {validateReadOutput} = await load();
    const value = await validateReadOutput(example.schema, bytes(example.value), context(example.value));
    expect(canonicalBytes(value)).toEqual(canonicalBytes(example.value));
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.observation)).toBe(true);
  });
  for (const vector of fixtures.cases) it(`shared case: ${vector.name}`, async () => {
    const {validateReadOutput} = await load();
    const base = fixtures.examples[vector.base], value = structuredClone(base.value);
    for (const [pointer, replacement] of Object.entries(vector.set)) mutate(value, pointer, replacement);
    if (vector.recompute_own_digest && value.digest !== null) value.digest = ownDigest(value);
    const result = validateReadOutput(base.schema, bytes(value), vector.expected_read_context ?? context(value));
    if (vector.expected.schema && vector.expected.supplemental === 'accept') await expect(result).resolves.toBeDefined();
    else if (vector.expected.schema) await expect(result).rejects.toThrow(vector.expected.supplemental);
    else await expect(result).rejects.toThrow();
  });
  for (const vector of fixtures.raw_vectors) it(`raw lexical rejection: ${vector.name}`, async () => {
    const {validateReadOutput} = await load();
    const raw = vector.raw_hex ? Buffer.from(vector.raw_hex, 'hex') : new TextEncoder().encode(vector.raw_utf8!);
    await expect(validateReadOutput('Message', raw, context(fixtures.examples.message_present.value))).rejects.toThrow(vector.error);
  });
  for (const vector of fixtures.generated_vectors) it(`generated boundary: ${vector.name}`, async () => {
    const {validateReadOutput} = await load(), {value, canonical, raw} = generated(vector.base, vector.recipe);
    expect(raw.byteLength).toBe(vector.expected.raw_bytes);
    expect(hash(raw)).toBe(vector.expected.raw_sha256);
    expect(hash(canonical)).toBe(vector.expected.canonical_sha256);
    const result = validateReadOutput(fixtures.examples[vector.base].schema, raw, context(value));
    if (vector.expected.output_boundary === 'wire_limit') await expect(result).rejects.toThrow('wire_limit');
    else if (vector.expected.schema && vector.expected.supplemental === 'accept') await expect(result).resolves.toBeDefined();
    else if (vector.expected.schema) await expect(result).rejects.toThrow(vector.expected.supplemental);
    else await expect(result).rejects.toThrow();
    if (raw.byteLength > 32768) expect(() => decodeJson(raw)).toThrow('wire_limit');
  });
  it('requires explicit matching company/scope context and reports no submitted content', async () => {
    const {validateReadOutput} = await load(), value = structuredClone(fixtures.examples.message_present.value);
    value.body = 'PRIVATE_SENTINEL'; value.digest = ownDigest(value);
    const request = validateReadOutput('Message', bytes(value), {company_id: 'another-company', scope: {kind: 'project', id: 'alpha'}});
    await expect(request).rejects.toThrow('company_mismatch');
    await request.catch(error => expect(String(error)).not.toContain('PRIVATE_SENTINEL'));
    await expect(validateReadOutput('Message', bytes(value), undefined as any)).rejects.toThrow('read_context');
  });
  it('rejects unknown versions and output kinds without enabling a fallback', async () => {
    const {validateReadOutput} = await load(), value = structuredClone(fixtures.examples.message_present.value);
    value.schema_version = 2;
    await expect(validateReadOutput('Message', bytes(value), context(value))).rejects.toThrow();
    await expect(validateReadOutput('Decision' as Kind, bytes(value), context(value))).rejects.toThrow();
  });
  it('checks included reply-reference revisions and digests independently of valid outer hashes', async () => {
    const {validateReadOutput} = await load(), page = structuredClone(fixtures.examples.message_page_partial.value);
    const first = page.items[0], second = structuredClone(first);
    second.id = '44444444-4444-4444-8444-444444444444'; second.conversation_sequence = 2;
    second.reply_to_message_ref = {kind: 'message', id: first.id, company_id: first.company_id, scope: first.scope, availability: 'available', revision: first.revision, digest: first.digest, unavailable_reason: null};
    second.digest = ownDigest(second); page.items.push(second); page.digest = ownDigest(page);
    await expect(validateReadOutput('MessagePage', bytes(page), context(page))).resolves.toBeDefined();
    second.reply_to_message_ref.revision = 2; second.digest = ownDigest(second); page.digest = ownDigest(page);
    await expect(validateReadOutput('MessagePage', bytes(page), context(page))).rejects.toThrow('reference_mismatch');
  });
  it('returns deeply immutable data and preserves partial/unavailable semantics', async () => {
    const {validateReadOutput} = await load(), sample = fixtures.examples.message_page_partial.value;
    const page = await validateReadOutput('MessagePage', bytes(sample), context(sample));
    expect(Object.isFrozen(page.items)).toBe(true); expect(Object.isFrozen(page.items[0].recorded_author)).toBe(true);
    expect(page.next_cursor).toBeNull(); expect(page.coverage.status).toBe('partial'); expect(page.observation.live_verified).toBe(false);
  });
});
