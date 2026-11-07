import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createConversationReader} from '../apps/web/src/conversation-workspace/reader';
import {scopedContext as context, scopedSelection as selection, scopedEnvelope as envelope, scopedMessage as message} from './scoped-conversation-fixture';

const readers: ReturnType<typeof createConversationReader>[] = [];
const settle = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};
let route: (url: URL, signal?: AbortSignal | null) => unknown | Promise<unknown>;
let urls: string[];
beforeEach(() => {
  urls = [];
  route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: [message()], nextCursor: null} : url.pathname.endsWith('/updates') ? {...envelope, fromSequence: 10, owner: null, transcriptChanged: false, checkpoint: 'next'} : context;
  vi.stubGlobal('fetch', async (input: string, options?: RequestInit) => {
    if (input === '/api/bootstrap') return Response.json({csrfToken: 'synthetic'});
    urls.push(input);
    const result = await route(new URL(input, 'http://synthetic'), options?.signal);
    return result instanceof Response ? result : Response.json(result);
  });
});
afterEach(() => {readers.forEach(reader => reader.close()); readers.length = 0; vi.unstubAllGlobals(); vi.useRealTimers();});
function reader(onState?: NonNullable<Parameters<typeof createConversationReader>[0]>['onState']) {
  const value = createConversationReader({onState}); readers.push(value); return value;
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}

describe('scoped Personal reader', () => {
  it('acquires only the admitted exact real owner and publishes its actual context', async () => {
    const r = reader(); await r.select(selection);
    expect(r.getSnapshot()).toMatchObject({phase: 'ready', context, pending: false});
    expect(r.getSnapshot().messages[0].head).toEqual(message());
    expect(urls.every(url => url.startsWith('/api/conversations/exact-owner'))).toBe(true);
    expect(urls.some(url => /snapshot|events|inventory|agents|commands/.test(url))).toBe(false);
  });
  it('advances both sequence and checkpoint for owner:null on every update', async () => {
    route = url => url.pathname.endsWith('/updates') ? {...envelope, sequence: 12, fromSequence: Number(url.searchParams.get('checkpoint') === 'checkpoint-10' ? 10 : 12), owner: null, transcriptChanged: false, checkpoint: 'checkpoint-12'} : url.pathname.endsWith('/transcript') ? {...envelope, messages: [], nextCursor: null} : context;
    const r = reader(); await r.select(selection); await r.poll(); await r.poll();
    expect(r.getSnapshot().context).toMatchObject({sequence: 12, checkpoint: 'checkpoint-12', owner: {epoch: 37}});
    expect(new URL(urls.at(-1)!, 'http://synthetic').searchParams.get('checkpoint')).toBe('checkpoint-12');
  });
  it('prepends oldest-to-newest pages and deduplicates only identical message identities', async () => {
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: url.searchParams.has('cursor') ? [message('m1'), message('m2')] : [message('m2'), message('m3')], nextCursor: url.searchParams.has('cursor') ? null : 'older'} : context;
    const r = reader(); await r.select(selection); await r.loadOlder();
    expect(r.getSnapshot().messages.map(item => item.head.id)).toEqual(['m1', 'm2', 'm3']);
    expect(urls.filter(url => url.includes('/transcript')).every(url => new URL(url, 'http://synthetic').searchParams.get('limit') === '30')).toBe(true);
  });
  it('reads one pinned continuation at a time using Unicode code-point offsets', async () => {
    const head = {...message('long', 'A😀'), contentLength: 5, nextContentCursor: 'part-2'};
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: [head], nextCursor: null} : url.pathname.endsWith('/content') ? {...envelope, message: {...head, content: 'é𐐀', contentOffset: 2, nextContentCursor: null}} : context;
    const r = reader(); await r.select(selection); await r.loadContent('long');
    expect(r.getSnapshot().messages[0]).toMatchObject({head, text: 'A😀é𐐀', loadedCodePoints: 5, tail: {contentOffset: 2, revision: head.revision}});
    expect(urls.filter(url => url.includes('/content'))).toHaveLength(1);
  });
  it('clears context and text before reacquiring the same owner on resync', async () => {
    const states: {phase: string; context: unknown; count: number}[] = [];
    const next = deferred<unknown>(); let contexts = 0;
    route = url => url.pathname.endsWith('/updates') ? Response.json({error: {code: 'RESYNC_REQUIRED'}}, {status: 409}) : url.pathname.endsWith('/transcript') ? {...envelope, scopeKey: contexts > 1 ? 'd'.repeat(64) : context.scopeKey, messages: [message()], nextCursor: null} : ++contexts > 1 ? next.promise : context;
    const r = reader(state => states.push({phase: state.phase, context: state.context, count: state.messages.length}));
    await r.select(selection); const polling = r.poll(); await settle();
    expect(states).toContainEqual({phase: 'resync', context: null, count: 0});
    expect(r.getSnapshot().context).toBeNull();
    next.resolve({...context, owner: {...context.owner, epoch: 38}, scopeKey: 'd'.repeat(64)}); await polling;
    expect(r.getSnapshot().context?.owner.epoch).toBe(38);
    expect(urls.every(url => url.startsWith('/api/conversations/exact-owner'))).toBe(true);
  });
  it('aborts old owner reads and ignores a late response after canonical navigation and close', async () => {
    const late = deferred<unknown>(); let oldSignal: AbortSignal | null | undefined;
    route = (url, signal) => {if (url.pathname === '/api/conversations/exact-owner') {oldSignal = signal; return late.promise;} return {...context, owner: {...context.owner, threadId: 'second-owner'}};};
    const r = reader(); const first = r.select(selection); await settle();
    const second = r.select({target: {...selection.target, threadId: 'second-owner'}, navigationKey: 'admission-2'}); r.close();
    late.resolve(context); await Promise.all([first, second]);
    expect(oldSignal?.aborted).toBe(true); expect(r.getSnapshot()).toMatchObject({phase: 'closed', context: null, messages: []});
  });
  it.each(['CAPABILITY_DENIED', 'AUTH_REQUIRED'])('revokes context on %s without fallback', async code => {
    const r = reader(); await r.select(selection);
    route = () => Response.json({error: {code}}, {status: 403}); await r.poll();
    expect(r.getSnapshot()).toMatchObject({phase: 'revoked', context: null, messages: []});
  });
  it('rejects invalid admission before any read', async () => {
    const r = reader(); await r.select({target: {...selection.target, authority: 'company'}, navigationKey: 'wrong'} as never);
    expect(r.getSnapshot()).toMatchObject({phase: 'revoked', context: null}); expect(urls).toEqual([]);
  });
  it('rejects a foreign or invented owner context', async () => {
    route = () => ({...context, owner: {...context.owner, threadId: 'first-thread', epoch: undefined}});
    const r = reader(); await r.select(selection);
    expect(r.getSnapshot().context).toBeNull(); expect(r.getSnapshot().messages).toEqual([]);
  });
  it('rejects reordered update checkpoints and never publishes an older sequence', async () => {
    const r = reader(); await r.select(selection);
    route = () => ({...envelope, sequence: 9, fromSequence: 8, owner: null, checkpoint: 'stale', transcriptChanged: false});
    await r.poll(); expect(r.getSnapshot().context).toBeNull();
  });
  it('bounds pages even when an adversarial cursor repeats the same sparse page', async () => {
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: [message()], nextCursor: 'repeated'} : context;
    const r = reader(); await r.select(selection);
    for (let i = 0; i < 12; i++) await r.loadOlder();
    expect(urls.filter(url => url.includes('/transcript'))).toHaveLength(6);
    expect(r.getSnapshot().historyLimited).toBe(true);
  });
  it('bounds incremental Unicode content without fetching the entire message', async () => {
    const chunk = '😀'.repeat(4096), head = {...message('long', chunk), contentLength: 100_000, nextContentCursor: '4096'};
    route = url => {
      if (url.pathname.endsWith('/transcript')) return {...envelope, messages: [head], nextCursor: null};
      if (url.pathname.endsWith('/content')) {const offset = Number(url.searchParams.get('cursor')); return {...envelope, message: {...head, contentOffset: offset, nextContentCursor: String(offset + 4096)}};}
      return context;
    };
    const r = reader(); await r.select(selection);
    for (let i = 0; i < 25; i++) await r.loadContent('long');
    expect(r.getSnapshot().messages[0]).toMatchObject({loadedCodePoints: 65_536, limited: true});
    expect(urls.filter(url => url.includes('/content'))).toHaveLength(15);
    expect(r.getSnapshot().messages[0].head).toEqual(head);
  });
  it('clears old chunks on source edits and rejects a late continuation after refresh', async () => {
    const old = {...message('long', 'old'), contentLength: 6, nextContentCursor: 'old-part'}, late = deferred<unknown>();
    let changed = false, signal: AbortSignal | null | undefined;
    route = (url, nextSignal) => {
      if (url.pathname.endsWith('/transcript')) return {...envelope, sequence: changed ? 11 : 10, messages: [changed ? {...message('long', 'new text'), revision: 'd'.repeat(64)} : old], nextCursor: null};
      if (url.pathname.endsWith('/content')) {signal = nextSignal; return late.promise;}
      if (url.pathname.endsWith('/updates')) {changed = true; return {...envelope, fromSequence: 10, sequence: 11, owner: null, checkpoint: 'cp11', transcriptChanged: true};}
      return context;
    };
    const r = reader(); await r.select(selection); const pending = r.loadContent('long'); await settle(); await r.poll();
    late.resolve({...envelope, message: {...old, content: 'end', contentOffset: 3, nextContentCursor: null}}); await pending;
    expect(signal?.aborted).toBe(true); expect(r.getSnapshot().messages[0].text).toBe('new text');
    expect(r.getSnapshot().messages[0].head.revision).toBe('d'.repeat(64));
  });
  it('rejects conflicting duplicate IDs instead of merging different originals', async () => {
    let contexts = 0;
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: [url.searchParams.has('cursor') ? {...message(), revision: 'd'.repeat(64)} : message()], nextCursor: 'older'} : ++contexts > 1 ? Response.json({error: {code: 'CAPABILITY_DENIED'}}, {status: 403}) : context;
    const r = reader(); await r.select(selection); await r.loadOlder();
    expect(r.getSnapshot()).toMatchObject({phase: 'revoked', context: null, messages: []});
  });
  it('keeps the loaded history window in order on transcript refresh', async () => {
    let changed = false;
    route = url => {
      if (url.pathname.endsWith('/updates')) {changed = true; return {...envelope, fromSequence: 10, sequence: 11, owner: null, checkpoint: 'cp11', transcriptChanged: true};}
      if (url.pathname.endsWith('/transcript')) return {...envelope, sequence: changed ? 11 : 10, messages: url.searchParams.has('cursor') ? [message('old')] : [message('recent'), ...(changed ? [message('new')] : [])], nextCursor: url.searchParams.has('cursor') ? null : 'older'};
      return context;
    };
    const r = reader(); await r.select(selection); await r.loadOlder(); await r.poll();
    expect(r.getSnapshot().messages.map(item => item.head.id)).toEqual(['old', 'recent', 'new']);
  });
  it('retains expanded original text only when the refreshed revision and content identity match', async () => {
    const head = {...message('long', 'A😀'), contentLength: 5, nextContentCursor: 'part-2'}; let changed = false;
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, sequence: changed ? 11 : 10, messages: [head, ...(changed ? [message('new')] : [])], nextCursor: null} : url.pathname.endsWith('/content') ? {...envelope, message: {...head, content: 'é𐐀', contentOffset: 2, nextContentCursor: null}} : url.pathname.endsWith('/updates') ? (changed = true, {...envelope, fromSequence: 10, sequence: 11, owner: null, checkpoint: 'cp11', transcriptChanged: true}) : context;
    const r = reader(); await r.select(selection); await r.loadContent('long'); await r.poll();
    expect(r.getSnapshot().messages[0].text).toBe('A😀é𐐀');
    expect(r.getSnapshot().messages[0].tail.nextContentCursor).toBeNull();
  });
  it('polls serially in the background and cancels scheduled reads on close', async () => {
    vi.useFakeTimers(); const r = reader(); await r.select(selection);
    await vi.advanceTimersByTimeAsync(1500);
    expect(urls.filter(url => url.includes('/updates'))).toHaveLength(1);
    r.close(); await vi.advanceTimersByTimeAsync(6000);
    expect(urls.filter(url => url.includes('/updates'))).toHaveLength(1);
  });
  it('preserves actual archive and readOnly admission without inventing Research eligibility', async () => {
    const archived = {...context, archived: true, includeArchived: true, readOnly: true, researchEligible: false};
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, messages: [], nextCursor: null} : archived;
    const r = reader(); await r.select({...selection, target: {...selection.target, includeArchived: true}});
    expect(r.getSnapshot().context).toEqual(archived);
    expect(urls.every(url => new URL(url, 'http://synthetic').searchParams.get('includeArchived') === 'true')).toBe(true);
  });
  it('shares one in-flight update read and publishes live owner status without fabricating an epoch', async () => {
    const late = deferred<unknown>(); const r = reader(); await r.select(selection);
    route = () => late.promise;
    const first = r.poll(), second = r.poll();
    late.resolve({...envelope, fromSequence: 10, sequence: 11, owner: {...context, owner: {...context.owner, status: 'working', runId: 'real-run'}, revision: 'd'.repeat(64), sequence: 11, checkpoint: 'cp11'}, transcriptChanged: false, checkpoint: 'cp11'});
    await Promise.all([first, second]);
    expect(urls.filter(url => url.includes('/updates'))).toHaveLength(1);
    expect(r.getSnapshot().context?.owner).toMatchObject({epoch: 37, status: 'working', runId: 'real-run', projectId: 'synthetic-project', modelId: 'synthetic/model'});
  });
  it('aborts an older page when a sequenced refresh supersedes it', async () => {
    const late = deferred<unknown>(); let changed = false, oldSignal: AbortSignal | null | undefined;
    route = (url, signal) => {
      if (url.pathname.endsWith('/updates')) {changed = true; return {...envelope, fromSequence: 10, sequence: 11, owner: null, checkpoint: 'cp11', transcriptChanged: true};}
      if (url.pathname.endsWith('/transcript')) {
        if (url.searchParams.has('cursor')) {oldSignal = signal; return late.promise;}
        return {...envelope, sequence: changed ? 11 : 10, messages: [message(changed ? 'new' : 'original')], nextCursor: changed ? null : 'older'};
      }
      return context;
    };
    const r = reader(); await r.select(selection); const older = r.loadOlder(); await settle(); await r.poll();
    late.resolve({...envelope, messages: [message('stale')], nextCursor: null}); await older;
    expect(oldSignal?.aborted).toBe(true); expect(r.getSnapshot().messages.map(item => item.head.id)).toEqual(['new']);
  });
  it('bounds resync attempts when a newly acquired scope repeatedly returns invalid history', async () => {
    let contexts = 0;
    route = url => url.pathname.endsWith('/transcript') ? {...envelope, scopeKey: 'f'.repeat(64), messages: [], nextCursor: null} : ++contexts > 2 ? Response.json({error: {code: 'CAPABILITY_DENIED'}}, {status: 403}) : context;
    const r = reader(); await r.select(selection);
    expect(contexts).toBe(2);
    expect(r.getSnapshot()).toMatchObject({phase: 'error', context: null, messages: []});
  });
});
