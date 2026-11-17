import type {ReactElement} from 'react';
import {afterEach,expect,it,vi} from 'vitest';

const fixture=vi.hoisted(()=>({index:0,slots:[] as unknown[],effects:[] as (()=>void)[],read:vi.fn(),write:vi.fn(),retry:vi.fn(),intents:new Map<string,{value:unknown;pending:Promise<void>|null;identity:object}>(),guards:new Map<string,()=>Promise<void>>()}));
vi.mock('react',async original=>{
 const actual=await original<typeof import('react')>();
 const effect=(fn:()=>void|(()=>void),deps:unknown[])=>{
  const i=fixture.index++,prior=fixture.slots[i] as {deps:unknown[];cleanup?:()=>void}|undefined;
  if(prior&&deps.length===prior.deps.length&&deps.every((value,j)=>Object.is(value,prior.deps[j])))return;
  fixture.effects.push(()=>{prior?.cleanup?.();fixture.slots[i]={deps,cleanup:fn()};});
 };
 return {...actual,useState(initial:unknown){const i=fixture.index++;if(!(i in fixture.slots))fixture.slots[i]=typeof initial==='function'?(initial as ()=>unknown)():initial;return [fixture.slots[i],(next:unknown)=>{fixture.slots[i]=typeof next==='function'?(next as (old:unknown)=>unknown)(fixture.slots[i]):next;}];},useRef(initial:unknown){const i=fixture.index++;return fixture.slots[i]??={current:initial};},useMemo(fn:()=>unknown,deps:unknown[]){const i=fixture.index++,prior=fixture.slots[i] as {deps:unknown[];value:unknown}|undefined;if(!prior||!deps.every((value,j)=>Object.is(value,prior.deps[j])))fixture.slots[i]={deps,value:fn()};return (fixture.slots[i] as {value:unknown}).value;},useEffect:effect,useLayoutEffect:effect,useCallback(fn:unknown){fixture.index++;return fn;}};
});
vi.mock('../apps/web/src/plugin-frame-client',()=>({journalReadRetainingIntent:fixture.read,journalLocalIntent:(key:string)=>fixture.intents.get(key),journalWrite:(key:string,value:unknown)=>{const pending=fixture.write(key,value) as Promise<void>,entry={value,pending:pending as Promise<void>|null,identity:{}};fixture.intents.set(key,entry);void pending.then(()=>{if(fixture.intents.get(key)===entry)fixture.intents.delete(key);},()=>{if(fixture.intents.get(key)===entry)entry.pending=null;});return pending;},registerEditorHandoff:(id:string,guard:()=>Promise<void>)=>{fixture.guards.set(id,guard);return()=>fixture.guards.delete(id);},retryJournalWrites:fixture.retry}));
vi.mock('../packages/ui-shell/ToolDock',()=>({ToolDock:()=>null}));
import {PluginFloatingWindow} from '../apps/web/src/PluginFloatingWindow';
function render(id:string){
 fixture.index=0;const root=PluginFloatingWindow({id,title:id,children:null}) as ReactElement<{children:ReactElement<{onLayout:(value:unknown)=>void;notice:unknown}>}>|null;
 fixture.effects.splice(0).forEach(run=>run());return root;
}
afterEach(()=>{fixture.index=0;fixture.slots=[];fixture.effects=[];fixture.read.mockReset();fixture.write.mockReset();fixture.retry.mockReset();fixture.intents.clear();fixture.guards.clear();});
it.each(['B','A'])('does not show an old window write failure after switching to %s',async target=>{
 let reject!: (error:Error)=>void;
 fixture.read.mockResolvedValue({collapsed:false});fixture.write.mockImplementation(()=>new Promise<void>((_,fail)=>{reject=fail;}));
 render('A');await Promise.resolve();const a=render('A')!;a.props.children.props.onLayout({collapsed:true});
 await Promise.resolve();await Promise.resolve();expect(fixture.write).toHaveBeenCalledTimes(1);
 const rejectOld=reject;
 render('B');await Promise.resolve();expect(render('B')!.props.children.props.notice).toBeFalsy();
 if(target==='A'){render('A');await Promise.resolve();const reopened=render('A')!;expect(reopened.props.children.props.notice).toBeFalsy();reopened.props.children.props.onLayout({collapsed:false});}
 rejectOld(new Error('old failure'));await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(render(target)!.props.children.props.notice).toBeFalsy();
});
it('does not let a late A success clear B\'s newer write error',async()=>{
 let resolveA!:()=>void;fixture.read.mockResolvedValue({width:320});fixture.write.mockImplementationOnce(()=>new Promise<void>(resolve=>{resolveA=resolve;})).mockRejectedValueOnce(new Error('B failed'));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:500});render('B');await Promise.resolve();render('B')!.props.children.props.onLayout({width:600});
 await Promise.allSettled([fixture.write.mock.results[1].value]);await Promise.resolve();await Promise.resolve();expect(render('B')!.props.children.props.notice).toBeTruthy();
 resolveA();await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect((render('B')!.props as {width?:number}).width).toBe(600);expect(render('B')!.props.children.props.notice).toBeTruthy();
});
it('does not reuse an earlier A recovery while a reopened A is still loading',async()=>{
 fixture.read.mockResolvedValueOnce({width:320}).mockImplementationOnce(()=>new Promise(()=>{})).mockImplementationOnce(()=>new Promise(()=>{}));
 render('A');await Promise.resolve();expect(render('A')).not.toBeNull();
 expect(render('B')).toBeNull();expect(render('A')).toBeNull();
});
it('still shows the current window write failure',async()=>{
 let reject!: (error:Error)=>void;
 fixture.read.mockResolvedValue({collapsed:false});fixture.write.mockImplementation(()=>new Promise<void>((_,fail)=>{reject=fail;}));
 render('B');await Promise.resolve();render('B')!.props.children.props.onLayout({collapsed:true});
 await Promise.resolve();await Promise.resolve();reject(new Error('current failure'));await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(render('B')!.props.children.props.notice).toBeTruthy();
});
it('clears an older save error after a newer layout is acknowledged',async()=>{
 fixture.read.mockResolvedValue({width:320});fixture.write.mockRejectedValueOnce(new Error('old failure')).mockResolvedValueOnce(undefined);
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:400});await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(render('A')!.props.children.props.notice).toBeTruthy();render('A')!.props.children.props.onLayout({width:500});await Promise.allSettled([fixture.write.mock.results[1].value]);await Promise.resolve();await Promise.resolve();
 const current=render('A')!;expect((current.props as {width?:number}).width).toBe(500);expect(current.props.children.props.notice).toBeFalsy();
});
it.each(['success','error'])('ignores a late A read %s after B has recovered',async outcome=>{
 let resolve!: (value:unknown)=>void,reject!: (error:Error)=>void;
 fixture.read.mockImplementationOnce(()=>new Promise((ok,fail)=>{resolve=ok;reject=fail;})).mockResolvedValueOnce({width:500});
 render('A');render('B');await Promise.resolve();expect(render('B')!.props.children.props.notice).toBeFalsy();
 if(outcome==='success')resolve({width:700});else reject(new Error('old failure'));
 await Promise.resolve();await Promise.resolve();const b=render('B')!;
 expect(b.props.children.props.notice).toBeFalsy();expect((b.props as {width?:number}).width).toBe(500);
});
it.each(['success','error'])('does not apply a late A retry %s to B',async outcome=>{
 let resolve!:()=>void,reject!:(error:Error)=>void;
 fixture.read.mockResolvedValue({collapsed:false});fixture.write.mockRejectedValue(new Error('write failed'));
 fixture.retry.mockImplementation(()=>new Promise<void>((ok,fail)=>{resolve=ok;reject=fail;}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({collapsed:true});
 await Promise.resolve();await Promise.resolve();await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 const notice=render('A')!.props.children.props.notice as ReactElement<{children:[unknown,unknown,ReactElement<{onClick:()=>void}>]}>;
 notice.props.children[2].props.onClick();render('B');await Promise.resolve();
 if(outcome==='success'){
  render('B')!.props.children.props.onLayout({collapsed:true});await Promise.resolve();await Promise.resolve();await Promise.allSettled([fixture.write.mock.results[1].value]);await Promise.resolve();await Promise.resolve();
  expect(render('B')!.props.children.props.notice).toBeTruthy();resolve();
 }else reject(new Error('old retry failed'));
 await Promise.allSettled([fixture.retry.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(Boolean(render('B')!.props.children.props.notice)).toBe(outcome==='success');
});
it('clears A\'s error when A is saved even if another retry fails',async()=>{
 let rejectRetry!:(error:Error)=>void;fixture.read.mockResolvedValue({collapsed:false});fixture.write.mockRejectedValue(new Error('write failed'));
 fixture.retry.mockImplementation(()=>new Promise<void>((_,fail)=>{rejectRetry=fail;}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({collapsed:true});await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 const notice=render('A')!.props.children.props.notice as ReactElement<{children:[unknown,unknown,ReactElement<{onClick:()=>void}>]}>;notice.props.children[2].props.onClick();
 fixture.intents.delete(fixture.write.mock.calls[0][0]);rejectRetry(new Error('another key failed'));
 await Promise.allSettled([fixture.retry.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(render('A')!.props.children.props.notice).toBeFalsy();
});
it('waits for A\'s retry when another key fails first',async()=>{
 let rejectRetry!:(error:Error)=>void,resolveOwn!:()=>void;fixture.read.mockResolvedValue({collapsed:false});fixture.write.mockRejectedValue(new Error('write failed'));
 const own=new Promise<void>(resolve=>{resolveOwn=resolve;});
 fixture.retry.mockImplementation(()=>{const entry=fixture.intents.get(fixture.write.mock.calls[0][0])!;entry.pending=own;entry.identity={};return new Promise<void>((_,fail)=>{rejectRetry=fail;});});
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({collapsed:true});await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 const notice=render('A')!.props.children.props.notice as ReactElement<{children:[unknown,unknown,ReactElement<{onClick:()=>void}>]}>;notice.props.children[2].props.onClick();
 rejectRetry(new Error('another key failed'));await Promise.allSettled([fixture.retry.mock.results[0].value]);await Promise.resolve();
 expect(render('A')!.props.children.props.notice).toBeTruthy();fixture.intents.delete(fixture.write.mock.calls[0][0]);resolveOwn();await own;await Promise.resolve();
 expect(render('A')!.props.children.props.notice).toBeFalsy();
});
it('retains A\'s failed local layout and error when A is reopened',async()=>{
 let reject!:(error:Error)=>void;
 fixture.read.mockResolvedValue({width:320});fixture.write.mockImplementation(()=>new Promise<void>((_,fail)=>{reject=fail;}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:500});
 await Promise.resolve();await Promise.resolve();render('B');await Promise.resolve();render('B');
 reject(new Error('write failed'));await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 render('A');await Promise.resolve();const reopened=render('A')!;
 expect((reopened.props as {width?:number}).width).toBe(500);expect(reopened.props.children.props.notice).toBeTruthy();
});
it('retains an unacknowledged layout after unmount and reopen',async()=>{
 fixture.read.mockResolvedValue({width:320});fixture.write.mockImplementation(()=>new Promise<void>(()=>{}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:500});await Promise.resolve();await Promise.resolve();
 for(const slot of fixture.slots){const cleanup=(slot as {cleanup?:()=>void})?.cleanup;cleanup?.();}
 fixture.slots=[];fixture.index=0;fixture.effects=[];
 render('A');await Promise.resolve();expect((render('A')!.props as {width?:number}).width).toBe(500);
});
it('shows a pending write failure in the reopened window',async()=>{
 let reject!:(error:Error)=>void;fixture.read.mockResolvedValue({width:320});fixture.write.mockImplementation(()=>new Promise<void>((_,fail)=>{reject=fail;}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:500});await Promise.resolve();
 for(const slot of fixture.slots)(slot as {cleanup?:()=>void})?.cleanup?.();fixture.slots=[];fixture.index=0;fixture.effects=[];
 render('A');await Promise.resolve();expect((render('A')!.props as {width?:number}).width).toBe(500);
 reject(new Error('write failed'));await Promise.allSettled([fixture.write.mock.results[0].value]);await Promise.resolve();await Promise.resolve();
 expect(render('A')!.props.children.props.notice).toBeTruthy();
});
it('does not release a handoff that was invalidated while waiting for a write',async()=>{
 let resolve!:()=>void;fixture.read.mockResolvedValue({width:320});fixture.write.mockImplementation(()=>new Promise<void>(ok=>{resolve=ok;}));
 render('A');await Promise.resolve();render('A')!.props.children.props.onLayout({width:500});
 const waiting=fixture.guards.get('floating:A')!();render('B');resolve();
 await expect(waiting).rejects.toThrow(/changed/);
});
