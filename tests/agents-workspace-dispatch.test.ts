import {afterEach, beforeEach, expect, it, vi} from 'vitest';
const records = vi.hoisted(() => new Map<string, {value: unknown; generation: string}>());
vi.mock('../apps/web/src/journal', () => ({
 journalReadRecord: async (key: string) => records.get(key),
 journalWrite: async (key: string, value: unknown) => {records.set(key, {value, generation:'generation'});},
 journalGeneration: (key: string) => records.get(key)?.generation,
 journalSubscribe: () => () => {},
 journalCompareAndSwap: async () => true,
}));
beforeEach(() => {vi.resetModules(); records.clear();});
afterEach(() => vi.unstubAllGlobals());
for (const action of ['submit', 'stop'] as const) it(`rechecks the actual ${action} owner after delayed bootstrap before command transport`, async () => {
 let release!: () => void, ownership: number | undefined = 1;
 const gate = new Promise<void>(resolve => {release = resolve;});
 const fetch = vi.fn(async (url: string) => {if (url === '/api/bootstrap') {await gate; return Response.json({csrfToken:'synthetic'});} return Response.json({commandId:'receipt',seq:1});}); vi.stubGlobal('fetch',fetch);
 const {createPersonalAgentComposers} = await import('../apps/web/src/agents-workspace/composer');
 const owner = createPersonalAgentComposers(undefined, () => ownership), target = {kind:'conversation' as const,threadId:'parent',modelId:'model',working:true};
 await owner.prepare(target); await owner.edit(target,'Preserve intent'); const work = owner[action](target);
 await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/bootstrap', expect.any(Object)));
 ownership = undefined; release(); await work;
 expect(fetch.mock.calls.filter(call => call[0] === '/api/commands')).toHaveLength(0);
 expect(owner.getSnapshot(target).draft).toBe('Preserve intent');
 if (action === 'submit') expect(owner.getSnapshot(target).retry).toBe(true);
 owner.dispose();
});
it('does not replay a pending command after session renewal changes its owner', async () => {
 let release!: () => void, ownership: number | undefined = 1, bootstraps = 0;
 const gate = new Promise<void>(resolve => {release = resolve;});
 const fetch = vi.fn(async (url: string) => {
  if (url === '/api/bootstrap') {if (++bootstraps === 2) await gate; return Response.json({csrfToken:'synthetic'});}
  return Response.json({error:{code:'AUTH_REQUIRED'}},{status:401});
 }); vi.stubGlobal('fetch',fetch);
 const {createPersonalAgentComposers} = await import('../apps/web/src/agents-workspace/composer');
 const owner = createPersonalAgentComposers(undefined, () => ownership), target = {kind:'conversation' as const,threadId:'parent',modelId:'model',working:false};
 await owner.prepare(target); await owner.edit(target,'Original intent'); const work = owner.submit(target);
 await vi.waitFor(() => expect(bootstraps).toBe(2)); ownership = undefined; await owner.edit(target,'Later draft'); release(); await work;
 expect(fetch.mock.calls.filter(call => call[0] === '/api/commands')).toHaveLength(1);
 expect(records.get('agents-pending:parent')?.value).toMatchObject({content:'Original intent'});
 expect(owner.getSnapshot(target)).toMatchObject({draft:'Later draft',retry:true}); owner.dispose();
});
