import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import type {ConversationContext, ConversationMessage} from '../packages/contracts/conversation-read-models.ts';

const context: ConversationContext = {authority: 'personal', owner: {threadId: 'main', title: 'Actual draft', projectId: 'project', projectName: 'Project', epoch: 7, runId: null, status: 'ready', modelId: 'test/model'}, scopeKey: 'a'.repeat(64), revision: 'b'.repeat(64), sequence: 10, readOnly: false, archived: false, includeArchived: false, researchEligible: true, checkpoint: 'signed-checkpoint'};
const message: ConversationMessage = {id: 'message', threadId: 'main', role: 'assistant', createdAt: '2026-11-06T00:00:00Z', runId: 'old-run', revision: 'c'.repeat(64), content: 'A😀', contentOffset: 0, contentLength: 3, nextContentCursor: 'signed-content'};
const envelope = {authority: 'personal', threadId: 'main', scopeKey: context.scopeKey, sequence: 10};
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

it('uses authenticated no-store GETs for the exact owner, bounded pages, content and scoped updates', async () => {
  const calls: {url: string; options?: RequestInit}[] = []; let expired = true;
  const signal = new AbortController().signal;
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push({url, options});
    if (url === '/api/bootstrap') return Response.json({csrfToken: 'token'});
    if (expired) {expired = false; return Response.json({error: {code: 'AUTH_REQUIRED'}}, {status: 401});}
    if (url.includes('/transcript')) return Response.json({...envelope, messages: [message], nextCursor: 'signed-older'});
    if (url.includes('/content')) return Response.json({...envelope, message: {...message, content: 'B', contentOffset: 2, nextContentCursor: null}});
    if (url.includes('/updates')) return Response.json({...envelope, fromSequence: 10, owner: null, transcriptChanged: false, checkpoint: 'next-checkpoint'});
    return Response.json(context);
  }));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  expect(await api.getConversationContext({authority: 'personal', threadId: 'main'}, signal)).toEqual(context);
  expect((await api.getConversationHistory(context, {limit: 2, cursor: 'older & cursor'}, signal)).messages).toEqual([message]);
  expect((await api.getConversationContent(context, message, signal)).message.content).toBe('B');
  expect((await api.getConversationUpdates(context, signal)).checkpoint).toBe('next-checkpoint');
  expect(calls.filter(call => call.url === '/api/bootstrap')).toHaveLength(2);
  for (const call of calls.filter(call => call.url !== '/api/bootstrap')) {
    expect(call.url).toMatch(/^\/api\/conversations\/main(?:\?|\/)/);
    expect(call.options).toMatchObject({method: 'GET', cache: 'no-store', credentials: 'same-origin', signal});
    expect(new URL(call.url, 'http://local').searchParams.get('authority')).toBe('personal');
  }
  const params = new URL(calls.find(call => call.url.includes('/transcript'))!.url, 'http://local').searchParams;
  expect(params.get('cursor')).toBe('older & cursor'); expect(params.get('limit')).toBe('2'); expect(params.get('scopeKey')).toBe(context.scopeKey);
  expect(calls.some(call => /snapshot|\/api\/events|\/api\/agents|commands/.test(call.url))).toBe(false);
});

it.each([
  ['thread identity', {...context, owner: {...context.owner, threadId: 'other'}}],
  ['unknown private fields', {...context, owner: {...context.owner, sessionPath: 'PRIVATE'}}],
  ['missing epoch', {...context, owner: {...context.owner, epoch: undefined}}],
  ['false Research eligibility', {...context, readOnly: true}],
  ['wrong archive scope', {...context, includeArchived: true}],
] as const)('rejects an invalid context response: %s', async (_name, response) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/bootstrap' ? {csrfToken: 'token'} : response)));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationContext({authority: 'personal', threadId: 'main'})).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it.each([
  {...envelope, threadId: 'other', messages: [], nextCursor: null},
  {...envelope, scopeKey: 'd'.repeat(64), messages: [], nextCursor: null},
  {...envelope, sequence: 9, messages: [], nextCursor: null},
  {...envelope, messages: [{...message, threadId: 'other'}], nextCursor: null},
  {...envelope, messages: [message, message], nextCursor: null},
] as const)('rejects foreign, stale or duplicate transcript identities %#', async response => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/bootstrap' ? {csrfToken: 'token'} : response)));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationHistory(context)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it.each([
  {...message, content: 'B', contentOffset: 1, nextContentCursor: null},
  {...message, content: 'B', contentOffset: 2, revision: 'd'.repeat(64), nextContentCursor: null},
  {...message, content: 'B', contentOffset: 2, id: 'other', nextContentCursor: null},
  {...message, content: 'B', contentOffset: 2, contentLength: 4, nextContentCursor: null},
] as const)('rejects discontinuous or replaced content slices %#', async response => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/bootstrap' ? {csrfToken: 'token'} : {...envelope, message: response})));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationContent(context, message)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it.each([
  {...envelope, fromSequence: 9, owner: null, transcriptChanged: false, checkpoint: 'next'},
  {...envelope, fromSequence: 10, owner: {...context, owner: {...context.owner, epoch: 8}}, transcriptChanged: false, checkpoint: 'next'},
] as const)('rejects updates from a different checkpoint or epoch %#', async response => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/bootstrap' ? {csrfToken: 'token'} : response)));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationUpdates(context)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('preserves scoped API errors and abort without falling back to a Snapshot', async () => {
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/bootstrap') return Response.json({csrfToken: 'token'});
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return Response.json({error: {code: 'RESYNC_REQUIRED', message: 'Reload context'}}, {status: 400});
  }));
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationHistory(context, {}, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
  await expect(api.getConversationHistory(context)).rejects.toMatchObject({code: 'RESYNC_REQUIRED'});
});

it('rejects history options that try to override the captured owner before any request', async () => {
  const fetch = vi.fn(async () => Response.json({csrfToken: 'token'})); vi.stubGlobal('fetch', fetch);
  const api = await import('../apps/web/src/conversation-read-api.ts');
  await expect(api.getConversationHistory(context, {threadId: 'other'} as never)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
