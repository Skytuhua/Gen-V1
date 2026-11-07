import {test,expect,type Page,type Route} from '@playwright/test';
import type {TerminalFixture} from './fixtures/terminal-read';

declare global{interface Window{terminalFixture:TerminalFixture}}
type Read={id:string;projectId:string;threadId?:string;output:string;start:number;cursor:number;exited:boolean;exitCode:number|null};
type RequestRecord={path:string;method:string;body:Record<string,unknown>|null;csrf:string|undefined};
const result=(id='terminal-a',output='before\r\n',extra:Partial<Read>={}):Read=>({id,projectId:'project-a',threadId:'thread-a',output,start:0,cursor:8,exited:false,exitCode:null,...extra});
const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const failure=(route:Route,code='HTTP_ERROR')=>json(route,{error:{code,message:'Synthetic transient read failure'}},503);
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const audits=new WeakMap<Page,{blocked:string[];errors:string[]}>();
test.afterEach(async({page})=>{const audit=audits.get(page);if(audit){expect(audit.blocked).toEqual([]);expect(audit.errors).toEqual([]);}});
async function mount(page:Page,options:{unbound?:boolean;bootstrap?:(route:Route,index:number)=>Promise<void>;create?:(route:Route,body:Record<string,unknown>)=>Promise<void>;read?:(route:Route,index:number)=>Promise<void>;command?:(route:Route,body:Record<string,unknown>)=>Promise<void>}={}){
 const requests:RequestRecord[]=[],blocked:string[]=[],errors:string[]=[];let reads=0,bootstraps=0;audits.set(page,{blocked,errors});
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='http://127.0.0.1:5814'){blocked.push(request.url());await route.abort();return;}
  if(!url.pathname.startsWith('/api/')){await route.continue();return;}
  const body=request.method()==='POST'?request.postDataJSON() as Record<string,unknown>:null;
  requests.push({path:url.pathname+url.search,method:request.method(),body,csrf:request.headers()['x-harness-csrf']});
  if(url.pathname==='/api/bootstrap'){bootstraps++;if(options.bootstrap)await options.bootstrap(route,bootstraps);else await json(route,{csrfToken:'synthetic-csrf'});return;}
  if(url.pathname==='/api/terminals'&&body){if(options.create)await options.create(route,body);else await json(route,result(String(body.terminalId),'before\r\n',{projectId:String(body.projectId),threadId:body.threadId as string|undefined}));return;}
  if(/^\/api\/terminals\/[^/]+$/.test(url.pathname)&&request.method()==='GET'){reads++;if(options.read)await options.read(route,reads);else await json(route,result(url.pathname.split('/').at(-1),'',{start:Number(url.searchParams.get('cursor')),cursor:Number(url.searchParams.get('cursor'))}));return;}
  if(/^\/api\/terminals\/[^/]+\/commands$/.test(url.pathname)&&body){if(options.command)await options.command(route,body);else await json(route,result(url.pathname.split('/').at(-2),'',{exited:body.type==='stop'}));return;}
  blocked.push(request.url());await route.abort();
 });
 const query=new URLSearchParams();if(options.unbound)query.set('unbound','');
 await page.goto('/tests/e2e/fixtures/terminal-read.html?'+query);
 await expect(page.locator('.xterm')).toHaveCount(1);
 return {requests,blocked,errors,creates:()=>requests.filter(item=>item.path==='/api/terminals'),reads:()=>requests.filter(item=>item.method==='GET'&&item.path.startsWith('/api/terminals/')),stops:()=>requests.filter(item=>item.body?.type==='stop')};
}
const text=(page:Page)=>page.evaluate(()=>window.terminalFixture.text());

test('read Retry resumes the same cursor and real xterm without duplicate or lost output',async({page},info)=>{
 const gate=deferred();
 const api=await mount(page,{read:async(route,index)=>{if(index===1){await failure(route);return;}if(index===2){await gate.promise;await json(route,result('terminal-a','after\r\n',{start:8,cursor:15}));return;}await json(route,result('terminal-a','',{start:15,cursor:15}));}});
 await expect(page.getByRole('alert')).toContainText('Synthetic transient');
 const retry=page.getByRole('button',{name:'Retry',exact:true});await expect(retry).toBeVisible();
 await page.evaluate(()=>{Object.assign(window,{originalTerminal:window.terminalFixture.instances[0],originalDom:document.querySelector('.xterm')});});
 await retry.focus();await retry.press('Enter');await expect(retry).toBeDisabled();await page.waitForTimeout(600);expect(api.reads()).toHaveLength(2);gate.resolve();
 await expect.poll(()=>text(page)).toContain('after');await expect(page.getByRole('status')).toHaveText('Running');await expect(page.getByRole('alert')).toHaveCount(0);
 const output=await text(page);expect(output.match(/before/g)).toHaveLength(1);expect(output.match(/after/g)).toHaveLength(1);
 expect(api.creates()).toHaveLength(1);expect(api.reads().slice(0,2).map(item=>item.path)).toEqual(['/api/terminals/terminal-a?projectId=project-a&cursor=8&threadId=thread-a','/api/terminals/terminal-a?projectId=project-a&cursor=8&threadId=thread-a']);
 expect(await page.evaluate(()=>{const saved=window as unknown as {originalTerminal:unknown;originalDom:unknown};return window.terminalFixture.instances.length===1&&saved.originalTerminal===window.terminalFixture.instances[0]&&saved.originalDom===document.querySelector('.xterm');})).toBe(true);
 await page.screenshot({path:info.outputPath('02-candidate-recovered.png')});expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('Stop stays disabled until the matching creation acknowledgment',async({page})=>{
 const gate=deferred();const api=await mount(page,{create:async(route,body)=>{await gate.promise;await json(route,result(String(body.terminalId)));}});
 const stop=page.getByRole('button',{name:'Stop',exact:true});await expect(stop).toBeDisabled();await expect(page.getByRole('status')).toHaveText('Starting');
 await stop.dispatchEvent('click');expect(api.stops()).toEqual([]);gate.resolve();await expect(stop).toBeEnabled();await stop.click();await expect(page.getByRole('status')).toHaveText('Ended');expect(api.stops()).toHaveLength(1);
 expect(api.stops()[0]).toMatchObject({path:'/api/terminals/terminal-a/commands',csrf:'synthetic-csrf',body:{projectId:'project-a',threadId:'thread-a',type:'stop'}});
});

for(const mismatch of [{id:'terminal-other'},{projectId:'project-other'},{threadId:'thread-other'}])test(`creation acknowledgment rejects the wrong ${Object.keys(mismatch)[0]}`,async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','foreign output',mismatch))});
 await expect(page.getByRole('alert')).toContainText('does not match');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
 await page.waitForTimeout(650);expect(api.reads()).toEqual([]);expect(api.stops()).toEqual([]);expect(await text(page)).not.toContain('foreign');
 expect(await page.evaluate(()=>localStorage.getItem('gen-terminal:project-a:thread-a:terminal-a'))).toBeNull();
});

test('hide pauses reads, fences late failure and reattaches the acknowledged session without stopping it',async({page})=>{
 const gate=deferred();const api=await mount(page,{read:async(route,index)=>{if(index===1){await gate.promise;await failure(route);return;}await json(route,result('terminal-a','',{start:8,cursor:8}));}});
 await expect.poll(()=>api.reads().length).toBe(1);await page.evaluate(()=>window.terminalFixture.update({active:false}));await expect(page.locator('.xterm')).toHaveCount(0);
 gate.resolve();await page.waitForTimeout(650);await expect(page.getByRole('alert')).toHaveCount(0);expect(api.reads()).toHaveLength(1);expect(api.stops()).toEqual([]);
 await page.evaluate(()=>window.terminalFixture.update({active:true}));await expect(page.getByRole('status')).toHaveText('Running');await expect.poll(()=>api.creates().length).toBe(2);
 expect(api.creates().map(item=>item.body?.terminalId)).toEqual(['terminal-a','terminal-a']);expect(await text(page)).toContain('before');expect(api.stops()).toEqual([]);
});

for(const change of [{projectId:'project-b'},{threadId:'thread-b'},{terminalId:'terminal-b'}])test(`a late read cannot cross a changed ${Object.keys(change)[0]}`,async({page})=>{
 const gate=deferred();const api=await mount(page,{read:async(route,index)=>{if(index===1){await gate.promise;await json(route,result('terminal-a','obsolete output',{start:8,cursor:23,exited:true}));return;}const url=new URL(route.request().url());await json(route,result(url.pathname.split('/').at(-1),'',{projectId:url.searchParams.get('projectId')!,threadId:url.searchParams.get('threadId')??undefined,start:8,cursor:8}));}});
 await expect.poll(()=>api.reads().length).toBe(1);await page.evaluate(change=>window.terminalFixture.update(change),change);await expect.poll(()=>api.creates().length).toBe(2);await expect(page.getByRole('status')).toHaveText('Running');
 gate.resolve();await page.waitForTimeout(650);expect(await text(page)).not.toContain('obsolete');await expect(page.getByRole('status')).toHaveText('Running');await expect(page.getByRole('alert')).toHaveCount(0);expect(api.stops()).toEqual([]);
});

test('revoked ownership fences a pending create, keyboard input, reads and Stop',async({page})=>{
 const gate=deferred();const api=await mount(page,{create:async route=>{await gate.promise;await json(route,result());}});
 await expect.poll(()=>api.creates().length).toBe(1);await page.evaluate(()=>window.terminalFixture.revoke());gate.resolve();await page.waitForTimeout(650);
 await page.getByRole('button',{name:'Stop',exact:true}).dispatchEvent('click');expect(api.reads()).toEqual([]);expect(api.stops()).toEqual([]);expect(await text(page)).not.toContain('before');
});

test('disposed creation acknowledgment cannot write output, storage or commands',async({page})=>{
 const gate=deferred();const api=await mount(page,{create:async route=>{await gate.promise;await json(route,result());}});
 await expect.poll(()=>api.creates().length).toBe(1);await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);gate.resolve();await page.waitForTimeout(650);
 expect(api.reads()).toEqual([]);expect(api.stops()).toEqual([]);expect(await page.evaluate(()=>localStorage.getItem('gen-terminal:project-a:thread-a:terminal-a'))).toBeNull();expect(api.errors).toEqual([]);
});

test('a restored unbound session survives remount and explicit New alone chooses another ID',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('gen-terminal:project-a:thread-a:default','restored-terminal'));
 const api=await mount(page,{unbound:true,create:(route,body)=>json(route,result(String(body.terminalId),'restored output',{cursor:15,exited:true}))});
 await expect(page.getByRole('status')).toHaveText('Ended');expect(api.creates()[0].body?.terminalId).toBe('restored-terminal');await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect.poll(()=>api.creates().length).toBe(2);
 expect(api.creates()[1].body?.terminalId).toBe('restored-terminal');await page.getByRole('button',{name:'New terminal',exact:true}).click();await expect.poll(()=>api.creates().length).toBe(3);
 expect(api.creates()[2].body?.terminalId).not.toBe('restored-terminal');expect(api.stops()).toEqual([]);
});

test('bound New uses openAnother and never recreates the owned terminal in place',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','done',{cursor:4,exited:true}))});
 await expect(page.getByRole('status')).toHaveText('Ended');await expect(page.getByText('Open a new terminal from the workspace.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'New terminal',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.terminalFixture.allowAnother());await page.getByRole('button',{name:'New terminal',exact:true}).click();expect(await page.evaluate(()=>window.terminalFixture.anotherCount())).toBe(1);expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);
});

test('an unconfirmed create offers no blind Retry or fresh ID',async({page})=>{
 const api=await mount(page,{create:route=>failure(route)});await expect(page.getByRole('status')).toHaveText('Start unconfirmed');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:/Retry|New terminal/})).toHaveCount(0);
 await page.waitForTimeout(650);expect(api.creates()).toHaveLength(1);expect(api.reads()).toEqual([]);
});

test('bounded host output warns before appending and a reported end stops polling',async({page})=>{
 const api=await mount(page,{read:route=>json(route,result('terminal-a','tail\r\n',{start:100,cursor:106,exited:true,exitCode:0}))});
 await expect(page.getByRole('status')).toHaveText('Ended');await expect.poll(()=>text(page)).toContain('[Earlier output expired from the bounded host buffer]');expect(await text(page)).toContain('tail');await page.waitForTimeout(650);expect(api.reads()).toHaveLength(1);await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
});

test('Stop is single flight and a late read cannot undo its confirmed end',async({page})=>{
 const readGate=deferred(),stopGate=deferred();const api=await mount(page,{read:async route=>{await readGate.promise;await json(route,result('terminal-a','late',{start:8,cursor:12}));},command:async(route,body)=>{if(body.type==='stop'){await stopGate.promise;await json(route,result('terminal-a','before\r\nfinal\r\n',{cursor:15,exited:true}));}else await json(route,result());}});
 await expect.poll(()=>api.reads().length).toBe(1);const stop=page.getByRole('button',{name:'Stop',exact:true});await stop.click();await expect(stop).toBeDisabled();await stop.dispatchEvent('click');expect(api.stops()).toHaveLength(1);stopGate.resolve();await expect(page.getByRole('status')).toHaveText('Ended');readGate.resolve();await page.waitForTimeout(650);await expect(page.getByRole('status')).toHaveText('Ended');expect(await text(page)).not.toContain('late');await expect.poll(()=>text(page)).toContain('final');
});

test('a late failed Stop cannot replace a different terminal owner state',async({page})=>{
 const gate=deferred();const api=await mount(page,{command:async(route,body)=>{if(body.type==='stop'){await gate.promise;await failure(route);}else await json(route,result());}});
 await expect(page.getByRole('status')).toHaveText('Running');await page.getByRole('button',{name:'Stop',exact:true}).click();await page.evaluate(()=>window.terminalFixture.update({terminalId:'terminal-b'}));await expect.poll(()=>api.creates().length).toBe(2);gate.resolve();await page.waitForTimeout(650);await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByRole('status')).toHaveText('Running');
});

test('real scrollback, viewport and input/fit bindings survive read Retry',async({page})=>{
 const output=Array.from({length:2050},(_,index)=>`line-${index}\r\n`).join('');let cursor=output.length;
 const api=await mount(page,{create:route=>json(route,result('terminal-a',output,{cursor})),read:async(route,index)=>{if(index===1){await failure(route);return;}const start=cursor;cursor+=6;await json(route,result('terminal-a','tail\r\n',{start,cursor}));}});
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await expect.poll(()=>text(page)).toContain('line-2049');await page.evaluate(()=>window.terminalFixture.instances[0].scrollToTop());const before=await page.evaluate(()=>{const terminal=window.terminalFixture.instances[0];return {length:terminal.buffer.active.length,viewport:terminal.buffer.active.viewportY,first:terminal.buffer.active.getLine(0)?.translateToString(),scrollback:terminal.options.scrollback};});
 expect(before.scrollback).toBe(2000);expect(before.length).toBeLessThanOrEqual(2000+100);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>text(page)).toContain('tail');expect(await page.evaluate(()=>window.terminalFixture.instances.length)).toBe(1);expect(await page.evaluate(()=>window.terminalFixture.instances[0].buffer.active.viewportY)).toBe(before.viewport);
 await page.locator('.xterm-helper-textarea').press('x');await expect.poll(()=>api.requests.some(item=>item.body?.type==='input'&&item.body.data==='x')).toBe(true);await page.setViewportSize({width:700,height:620});await expect.poll(()=>api.requests.filter(item=>item.body?.type==='resize').length).toBeGreaterThan(1);
 await page.evaluate(()=>window.terminalFixture.revoke());const count=api.requests.length;await page.locator('.xterm-helper-textarea').press('y');await page.setViewportSize({width:680,height:600});await page.waitForTimeout(650);expect(api.requests).toHaveLength(count);
});

for(const theme of ['dark','light'])test(`${theme} narrow keyboard recovery respects reduced motion`,async({page},info)=>{
 await page.setViewportSize({width:320,height:600});await page.emulateMedia({reducedMotion:'reduce'});const api=await mount(page,{read:async(route,index)=>index===1?failure(route):json(route,result('terminal-a','after\r\n',{start:8,cursor:15}))});
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);const retry=page.getByRole('button',{name:'Retry',exact:true});await expect(retry).toBeVisible();await retry.focus();await expect(retry).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const button of await page.locator('.live-terminal button').all()){const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);}
 expect(await page.locator('.live-terminal').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);await page.screenshot({path:info.outputPath(`03-${theme}-narrow-interrupted.png`)});await retry.press('Enter');await expect(page.getByRole('status')).toHaveText('Running');expect(api.creates()).toHaveLength(1);expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('unconfirmed unbound creation retains its caller ID across a view remount',async({page})=>{
 let count=0;const api=await mount(page,{unbound:true,create:async(route,body)=>{count++;if(count===1){await failure(route);return;}await json(route,result(String(body.terminalId)));}});
 await expect(page.getByRole('status')).toHaveText('Start unconfirmed');const requested=api.creates()[0].body?.terminalId;
 await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect(page.getByRole('status')).toHaveText('Running');
 expect(api.creates().map(item=>item.body?.terminalId)).toEqual([requested,requested]);expect(api.stops()).toEqual([]);
});

test('authenticated creation renewal reuses its caller ID and renewed CSRF',async({page})=>{
 let count=0;const api=await mount(page,{unbound:true,bootstrap:(route,index)=>json(route,{csrfToken:index===1?'synthetic-old':'synthetic-new'}),create:async(route,body)=>{count++;if(count===1){await json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403);return;}await json(route,result(String(body.terminalId)));}});
 await expect(page.getByRole('status')).toHaveText('Running');expect(api.creates()).toHaveLength(2);expect(api.creates()[0].body).toEqual(api.creates()[1].body);expect(api.creates().map(item=>item.csrf)).toEqual(['synthetic-old','synthetic-new']);
});

test('a read Retry keeps its cursor through authenticated session renewal',async({page})=>{
 const api=await mount(page,{read:async(route,index)=>{if(index===1){await failure(route);return;}if(index===2){await json(route,{error:{code:'AUTH_REQUIRED',message:'Synthetic expired session'}},401);return;}await json(route,result('terminal-a','after\r\n',{start:8,cursor:15}));}});
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>text(page)).toContain('after');await expect(page.getByRole('status')).toHaveText('Running');expect(api.creates()).toHaveLength(1);expect(api.reads().slice(0,3).map(item=>new URL(item.path,'http://fixture').searchParams.get('cursor'))).toEqual(['8','8','8']);
});

test('ownership revocation during authentication renewal cannot resend a creation POST',async({page})=>{
 const gate=deferred();const api=await mount(page,{bootstrap:async(route,index)=>{if(index>1)await gate.promise;await json(route,{csrfToken:'synthetic-csrf'});},create:route=>json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403)});
 await expect.poll(()=>api.requests.filter(item=>item.path==='/api/bootstrap').length).toBe(2);await page.evaluate(()=>window.terminalFixture.revoke());gate.resolve();await page.waitForTimeout(650);expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);expect(api.reads()).toEqual([]);
});

test('an old creation cannot borrow a replacement guard during an uncommitted owner handoff',async({page})=>{
 const gate=deferred();const api=await mount(page,{bootstrap:async(route,index)=>{if(index>1)await gate.promise;await json(route,{csrfToken:'synthetic-csrf'});},create:route=>json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403)});
 await expect.poll(()=>api.requests.filter(item=>item.path==='/api/bootstrap').length).toBe(2);
 await page.evaluate(()=>window.terminalFixture.replaceGuard());
 await expect.poll(()=>page.evaluate(()=>window.terminalFixture.handoffRenders())).toBeGreaterThan(0);
 gate.resolve();await page.waitForTimeout(650);
 expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);expect(api.reads()).toEqual([]);
});

test('an unbound start fails closed when its pending caller ID cannot be retained',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.endsWith(':pending'))throw new DOMException('Synthetic storage unavailable','QuotaExceededError');return original.call(this,key,value);};});
 const api=await mount(page,{unbound:true});await expect(page.getByRole('status')).toHaveText('Start unconfirmed');await expect(page.getByRole('alert')).toContainText('retain');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
 expect(api.creates()).toEqual([]);await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect(page.getByRole('status')).toHaveText('Start unconfirmed');expect(api.creates()).toEqual([]);
});
