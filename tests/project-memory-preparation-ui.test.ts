import {afterEach, expect, it, vi} from 'vitest';
import {MemoryPreparationController, type MemoryPreparationTransport, type MemoryRequestInput} from '../apps/web/src/project-memory-preparation';
import type {MemoryPreparedRequest, MemoryScope} from '../packages/contracts/project-memory';

const scope: MemoryScope = {projectId: 'project', threadId: 'thread', accountId: 'account', projectIdentity: 'a'.repeat(64), bindingDigest: 'b'.repeat(64)};
const input: MemoryRequestInput = {owner: scope, prompt: 'Export timestamps in UTC.', modelId: 'model', thinkingLevel: 'high'};
afterEach(() => vi.unstubAllGlobals());
function prepared(phase: MemoryPreparedRequest['phase'] = 'PREPARING'): MemoryPreparedRequest {
  return {scope, requestId: 'request-1', contextGeneration: 7, phase, items: [], injectedBytes: 0, expiresAt: new Date(Date.now() + 60000).toISOString(), recall: {requestId: 'request-1', contextGeneration: 7, projectIdentity: scope.projectIdentity, queryDigest: 'c'.repeat(64), candidateIds: [], selectedRevisions: [], scores: [], exclusions: [], budgetBytes: 4096, producedAt: '2026-11-15T00:00:00Z', status: 'COMPLETE'}};
}
function fixture() {
  const transport: MemoryPreparationTransport = {prepare: vi.fn(async () => prepared()), latest: vi.fn(async () => prepared('CAPTURED')), exclude: vi.fn(async view => ({...view, items: [], injectedBytes: 0, recall: {...view.recall, selectedRevisions: [], exclusions: [{itemId: 'memory', reason: 'USER_EXCLUDED'}]}}))};
  return {transport, controller: new MemoryPreparationController(transport)};
}
function withMemory() {
  const view = prepared();
  view.items = [{id: 'memory', revision: 2, projectIdentity: scope.projectIdentity, scope: 'PROJECT', kind: 'CONSTRAINT', text: 'Use UTC.', state: 'ACCEPTED', sourceRefs: [{ownerThreadId: 'thread', sourceKind: 'MESSAGE', sourceId: 'source', sourceRevision: '1', capturedSeq: 3, digest: 'd'.repeat(64), observedStatus: 'REPORTED'}], assertedBy: {kind: 'USER', id: 'user'}, observedAt: '2026-11-15T00:00:00Z', expiresAt: null, supersedes: [], sensitivity: 'NORMAL', reviewDecision: null}];
  view.recall.selectedRevisions = [{itemId: 'memory', revision: 2}]; view.injectedBytes = 100;
  return view;
}

it('prepares only on inspection and binds the token to the exact serialized draft and settings', async () => {
  const {controller, transport} = fixture(); controller.bind(input);
  expect(transport.prepare).not.toHaveBeenCalled(); expect(controller.requestContextId(input)).toBeUndefined();
  await controller.inspect(input);
  expect(transport.prepare).toHaveBeenCalledWith(input, expect.any(AbortSignal));
  expect(controller.requestContextId(input)).toBe('request-1');
  expect(controller.requestContextId({...input, prompt: input.prompt + '\nnew excerpt'})).toBeUndefined();
});

it.each(['account', 'project', 'thread', 'model', 'thinking'] as const)('invalidates a prepared token when its %s owner changes', async change => {
  const {controller} = fixture(); await controller.inspect(input);
  const changed = {...input, owner: {...input.owner}};
  if (change === 'account') changed.owner.accountId = 'other';
  if (change === 'project') changed.owner.projectId = 'other';
  if (change === 'thread') changed.owner.threadId = 'other';
  if (change === 'model') changed.modelId = 'other';
  if (change === 'thinking') changed.thinkingLevel = null;
  expect(controller.requestContextId(changed)).toBeUndefined(); expect(controller.snapshot().view).toBeNull();
});

it('does not display a late preparation after the owner changed even if transport ignores abort', async () => {
  const {controller, transport} = fixture(); let resolve!: (value: MemoryPreparedRequest) => void;
  vi.mocked(transport.prepare).mockImplementation(() => new Promise(done => {resolve = done;}));
  const pending = controller.inspect(input); controller.bind({...input, owner: {...scope, threadId: 'other'}}); resolve(prepared()); await pending;
  expect(controller.snapshot().view).toBeNull(); expect(controller.snapshot().error).toBe('');
});

it('blocks send synchronously throughout exclusion and after failure until explicit re-preparation', async () => {
  const {controller, transport} = fixture(); vi.mocked(transport.prepare).mockResolvedValue(withMemory()); await controller.inspect(input);
  let reject!: (cause: Error) => void; vi.mocked(transport.exclude).mockImplementation(() => new Promise((_, fail) => {reject = fail;}));
  const pending = controller.exclude({itemId: 'memory', revision: 2});
  expect(() => controller.requestContextId(input)).toThrow(/prepar|exclusion|context/i);
  reject(Error('Exclusion was not confirmed.')); await expect(pending).rejects.toThrow('Exclusion was not confirmed.');
  expect(() => controller.requestContextId(input)).toThrow('Exclusion was not confirmed.');
  await controller.inspect(input); expect(controller.requestContextId(input)).toBe('request-1');
});

it('keeps the same host token after a confirmed exclusion and retains the returned selection', async () => {
  const {controller, transport} = fixture(); vi.mocked(transport.prepare).mockResolvedValue(withMemory()); await controller.inspect(input);
  await controller.exclude({itemId: 'memory', revision: 2});
  expect(controller.requestContextId(input)).toBe('request-1'); expect(controller.snapshot().view?.items).toEqual([]);
  expect(controller.snapshot().view?.recall.exclusions).toContainEqual({itemId: 'memory', reason: 'USER_EXCLUDED'});
});

it('shows only captured context for an empty draft and never reuses it for a new send', async () => {
  const {controller, transport} = fixture(); const empty = {...input, prompt: ''}; await controller.inspect(empty);
  expect(transport.latest).toHaveBeenCalledWith(empty.owner, expect.any(AbortSignal)); expect(transport.prepare).not.toHaveBeenCalled();
  expect(controller.snapshot().view?.phase).toBe('CAPTURED'); expect(controller.requestContextId(empty)).toBeUndefined();
  await expect(controller.exclude({itemId: 'memory', revision: 2})).rejects.toThrow(/captured|prepar/i);
});

it('requires refreshed preparation after its host expiry and discards all memory state on dispose', async () => {
  const {controller, transport} = fixture(); const expired = prepared(); expired.expiresAt = '2020-01-01T00:00:00Z'; vi.mocked(transport.prepare).mockResolvedValue(expired);
  await controller.inspect(input); expect(() => controller.requestContextId(input)).toThrow(/expired/i);
  controller.dispose(); expect(controller.snapshot().view).toBeNull();
});

it('uses authenticated CSRF transport with the exact prepared draft and settings', async () => {
  vi.resetModules(); vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : Response.json(withMemory())));
  const api = await import('../apps/web/src/project-memory-request-api'); await api.prepareMemoryRequest(input, new AbortController().signal);
  const [url, options] = vi.mocked(fetch).mock.calls.at(-1)!;
  expect(url).toBe('/api/projects/project/memory/requests/prepare'); expect(options).toMatchObject({method: 'POST', credentials: 'same-origin', redirect: 'error', headers: {'x-harness-csrf': 'csrf'}});
  expect(JSON.parse(options!.body as string)).toEqual({threadId: 'thread', prompt: input.prompt, modelId: 'model', thinkingLevel: 'high'});
});

it('rejects a prepared response from another account or inconsistent recall generation', async () => {
  vi.resetModules(); const value = withMemory(); value.scope = {...scope, accountId: 'foreign'};
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : Response.json(value)));
  const api = await import('../apps/web/src/project-memory-request-api'); await expect(api.prepareMemoryRequest(input, new AbortController().signal)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
  value.scope = scope; value.recall.contextGeneration++;
  await expect(api.prepareMemoryRequest(input, new AbortController().signal)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});

it('does not let an exclusion response replace the prepared query or its remaining evidence', async () => {
  vi.resetModules(); const before = withMemory(), after = {...before, items: [], injectedBytes: 0, recall: {...before.recall, queryDigest: 'f'.repeat(64), selectedRevisions: [], exclusions: [{itemId: 'memory', reason: 'USER_EXCLUDED'}]}};
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => String(url) === '/api/bootstrap' ? Response.json({csrfToken: 'csrf'}) : Response.json(after)));
  const api = await import('../apps/web/src/project-memory-request-api');
  await expect(api.excludeMemoryFromRequest(before, {itemId: 'memory', revision: 2}, new AbortController().signal)).rejects.toMatchObject({code: 'INVALID_RESPONSE'});
});


it.each(['disabled', 'input'] as const)('keeps visible prepared controls on their committed %s during a suspended render', async change => {
  const {build} = await import('esbuild'), {chromium} = await import('@playwright/test');
  const script = (await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Suspense,startTransition,useLayoutEffect,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {useProjectMemoryPreparation} from './apps/web/src/useProjectMemoryPreparation';
    const original=${JSON.stringify(input)}, never=new Promise(()=>{});
    function Block({suspend}){if(suspend){window.attempted=true;throw never;}return null;}
    function Controls({state}){
      const memory=useProjectMemoryPreparation(state.input,false,state.disabled);
      const exclude=()=>memory.memoryRecall.exclusionAdapter.exclude({itemId:'memory',revision:2});useLayoutEffect(()=>{window.exclude=exclude;});
      return <><button onClick={memory.refresh}>Inspect</button>
        <button disabled={!memory.memoryRecall||memory.memoryRecall.exclusionAdapter.disabled} onClick={()=>{void exclude().then(()=>window.excluded=true).catch(error=>window.error=error.message)}}>Exclude</button>
        <button onClick={()=>window.token=memory.requestContextId()}>Capture context</button></>;
    }
    function App(){
      const [state,setState]=useState({input:original,disabled:false,suspend:false});
      window.suspend=change=>startTransition(()=>setState({input:change==='input'?{...original,prompt:'Different uncommitted request'}:original,disabled:change==='disabled',suspend:true}));
      window.disable=()=>setState({input:original,disabled:true,suspend:false});
      return <Suspense fallback="fallback"><Controls state={state}/><Block suspend={state.suspend}/></Suspense>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `}, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}, plugins: [{name: 'memory-transport', setup(plugin) {
    plugin.onResolve({filter: /^\.\/project-memory-request-api$/}, () => ({path: 'memory-transport', namespace: 'fixture'}));
    plugin.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({loader: 'js', contents: `
      export const prepareMemoryRequest=async()=>(${JSON.stringify(withMemory())});
      export const latestMemoryRequest=async()=>null;
      export const excludeMemoryFromRequest=async view=>{window.exclusions=(window.exclusions??0)+1;return {...view,items:[],injectedBytes:0}};
    `}));
  }}]})).outputFiles[0]!.text;
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  const page=await browser.newPage();
  type HookWindow=Window&{suspend:(change:string)=>void;disable:()=>void;exclude:()=>Promise<void>;attempted?:boolean;token?:string;excluded?:boolean;exclusions?:number;error?:string};
  try {
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});
    await page.getByRole('button',{name:'Inspect',exact:true}).click();
    await expect.poll(()=>page.getByRole('button',{name:'Exclude',exact:true}).isEnabled()).toBe(true);
    await page.evaluate(change=>(window as unknown as HookWindow).suspend(change),change);
    await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as HookWindow).attempted))).toBe(true);
    expect(await page.getByRole('button',{name:'Exclude',exact:true}).isEnabled()).toBe(true);
    await page.getByRole('button',{name:'Capture context',exact:true}).click();
    expect(await page.evaluate(()=>(window as unknown as HookWindow).token)).toBe('request-1');
    await page.getByRole('button',{name:'Exclude',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>(window as unknown as HookWindow).excluded)).toBe(true);
    expect(await page.evaluate(()=>(window as unknown as HookWindow).exclusions)).toBe(1);
    expect(await page.evaluate(()=>(window as unknown as HookWindow).error)).toBeUndefined();
    await page.evaluate(()=>(window as unknown as HookWindow).disable());
    await expect.poll(()=>page.getByRole('button',{name:'Exclude',exact:true}).isDisabled()).toBe(true);
    expect(await page.evaluate(async()=>{try{await (window as unknown as HookWindow).exclude();return '';}catch(error){return (error as Error).message;}})).toContain('request is being sent');
    expect(await page.evaluate(()=>(window as unknown as HookWindow).exclusions)).toBe(1);
  } finally {await browser.close();}
},30000);
