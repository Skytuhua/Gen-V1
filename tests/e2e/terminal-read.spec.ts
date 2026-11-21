import {test,expect,type Page,type Route} from '@playwright/test';
import type {TerminalFixture} from './fixtures/terminal-read';

declare global{interface Window{terminalFixture:TerminalFixture}}
type Read={id:string;projectId:string;threadId?:string;output:string;start:number;cursor:number;exited:boolean;exitCode:number|null};
type RequestRecord={path:string;method:string;body:Record<string,unknown>|null;csrf:string|undefined};
const result=(id='terminal-a',output='before\r\n',extra:Partial<Read>={}):Read=>({id,projectId:'project-a',threadId:'thread-a',output,start:0,cursor:8,exited:false,exitCode:null,...extra});
const json=(route:Route,body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const failure=(route:Route,code='HTTP_ERROR')=>json(route,{error:{code,message:'Synthetic transient read failure'}},503);
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
// The phase label and the error line both carry role="status"; scope each query.
const phase=(page:Page)=>page.locator('.live-terminal .panel-toolbar').getByRole('status');
const errorText=(page:Page)=>page.locator('.live-terminal .error-text');
const tick=(page:Page)=>page.evaluate(()=>new Promise(done=>setTimeout(done,0)));
const bootstrapResponse=(page:Page)=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/bootstrap',{timeout:4000});
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
 await expect(errorText(page)).toContainText('Synthetic transient');
 const retry=page.getByRole('button',{name:'Retry',exact:true});await expect(retry).toBeVisible();
 await page.evaluate(()=>{Object.assign(window,{originalTerminal:window.terminalFixture.instances[0],originalDom:document.querySelector('.xterm')});});
 await retry.focus();await retry.press('Enter');await expect(retry).toBeDisabled();await expect.poll(()=>api.reads().length).toBe(2);gate.resolve();
 await expect.poll(()=>text(page)).toContain('after');await expect(phase(page)).toHaveText('Running');await expect(errorText(page)).toHaveCount(0);
 const output=await text(page);expect(output.match(/before/g)).toHaveLength(1);expect(output.match(/after/g)).toHaveLength(1);
 expect(api.creates()).toHaveLength(1);expect(api.reads().slice(0,2).map(item=>item.path)).toEqual(['/api/terminals/terminal-a?projectId=project-a&cursor=8&threadId=thread-a','/api/terminals/terminal-a?projectId=project-a&cursor=8&threadId=thread-a']);
 expect(await page.evaluate(()=>{const saved=window as unknown as {originalTerminal:unknown;originalDom:unknown};return window.terminalFixture.instances.length===1&&saved.originalTerminal===window.terminalFixture.instances[0]&&saved.originalDom===document.querySelector('.xterm');})).toBe(true);
 await page.screenshot({path:info.outputPath('02-candidate-recovered.png')});expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('Stop stays disabled until the matching creation acknowledgment',async({page})=>{
 const gate=deferred();const api=await mount(page,{create:async(route,body)=>{await gate.promise;await json(route,result(String(body.terminalId)));}});
 const stop=page.getByRole('button',{name:'Stop',exact:true});await expect(stop).toBeDisabled();await expect(phase(page)).toHaveText('Starting');
 await stop.dispatchEvent('click');expect(api.stops()).toEqual([]);gate.resolve();await expect(stop).toBeEnabled();await stop.click();await expect(phase(page)).toHaveText('Ended');expect(api.stops()).toHaveLength(1);
 expect(api.stops()[0]).toMatchObject({path:'/api/terminals/terminal-a/commands',csrf:'synthetic-csrf',body:{projectId:'project-a',threadId:'thread-a',type:'stop'}});
});

for(const mismatch of [{id:'terminal-other'},{projectId:'project-other'},{threadId:'thread-other'}])test(`creation acknowledgment rejects the wrong ${Object.keys(mismatch)[0]}`,async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','foreign output',mismatch))});
 await expect(errorText(page)).toContainText('does not match');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
 expect(api.reads()).toEqual([]);expect(api.stops()).toEqual([]);expect(await text(page)).not.toContain('foreign');
 expect(await page.evaluate(()=>localStorage.getItem('gen-terminal:project-a:thread-a:terminal-a'))).toBeNull();
});

test('hide pauses reads, fences late failure and reattaches the acknowledged session without stopping it',async({page})=>{
 const gate=deferred();const api=await mount(page,{read:async(route,index)=>{if(index===1){await gate.promise;await failure(route);return;}await json(route,result('terminal-a','',{start:8,cursor:8}));}});
 await expect.poll(()=>api.reads().length).toBe(1);await page.evaluate(()=>window.terminalFixture.update({active:false}));await expect(page.locator('.xterm')).toHaveCount(0);
 gate.resolve();await page.waitForTimeout(650);await expect(errorText(page)).toHaveCount(0);expect(api.reads()).toHaveLength(1);expect(api.stops()).toEqual([]);
 await page.evaluate(()=>window.terminalFixture.update({active:true}));await expect(phase(page)).toHaveText('Running');await expect.poll(()=>api.creates().length).toBe(2);
 expect(api.creates().map(item=>item.body?.terminalId)).toEqual(['terminal-a','terminal-a']);expect(await text(page)).toContain('before');expect(api.stops()).toEqual([]);
});

for(const change of [{projectId:'project-b'},{threadId:'thread-b'},{terminalId:'terminal-b'}])test(`a late read cannot cross a changed ${Object.keys(change)[0]}`,async({page})=>{
 const gate=deferred();const api=await mount(page,{read:async(route,index)=>{if(index===1){await gate.promise;await json(route,result('terminal-a','obsolete output',{start:8,cursor:23,exited:true}));return;}const url=new URL(route.request().url());await json(route,result(url.pathname.split('/').at(-1),'',{projectId:url.searchParams.get('projectId')!,threadId:url.searchParams.get('threadId')??undefined,start:8,cursor:8}));}});
 await expect.poll(()=>api.reads().length).toBe(1);await page.evaluate(change=>window.terminalFixture.update(change),change);await expect.poll(()=>api.creates().length).toBe(2);await expect(phase(page)).toHaveText('Running');
 gate.resolve();await page.waitForTimeout(650);expect(await text(page)).not.toContain('obsolete');await expect(phase(page)).toHaveText('Running');await expect(errorText(page)).toHaveCount(0);expect(api.stops()).toEqual([]);
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
 await expect(phase(page)).toHaveText('Ended');expect(api.creates()[0].body?.terminalId).toBe('restored-terminal');await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect.poll(()=>api.creates().length).toBe(2);
 expect(api.creates()[1].body?.terminalId).toBe('restored-terminal');await page.getByRole('button',{name:'New terminal',exact:true}).click();await expect.poll(()=>api.creates().length).toBe(3);
 expect(api.creates()[2].body?.terminalId).not.toBe('restored-terminal');expect(api.stops()).toEqual([]);
});

test('bound New uses openAnother and never recreates the owned terminal in place',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','done',{cursor:4,exited:true}))});
 await expect(phase(page)).toHaveText('Ended');await expect(page.getByText('Open a new terminal from the workspace.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'New terminal',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.terminalFixture.allowAnother());await page.getByRole('button',{name:'New terminal',exact:true}).click();expect(await page.evaluate(()=>window.terminalFixture.anotherCount())).toBe(1);expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);
});

test('an unconfirmed create offers no blind Retry or fresh ID',async({page})=>{
 const api=await mount(page,{create:route=>failure(route)});await expect(phase(page)).toHaveText('Start unconfirmed');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:/Retry|New terminal/})).toHaveCount(0);
 expect(api.creates()).toHaveLength(1);expect(api.reads()).toEqual([]);
});

test('bounded host output warns before appending and a reported end stops polling',async({page})=>{
 const api=await mount(page,{read:route=>json(route,result('terminal-a','tail\r\n',{start:100,cursor:106,exited:true,exitCode:0}))});
 await expect(phase(page)).toHaveText('Ended');await expect.poll(()=>text(page)).toContain('[Earlier output expired from the bounded host buffer]');expect(await text(page)).toContain('tail');expect(api.reads()).toHaveLength(1);await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
});

test('Stop is single flight and a late read cannot undo its confirmed end',async({page})=>{
 const readGate=deferred(),stopGate=deferred();const api=await mount(page,{read:async route=>{await readGate.promise;await json(route,result('terminal-a','late',{start:8,cursor:12}));},command:async(route,body)=>{if(body.type==='stop'){await stopGate.promise;await json(route,result('terminal-a','before\r\nfinal\r\n',{cursor:15,exited:true}));}else await json(route,result());}});
 await expect.poll(()=>api.reads().length).toBe(1);const stop=page.getByRole('button',{name:'Stop',exact:true});await stop.click();await expect(stop).toBeDisabled();await stop.dispatchEvent('click');expect(api.stops()).toHaveLength(1);stopGate.resolve();await expect(phase(page)).toHaveText('Ended');readGate.resolve();await page.waitForTimeout(650);await expect(phase(page)).toHaveText('Ended');expect(await text(page)).not.toContain('late');await expect.poll(()=>text(page)).toContain('final');
});

test('a late failed Stop cannot replace a different terminal owner state',async({page})=>{
 const gate=deferred();const api=await mount(page,{command:async(route,body)=>{if(body.type==='stop'){await gate.promise;await failure(route);}else await json(route,result());}});
 await expect(phase(page)).toHaveText('Running');await page.getByRole('button',{name:'Stop',exact:true}).click();await page.evaluate(()=>window.terminalFixture.update({terminalId:'terminal-b'}));await expect.poll(()=>api.creates().length).toBe(2);gate.resolve();await page.waitForTimeout(650);await expect(errorText(page)).toHaveCount(0);await expect(phase(page)).toHaveText('Running');
});

test('real scrollback, viewport and input/fit bindings survive read Retry',async({page})=>{
 const output=Array.from({length:2050},(_,index)=>`line-${index}\r\n`).join('');let cursor=output.length;
 const api=await mount(page,{create:route=>json(route,result('terminal-a',output,{cursor})),read:async(route,index)=>{if(index===1){await failure(route);return;}const start=cursor;cursor+=6;await json(route,result('terminal-a','tail\r\n',{start,cursor}));}});
 await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await expect.poll(()=>text(page)).toContain('line-2049');await page.evaluate(()=>window.terminalFixture.instances[0].scrollToTop());const before=await page.evaluate(()=>{const terminal=window.terminalFixture.instances[0];return {length:terminal.buffer.active.length,viewport:terminal.buffer.active.viewportY,first:terminal.buffer.active.getLine(0)?.translateToString(),scrollback:terminal.options.scrollback};});
 expect(before.scrollback).toBe(2000);expect(before.length).toBeLessThanOrEqual(2000+100);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>text(page)).toContain('tail');expect(await page.evaluate(()=>window.terminalFixture.instances.length)).toBe(1);expect(await page.evaluate(()=>window.terminalFixture.instances[0].buffer.active.viewportY)).toBe(before.viewport);
 await page.locator('.xterm-helper-textarea').press('x');await expect.poll(()=>api.requests.some(item=>item.body?.type==='input'&&item.body.data==='x')).toBe(true);await page.setViewportSize({width:700,height:620});await expect.poll(()=>api.requests.filter(item=>item.body?.type==='resize').length).toBeGreaterThan(1);
 await page.evaluate(()=>window.terminalFixture.revoke());const count=api.requests.length;await page.locator('.xterm-helper-textarea').press('y');await page.setViewportSize({width:680,height:600});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(done,0)))));expect(api.requests).toHaveLength(count);
});

for(const theme of ['dark','light'])test(`${theme} narrow keyboard recovery respects reduced motion`,async({page},info)=>{
 await page.setViewportSize({width:320,height:600});await page.emulateMedia({reducedMotion:'reduce'});const api=await mount(page,{read:async(route,index)=>index===1?failure(route):json(route,result('terminal-a','after\r\n',{start:8,cursor:15}))});
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);const retry=page.getByRole('button',{name:'Retry',exact:true});await expect(retry).toBeVisible();await retry.focus();await expect(retry).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const button of await page.locator('.live-terminal button').all()){const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);}
 expect(await page.locator('.live-terminal').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);await page.screenshot({path:info.outputPath(`03-${theme}-narrow-interrupted.png`)});await retry.press('Enter');await expect(phase(page)).toHaveText('Running');expect(api.creates()).toHaveLength(1);expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('unconfirmed unbound creation retains its caller ID across a view remount',async({page})=>{
 let count=0;const api=await mount(page,{unbound:true,create:async(route,body)=>{count++;if(count===1){await failure(route);return;}await json(route,result(String(body.terminalId)));}});
 await expect(phase(page)).toHaveText('Start unconfirmed');const requested=api.creates()[0].body?.terminalId;
 await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect(phase(page)).toHaveText('Running');
 expect(api.creates().map(item=>item.body?.terminalId)).toEqual([requested,requested]);expect(api.stops()).toEqual([]);
});

test('authenticated creation renewal reuses its caller ID and renewed CSRF',async({page})=>{
 let count=0;const api=await mount(page,{unbound:true,bootstrap:(route,index)=>json(route,{csrfToken:index===1?'synthetic-old':'synthetic-new'}),create:async(route,body)=>{count++;if(count===1){await json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403);return;}await json(route,result(String(body.terminalId)));}});
 await expect(phase(page)).toHaveText('Running');expect(api.creates()).toHaveLength(2);expect(api.creates()[0].body).toEqual(api.creates()[1].body);expect(api.creates().map(item=>item.csrf)).toEqual(['synthetic-old','synthetic-new']);
});

test('a read Retry keeps its cursor through authenticated session renewal',async({page})=>{
 const api=await mount(page,{read:async(route,index)=>{if(index===1){await failure(route);return;}if(index===2){await json(route,{error:{code:'AUTH_REQUIRED',message:'Synthetic expired session'}},401);return;}await json(route,result('terminal-a','after\r\n',{start:8,cursor:15}));}});
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>text(page)).toContain('after');await expect(phase(page)).toHaveText('Running');expect(api.creates()).toHaveLength(1);expect(api.reads().slice(0,3).map(item=>new URL(item.path,'http://fixture').searchParams.get('cursor'))).toEqual(['8','8','8']);
});

test('ownership revocation during authentication renewal cannot resend a creation POST',async({page})=>{
 const gate=deferred();const api=await mount(page,{bootstrap:async(route,index)=>{if(index>1)await gate.promise;await json(route,{csrfToken:'synthetic-csrf'});},create:route=>json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403)});
 await expect.poll(()=>api.requests.filter(item=>item.path==='/api/bootstrap').length).toBe(2);await page.evaluate(()=>window.terminalFixture.revoke());const renewed=bootstrapResponse(page);gate.resolve();await renewed;await tick(page);expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);expect(api.reads()).toEqual([]);
});

test('an old creation cannot borrow a replacement guard during an uncommitted owner handoff',async({page})=>{
 const gate=deferred();const api=await mount(page,{bootstrap:async(route,index)=>{if(index>1)await gate.promise;await json(route,{csrfToken:'synthetic-csrf'});},create:route=>json(route,{error:{code:'CSRF_REQUIRED',message:'Synthetic expired session'}},403)});
 await expect.poll(()=>api.requests.filter(item=>item.path==='/api/bootstrap').length).toBe(2);
 await page.evaluate(()=>window.terminalFixture.replaceGuard());
 await expect.poll(()=>page.evaluate(()=>window.terminalFixture.handoffRenders())).toBeGreaterThan(0);
 const renewed=bootstrapResponse(page);gate.resolve();await renewed;await tick(page);
 expect(api.creates()).toHaveLength(1);expect(api.stops()).toEqual([]);expect(api.reads()).toEqual([]);
});

test('an unbound start fails closed when its pending caller ID cannot be retained',async({page})=>{
 await page.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.endsWith(':pending'))throw new DOMException('Synthetic storage unavailable','QuotaExceededError');return original.call(this,key,value);};});
 const api=await mount(page,{unbound:true});await expect(phase(page)).toHaveText('Start unconfirmed');await expect(errorText(page)).toContainText('retain');await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeDisabled();
 expect(api.creates()).toEqual([]);await page.evaluate(()=>window.terminalFixture.show(false));await expect(page.locator('.xterm')).toHaveCount(0);await page.evaluate(()=>window.terminalFixture.show(true));await expect(phase(page)).toHaveText('Start unconfirmed');expect(api.creates()).toEqual([]);
});

test('find searches the retained buffer, moves between matches and sends nothing to the shell',async({page})=>{
 const output=Array.from({length:2050},(_,index)=>`line-${index}\r\n`).join('');
 const api=await mount(page,{create:route=>json(route,result('terminal-a',output,{cursor:output.length}))});
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 const input=page.locator('.terminal-find input');await expect(input).toBeFocused();
 await input.fill('line-204');
 const expected=await page.evaluate(()=>{const buffer=window.terminalFixture.instances[0].buffer.active;let count=0;for(let row=0;row<buffer.length;row++){if(buffer.getLine(row)?.translateToString().includes('line-204'))count++;}return count;});
 expect(expected).toBeGreaterThan(1);
 const counter=page.locator('.terminal-find .terminal-find-counter');
 await expect(counter).toHaveText(`1 of ${expected}`);
 await input.press('Enter');await expect(counter).toHaveText(`2 of ${expected}`);
 await input.press('Shift+Enter');await expect(counter).toHaveText(`1 of ${expected}`);
 expect(await page.evaluate(()=>{const terminal=window.terminalFixture.instances[0];const selection=terminal.getSelectionPosition();return !!selection&&selection.start.y>=terminal.buffer.active.viewportY&&selection.start.y<terminal.buffer.active.viewportY+terminal.rows;})).toBe(true);
 const before=api.requests.filter(item=>item.body?.type==='input').length;
 await input.press('Escape');await expect(page.locator('.terminal-find')).toHaveCount(0);await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
 await page.locator('.xterm-helper-textarea').press('x');await expect.poll(()=>api.requests.filter(item=>item.body?.type==='input').length).toBe(before+1);
 expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('Ctrl+F inside the terminal opens find without reaching the document or the shell',async({page})=>{
 const api=await mount(page);
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.evaluate(()=>{(window as unknown as {findKeys:boolean[]}).findKeys=[];document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'&&(event.ctrlKey||event.metaKey))(window as unknown as {findKeys:boolean[]}).findKeys.push(event.defaultPrevented);});});
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 await expect(page.locator('.terminal-find input')).toBeFocused();
 expect(await page.evaluate(()=>(window as unknown as {findKeys:boolean[]}).findKeys)).toEqual([]);
 expect(api.requests.filter(item=>item.body?.type==='input')).toEqual([]);
});

test('find reports no results and disables match navigation',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','before\r\n'))});
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 const input=page.locator('.terminal-find input');await input.fill('zzz');
 await expect(page.locator('.terminal-find .terminal-find-counter')).toHaveText('No results');
 await expect(page.getByRole('button',{name:'Previous match',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Next match',exact:true})).toBeDisabled();
 expect(api.errors).toEqual([]);
});

test('match case narrows a literal find',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','Error error ERROR\r\n',{cursor:18}))});
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 const input=page.locator('.terminal-find input');await input.fill('error');
 const counter=page.locator('.terminal-find .terminal-find-counter');
 await expect(counter).toHaveText('1 of 3');
 await page.getByRole('button',{name:'Match case',exact:true}).click();
 await expect(counter).toHaveText('1 of 1');
 expect(api.requests.filter(item=>item.body?.type==='input')).toEqual([]);
});

test('find works on an ended terminal over its retained output',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','done tail\r\n',{cursor:10,exited:true,exitCode:0}))});
 await expect(phase(page)).toHaveText('Ended');
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 const input=page.locator('.terminal-find input');await input.fill('tail');
 await expect(page.locator('.terminal-find .terminal-find-counter')).toHaveText('1 of 1');
 expect(api.requests.filter(item=>item.body?.type==='input')).toEqual([]);
});

test('new output refreshes the find counter without moving the active match',async({page})=>{
 const api=await mount(page,{create:route=>json(route,result('terminal-a','ready\r\n',{cursor:6})),read:route=>json(route,result('terminal-a','ready\r\n',{start:6,cursor:12}))});
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 const input=page.locator('.terminal-find input');await input.fill('ready');
 const counter=page.locator('.terminal-find .terminal-find-counter');
 await expect(counter).toHaveText('1 of 1');
 await expect(counter).toHaveText('1 of 2',{timeout:3000});
 expect(api.requests.filter(item=>item.body?.type==='input')).toEqual([]);
});

test('the toolbar button opens the row and the close button returns focus to it',async({page})=>{
 const api=await mount(page);
 const toggle=page.getByRole('button',{name:'Find in terminal',exact:true});
 await expect(toggle).toBeVisible();await toggle.click();
 await expect(page.locator('.terminal-find input')).toBeFocused();await expect(toggle).toHaveAttribute('aria-expanded','true');
 await page.getByRole('button',{name:'Close find',exact:true}).click();
 await expect(page.locator('.terminal-find')).toHaveCount(0);await expect(toggle).toBeFocused();await expect(toggle).toHaveAttribute('aria-expanded','false');
 expect(api.requests.filter(item=>item.body?.type==='input')).toEqual([]);
});

test('Escape inside the find row does not reach the window stop shortcut',async({page})=>{
 await mount(page);
 await expect(page.getByRole('button',{name:'Find in terminal',exact:true})).toBeVisible();
 await page.locator('.xterm-helper-textarea').focus();await page.locator('.xterm-helper-textarea').press('Control+f');
 await page.evaluate(()=>{(window as unknown as {escapes:number}).escapes=0;window.addEventListener('keydown',event=>{if(event.key==='Escape')(window as unknown as {escapes:number}).escapes++;});});
 const input=page.locator('.terminal-find input');await expect(input).toBeFocused();await input.press('Escape');
 await expect(page.locator('.terminal-find')).toHaveCount(0);
 expect(await page.evaluate(()=>(window as unknown as {escapes:number}).escapes)).toBe(0);
});

for(const theme of ['dark','light'])test(`${theme} narrow find row stays inside 320px with no running animations`,async({page},info)=>{
 await page.setViewportSize({width:320,height:600});await page.emulateMedia({reducedMotion:'reduce'});
 const api=await mount(page);
 await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
 const toggle=page.getByRole('button',{name:'Find in terminal',exact:true});await expect(toggle).toBeVisible();await toggle.click();
 const input=page.locator('.terminal-find input');await input.fill('before');await page.waitForTimeout(200);
 for(const button of await page.locator('.live-terminal button').all()){const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);}
 expect(await page.locator('.live-terminal').evaluate(element=>element.getAnimations({subtree:true}).filter(animation=>animation.playState==='running').length)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`04-${theme}-narrow-find.png`)});
 await page.setViewportSize({width:1000,height:760});await page.screenshot({path:info.outputPath(`05-${theme}-find.png`)});
 expect(api.blocked).toEqual([]);expect(api.errors).toEqual([]);
});

test('find highlight colors keep 4.5:1 contrast on the dark terminal',()=>{
 const luminance=(hex:string)=>{const channel=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.03928?value/12.92:Math.pow((value+0.055)/1.055,2.4));return 0.2126*channel[0]+0.7152*channel[1]+0.0722*channel[2];};
 const ratio=(a:string,b:string)=>{const[light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (light+0.05)/(dark+0.05);};
 expect(ratio('#dedede','#4a3b12')).toBeGreaterThanOrEqual(4.5);
 expect(ratio('#dedede','#7a5000')).toBeGreaterThanOrEqual(4.5);
});
