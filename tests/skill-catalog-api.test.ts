import {afterEach, expect, it, vi} from 'vitest';
import {getSkillCatalog, mergeSkillCatalogPages} from '../apps/web/src/skill-catalog-api';
vi.mock('../apps/web/src/api', () => ({authenticated: (action: () => unknown) => action(), read: async (response: Response) => response.json(), ApiError: class extends Error {constructor(public code: string, message: string) {super(message);}}}));
afterEach(() => vi.unstubAllGlobals());
const ref = {version: 1, scope: {kind: 'personal'}, sourceId: 'personal:test', skillId: 'one', locator: 'a'.repeat(64), revision: 'b'.repeat(64), digest: 'c'.repeat(64), sourceBinding: 'd'.repeat(64)};
const source = {id: 'personal:test', kind: 'personal', label: 'Personal', availability: {status: 'available'}};
const item = {id: 'one', sourceId: source.id, name: 'One', description: 'Description', files: 1, availability: {status: 'available'}, ref};
const page = () => ({scope: {kind: 'personal'}, sources: [source], skills: [item], inventoryRevision: 'e'.repeat(64), nextCursor: null});
it('reads scoped metadata with the exact query, cancellation and no-store', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(page()))); vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  expect(await getSkillCatalog({query: 'Test', threadId: 'thread', limit: 50}, controller.signal)).toEqual(page());
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(Object.fromEntries(new URL(url, 'http://localhost').searchParams)).toEqual({query: 'Test', threadId: 'thread', limit: '50'});
  expect(init).toMatchObject({credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
});
it.each(['provider', 'identity', 'missing-source', 'duplicate', 'available-without-reference'])('rejects malformed or foreign catalog responses: %s', async kind => {
  const value = page();
  if (kind === 'provider') value.scope = {kind: 'provider'};
  if (kind === 'identity') value.skills[0] = {...item, ref: {...ref, skillId: 'another'}};
  if (kind === 'missing-source') value.sources = [];
  if (kind === 'duplicate') value.skills.push(item);
  if (kind === 'available-without-reference') value.skills[0] = {...item, ref: null as never};
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(value)));
  await expect(getSkillCatalog({})).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});
it('requires stable inventory and unique entries while paging all installed skills', () => {
  const first = {...page(), nextCursor: 'next'}, second = {...page(), skills: [{...item, id: 'two', ref: {...ref, skillId: 'two'}}]};
  expect(mergeSkillCatalogPages(first as never, second as never).skills.map(item => item.id)).toEqual(['one', 'two']);
  expect(() => mergeSkillCatalogPages(first as never, {...second, inventoryRevision: 'f'.repeat(64)} as never)).toThrow();
  expect(() => mergeSkillCatalogPages(first as never, page() as never)).toThrow();
});
