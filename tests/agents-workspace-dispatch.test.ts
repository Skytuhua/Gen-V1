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

it('retains exact pinned skills and command identity through an ownership change during session renewal', async () => {
 let release!: () => void, ownership: number | undefined = 1, bootstraps = 0, accepted = false;
 const gate = new Promise<void>(resolve => {release = resolve;});
 const payloads: unknown[] = [];
 const fetch = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/bootstrap') {if (++bootstraps === 2) await gate; return Response.json({csrfToken:'synthetic'});}
  payloads.push(JSON.parse(String(init?.body)));
  return accepted ? Response.json({commandId:'receipt',seq:1}) : Response.json({error:{code:'AUTH_REQUIRED'}},{status:401});
 }); vi.stubGlobal('fetch',fetch);
 const {createPersonalAgentComposers} = await import('../apps/web/src/agents-workspace/composer');
 const owner = createPersonalAgentComposers(undefined, () => ownership), target = {kind:'conversation' as const,threadId:'parent',modelId:'model',working:false};
 const first: import('../apps/web/src/composer-commands').SkillBinding = {id:crypto.randomUUID(),name:'Selected',source:'Personal',ref:{version:1,scope:{kind:'personal'},sourceId:'personal:test',skillId:'procedure',locator:'a'.repeat(64),revision:'b'.repeat(64),digest:'c'.repeat(64),sourceBinding:'d'.repeat(64)}};
 const later = {...first,id:crypto.randomUUID(),ref:{...first.ref,skillId:'later'}};
 try {
  await owner.prepare(target); await owner.edit(target,'Original intent'); await owner.addSkill(target,first);
  const work = owner.submit(target,{thinkingLevel:'high'});
  await vi.waitFor(() => expect(bootstraps).toBe(2)); ownership = undefined;
  await owner.edit(target,'Later draft'); await owner.removeSkill(target,first.id); await owner.addSkill(target,later);
  release(); await work;
  expect(payloads).toHaveLength(1);
  expect(records.get('agents-pending:parent')?.value).toMatchObject({content:'Original intent',skills:[first],modelId:'model',thinkingLevel:'high'});
  expect(owner.getSnapshot(target)).toMatchObject({draft:'Later draft',skills:[later],retry:true});
  ownership = 2; accepted = true; await owner.submit({...target,modelId:'changed-model'},{thinkingLevel:'low'});
  expect(payloads).toHaveLength(2); expect(payloads[1]).toEqual(payloads[0]);
  expect(payloads[1]).toMatchObject({payload:{content:'Original intent',modelId:'model',thinkingLevel:'high',skills:[first.ref]}});
 } finally {release(); owner.dispose();}
});
