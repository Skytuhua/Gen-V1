import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {InboxView} from '../apps/web/src/InboxView.tsx';
import {InboxItemRow,InboxPane} from '../third-party/vespin/inbox-presentation.tsx';
import {oneColumn} from '../third-party/vespin/inbox-columns.ts';
import type {AttentionItem} from '../packages/contracts/attention.ts';
it('shares Inbox presentation without invoking a personal host or inventing available private records',()=>{
 const refresh=vi.fn(async()=>{}),mark=vi.fn(async()=>{});
 const html=renderToStaticMarkup(createElement(InboxView,{attention:{items:[],unread:0,error:'',refresh,markRead:mark,markUnread:mark},onOpenThread:()=>{},emptyTitle:'Company inbox is not connected',emptyMessage:'An approved private adapter is required.'}));
 expect(html).toContain('Company inbox is not connected');expect(html).not.toContain('caught up');expect(refresh).not.toHaveBeenCalled();expect(mark).not.toHaveBeenCalled();
});
it('retains the actual Vespin three-line row, unread gutter and above-title metadata arrangement',()=>{
 const onPress=vi.fn(),html=renderToStaticMarkup(createElement(InboxItemRow,{title:'Choose the current project',description:'The current request remains in its canonical conversation.',lead:{icon:createElement('span',null,'A'),label:'Current task'},meta:createElement('time',null,'now'),unread:true,current:true,muted:false,onPress,label:'Choose the current project, unread'}));
 expect(html).toContain('class="ui-list-row"');expect(html).toContain('data-meta="title"');expect(html).toContain('data-lead="above"');expect(html).toContain('ui-list-row-leading');expect(html).toContain('ui-unread-dot');expect(html).toContain('ui-list-row-head');expect(html).toContain('ui-list-row-lead-label');expect(html.indexOf('ui-list-row-lead-label')).toBeLessThan(html.indexOf('ui-list-row-title'));expect(html).toContain('data-current="true"');expect(onPress).not.toHaveBeenCalled();
});
it('uses the vendored list and reader presentation for canonical Gen items without adding send authority',()=>{
 const item:AttentionItem={id:'request:a:1',threadId:'thread-a',kind:'request',title:'A real conversation',summary:'Choose a destination',state:'needs-input',createdAt:'2026-11-04T00:00:00.000Z',updatedAt:'2026-11-04T00:00:00.000Z',read:false,popupDismissed:false,actionable:true,notificationKey:'request:a:1:needs-input',destination:{threadId:'thread-a'}},mark=vi.fn(async()=>{}),open=vi.fn();
 const html=renderToStaticMarkup(createElement(InboxView,{attention:{items:[item],unread:1,error:'',refresh:async()=>{},markRead:mark,markUnread:mark},onOpenThread:open}));
 expect(html).toContain('inbox-tasks-body');expect(html).toContain('sidebar-tasks');expect(html).toContain('ui-list-row');expect(html).toContain('inbox-view-items');expect(html).toContain('aria-label="Inbox filter"');expect(html).toContain('aria-label="Refresh inbox"');expect(html).not.toContain('agent-inbox-agent');expect(html).not.toContain('textarea');expect(mark).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
});
it('keeps Vespin subject and message structure while the canonical action remains outside vendored code',()=>{
 const html=renderToStaticMarkup(createElement(InboxPane,{title:'Current question',hidden:false,toolbar:createElement('button',null,'Open conversation'),children:createElement('p',null,'Canonical summary')}));
 expect(html).toContain('inbox-subject');expect(html).toContain('data-inbox-title=""');expect(html).toContain('inbox-board');expect(html).toContain('aria-label="Messages"');expect(html).toContain('Canonical summary');
});
it('uses the upstream 860/892 container-width hysteresis instead of a redesigned viewport breakpoint',()=>{
 expect(oneColumn(859,false)).toBe(true);expect(oneColumn(860,false)).toBe(false);expect(oneColumn(880,true)).toBe(true);expect(oneColumn(892,true)).toBe(false);
});


it.each(['mutation','stream','reconnect'] as const)('reconciles %s invalidation after an older Inbox read without overlapping reads',async trigger=>{
 const {build}=await import('esbuild'),{chromium}=await import('@playwright/test');
 const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {useAttention} from './apps/web/src/useAttention';
  let hostRead=false;window.gets=0;window.active=0;window.maximum=0;window.mutationDone=false;
  const value=()=>({items:[{id:'item',threadId:'thread',kind:'thread-completed',title:'Completed task',summary:'Synthetic result',state:'completed',read:hostRead,actionable:false,createdAt:'2026-11-06T00:00:00Z',updatedAt:'2026-11-06T00:00:00Z',popupDismissed:false,notificationKey:'item:completed',destination:{threadId:'thread'}}],unread:hostRead?0:1,sequence:hostRead?2:1});
  Object.defineProperty(globalThis,'crypto',{value:{randomUUID:()=> 'synthetic-command'}});
  window.fetch=async(url,options)=>{
   if(options?.method==='POST'){hostRead=true;window.accepted=true;return Response.json({});}
   window.gets++;window.active++;window.maximum=Math.max(window.maximum,window.active);
   const snapshot=value();if(window.hold){window.hold=false;await new Promise(resolve=>window.release=resolve);}
   window.active--;return Response.json(snapshot);
  };
  window.changeHost=()=>hostRead=true;
  function App(){const attention=useAttention();return <><output>{attention.unread}</output><button onClick={()=>void attention.refresh()}>Refresh</button><button onClick={()=>void attention.markRead('item').then(()=>window.mutationDone=true)}>Read</button></>;}
  const root=createRoot(document.getElementById('root'));root.render(<App/>);window.hide=()=>root.unmount();
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'attention-transport',setup(plugin){
  plugin.onResolve({filter:/^\.\/api$/},args=>args.importer.endsWith('useAttention.ts')?{path:'attention-api',namespace:'fixture'}:undefined);
  plugin.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:`
   export const csrfToken='synthetic-csrf';export const authenticated=run=>run();export const read=response=>response.json();
   export const subscribe=(sequence,changed,connected,reset)=>{window.subscribed=true;window.stream=changed;window.reconnect=reset;return()=>window.disconnected=(window.disconnected??0)+1};
  `}));
 }}]})).outputFiles[0]!.text;
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})}),page=await browser.newPage();
 type AttentionWindow=Window&{gets:number;maximum:number;active:number;hold:boolean;accepted?:boolean;mutationDone:boolean;subscribed?:boolean;disconnected?:number;release:()=>void;changeHost:()=>void;stream:()=>void;reconnect:()=>Promise<void>;hide:()=>void};
 try{
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:script});
  await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as AttentionWindow).subscribed))).toBe(true);
  expect(await page.locator('output').textContent()).toBe('1');
  const before=await page.evaluate(()=>{const state=window as unknown as AttentionWindow;state.hold=true;return state.gets;});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as AttentionWindow).gets)).toBe(before+1);
  if(trigger==='mutation'){
   await page.getByRole('button',{name:'Read',exact:true}).click();
   await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as AttentionWindow).accepted))).toBe(true);
   await page.evaluate(async()=>{(window as unknown as AttentionWindow).stream();await new Promise(resolve=>setTimeout(resolve,80));});
   expect(await page.evaluate(()=>(window as unknown as AttentionWindow).mutationDone)).toBe(false);
  }else await page.evaluate(async trigger=>{const state=window as unknown as AttentionWindow;state.changeHost();if(trigger==='stream'){state.stream();await new Promise(resolve=>setTimeout(resolve,80));}else void state.reconnect();},trigger);
  expect(await page.evaluate(()=>(window as unknown as AttentionWindow).gets)).toBe(before+1);
  await page.evaluate(()=>(window as unknown as AttentionWindow).release());
  await expect.poll(()=>page.locator('output').textContent()).toBe('0');
  expect(await page.evaluate(()=>(window as unknown as AttentionWindow).gets)).toBe(before+2);
  expect(await page.evaluate(()=>(window as unknown as AttentionWindow).maximum)).toBe(1);
  if(trigger==='mutation')expect(await page.evaluate(()=>(window as unknown as AttentionWindow).mutationDone)).toBe(true);
  await page.evaluate(()=>(window as unknown as AttentionWindow).hide());
  expect(await page.evaluate(()=>(window as unknown as AttentionWindow).disconnected)).toBe(1);
 }finally{await browser.close();}
},30000);
