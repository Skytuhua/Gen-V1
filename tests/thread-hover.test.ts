import {afterEach, describe, expect, it, vi} from 'vitest';
import {createThreadHoverCache, createThreadHoverDataController} from '../apps/web/src/thread-hover/data';
import {createThreadHoverInteraction} from '../apps/web/src/thread-hover/interaction';
import {factsFromProjectContext, hoverScopeKey, scopedThreadHoverFacts, type ThreadHoverFacts, type ThreadHoverScope} from '../apps/web/src/thread-hover/facts';
import type {ProjectContext} from '../packages/contracts/workspace';

const scope = (patch: Partial<ThreadHoverScope> = {}): ThreadHoverScope => ({authority: {kind: 'local'}, threadId: 'thread-a', projectId: 'project', workingCopyId: 'C:/copies/a', revision: 'rev-1', ...patch});
const facts = (owner = scope(), branch = 'branch-a'): ThreadHoverFacts => ({scope: owner, title: owner.threadId, branch});
function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
const flush = async () => {await Promise.resolve(); await Promise.resolve();};

describe('exact thread hover ownership', () => {
  it('separates authority, project, thread, working copy and revision in cache keys', () => {
    const a = scope(), alternatives = [scope({threadId: 'thread-b'}), scope({workingCopyId: 'C:/copies/b'}), scope({revision: 'rev-2'}), scope({projectId: 'other'}), scope({authority: {kind: 'plugin', pluginId: 'company', scopeId: 'team'}})];
    const cache = createThreadHoverCache(); cache.set(facts(a));
    for (const other of alternatives) {expect(hoverScopeKey(other)).not.toBe(hoverScopeKey(a)); expect(cache.get(other)).toBeUndefined();}
    expect(cache.get(a)?.branch).toBe('branch-a');
  });

  it('bounds the cache and removes obsolete revisions for one exact owner', () => {
    const cache = createThreadHoverCache(); cache.set(facts()); cache.set(facts(scope({revision: 'rev-2'}), 'new'));
    expect(cache.get(scope())).toBeUndefined();
    for (let index = 0; index < 40; index++) cache.set(facts(scope({threadId: `thread-${index}`})));
    expect(cache.size).toBe(32); expect(cache.get(scope({revision: 'rev-2'}))).toBeUndefined();
  });

  it('drops working-copy facts and PR actions when the working copy is unknown', () => {
    const input = {...facts(scope({workingCopyId: null})), workingCopy: 'unverified', pullRequests: [{id: 'pr-1', label: '#1', target: {id: 'target'}}], model: 'known-model'};
    const next = scopedThreadHoverFacts(input);
    expect(next.branch).toBeUndefined(); expect(next.workingCopy).toBeUndefined(); expect(next.pullRequests).toBeUndefined(); expect(next.model).toBe('known-model');
  });

  it('accepts ProjectContext facts only for exact thread, project, working-copy and revision', () => {
    const owner = scope();
    const context: ProjectContext = {project: {id: 'project', name: 'Project', rootPath: 'C:/original-repository', authority: owner.authority, createdAt: '2026-01-01T00:00:00Z'}, threadId: owner.threadId, workingCopy: {id: owner.workingCopyId!, path: 'C:/actual-managed-copy'}, threadRevision: owner.revision, revision: 'separate-git-revision', machineName: 'Windows host', branch: 'exact-branch', head: 'abc', editor: {available: true, label: 'Editor'}, changes: {added: null, removed: null, files: null}, lineage: [], scripts: [], capabilities: {git: true, terminal: false, pullRequests: false}};
    expect(factsFromProjectContext(owner, 'Title', context)?.branch).toBe('exact-branch');
    for (const other of [scope({threadId: 'other'}), scope({projectId: 'other'}), scope({workingCopyId: 'other'}), scope({revision: 'other'}), scope({authority: {kind: 'plugin', pluginId: 'company', scopeId: 'team'}})]) expect(factsFromProjectContext(other, 'Title', context)).toBeNull();
    expect(factsFromProjectContext(owner, 'Title', {...context, threadId: undefined})).toBeNull();
    expect(factsFromProjectContext(owner, 'Title', {...context, error: 'Read failed'})).toBeNull();
    expect(factsFromProjectContext(owner, 'Title', context)?.childCount).toBeUndefined();
  });

  it('clears old data immediately and rejects late success, even from the same project', async () => {
    const a = deferred<ThreadHoverFacts>(), b = deferred<ThreadHoverFacts>(), changes: string[] = [], signals: AbortSignal[] = [];
    const controller = createThreadHoverDataController({load: (owner, signal) => {signals.push(signal); return owner.threadId === 'thread-a' ? a.promise : b.promise;}, onChange: state => changes.push(state.status)});
    controller.activate(scope()); controller.activate(scope({threadId: 'thread-b', workingCopyId: 'C:/copies/b'}));
    expect(signals[0].aborted).toBe(true); expect(controller.getState().status).toBe('loading'); expect('facts' in controller.getState()).toBe(false);
    b.resolve(facts(scope({threadId: 'thread-b', workingCopyId: 'C:/copies/b'}), 'branch-b')); await flush();
    a.resolve(facts()); await flush();
    expect(controller.getState()).toMatchObject({status: 'ready', facts: {branch: 'branch-b'}}); expect(changes).toEqual(['loading', 'loading', 'ready']);
  });

  it('does not restore cached data after a read failure, scope mismatch or cancellation', async () => {
    const pending = deferred<ThreadHoverFacts>(), cache = createThreadHoverCache();
    const controller = createThreadHoverDataController({cache, load: () => pending.promise, onChange: () => {}});
    controller.activate(scope()); pending.reject(new Error('failure from source')); await flush();
    expect(controller.getState()).toMatchObject({status: 'error'}); expect(cache.get(scope())).toBeUndefined();
    const wrong = createThreadHoverDataController({load: async () => facts(scope({workingCopyId: 'wrong'})), onChange: () => {}});
    wrong.activate(scope()); await flush(); expect(wrong.getState()).toMatchObject({status: 'error'});
    const late = deferred<ThreadHoverFacts>(), cancelled = createThreadHoverDataController({cache, load: () => late.promise, onChange: () => {}});
    cancelled.activate(scope()); cancelled.deactivate(); late.resolve(facts()); await flush();
    expect(cancelled.getState()).toEqual({status: 'idle'}); expect(cache.get(scope())).toBeUndefined();
  });

  it('revalidates exact cached revisions and handles synchronous source failures', async () => {
    const cache = createThreadHoverCache(); cache.set(facts()); const load = vi.fn(() => {throw new Error('sync failure');});
    const controller = createThreadHoverDataController({cache, load, onChange: () => {}});
    controller.activate(scope()); await flush(); expect(controller.getState().status).toBe('error'); expect(load).toHaveBeenCalledTimes(1);
    controller.activate(scope({revision: 'rev-2'})); await flush(); expect(controller.getState().status).toBe('error');
  });

  it('fences a revision change and late rejection without replacing the new branch', async () => {
    const a = deferred<ThreadHoverFacts>(), b = deferred<ThreadHoverFacts>();
    const controller = createThreadHoverDataController({load: owner => owner.revision === 'rev-1' ? a.promise : b.promise, onChange: () => {}});
    controller.activate(scope()); controller.activate(scope({revision: 'rev-2'}));
    b.resolve(facts(scope({revision: 'rev-2'}), 'new-branch')); await flush(); a.reject(new Error('old error')); await flush();
    expect(controller.getState()).toMatchObject({status: 'ready', facts: {branch: 'new-branch'}});
  });
});

describe('hover dwell, transfer and focus controller', () => {
  afterEach(() => vi.useRealTimers());
  function setup() {vi.useFakeTimers(); const changes: boolean[] = []; const controller = createThreadHoverInteraction(open => changes.push(open)); return {controller, changes};}
  it('opens after 350ms dwell and cancels flyovers', () => {
    const {controller, changes} = setup(); controller.pointerEnter('trigger'); vi.advanceTimersByTime(349); expect(changes).toEqual([]);
    controller.pointerLeave('trigger'); vi.advanceTimersByTime(500); expect(changes).toEqual([]);
    controller.pointerEnter('trigger'); vi.advanceTimersByTime(350); expect(changes).toEqual([true]);
  });
  it('allows 120ms transfer to the card and keeps focused actions usable', () => {
    const {controller, changes} = setup(); controller.pointerEnter('trigger'); vi.advanceTimersByTime(350); controller.pointerLeave('trigger'); vi.advanceTimersByTime(119);
    controller.pointerEnter('card'); vi.advanceTimersByTime(200); expect(changes).toEqual([true]);
    controller.focus(true); controller.pointerLeave('card'); vi.advanceTimersByTime(200); expect(changes).toEqual([true]);
    controller.focus(false); expect(changes).toEqual([true, false]);
  });
  it('provides immediate keyboard focus, Escape dismissal and intentional reopening', () => {
    const {controller, changes} = setup(); controller.focus(true); expect(changes).toEqual([true]); controller.dismiss(); controller.focus(true); vi.advanceTimersByTime(400); expect(changes).toEqual([true, false]);
    controller.focus(false); controller.focus(true); expect(changes).toEqual([true, false, true]);
  });
  it('blocks pending and open cards during dragging or a nested menu', () => {
    const {controller, changes} = setup(); controller.pointerEnter('trigger'); controller.setBlocked(true); vi.advanceTimersByTime(500); controller.focus(true); expect(changes).toEqual([]);
    controller.setBlocked(false); expect(changes).toEqual([]); controller.pointerEnter('trigger'); vi.advanceTimersByTime(350); expect(changes).toEqual([true]);
    controller.setBlocked(true); expect(changes).toEqual([true, false]); controller.dispose(); vi.advanceTimersByTime(1000); expect(changes).toEqual([true, false]);
  });
});
