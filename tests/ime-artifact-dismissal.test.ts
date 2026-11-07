import {afterAll,beforeAll,expect,it} from 'vitest';
import {build} from 'esbuild';
import {chromium,expect as browserExpect,type Browser,type Page,type Locator} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';

let browser:Browser,server:Server,origin:string;
const composing=[{name:'native',key:'Escape',isComposing:true,keyCode:27},{name:'legacy',key:'Escape',isComposing:false,keyCode:229}];
beforeAll(async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
  import {StateProvider,createStateStore} from '@json-render/react';
  import {useModalRegion} from './apps/web/src/focus.ts';
  import {FloatingWindow} from './apps/web/src/FloatingWindow.tsx';
  import {WindowDocument} from './apps/web/src/DocumentWindow.tsx';
  import {WorkspaceProvider} from './apps/web/src/workspace-context.tsx';
  import {SecureArtifactProvider} from './apps/web/src/secure-artifact-context.tsx';
  const api=window;api.regionCloses=0;api.documentClosed=0;api.popupClosed=0;api.updates=0;
  const store=createStateStore({values:{}});api.store=store;store.subscribe(()=>api.updates++);
  const query=new URLSearchParams(location.search),kind=query.get('kind'),mode=query.get('mode');
  function Document(){const [documentWindow,setDocumentWindow]=useState(null);return <StateProvider store={store}><SecureArtifactProvider value={{artifactId:'ime',threadId:'thread',revision:1,active:true,editable:true}}><WorkspaceProvider value={{activeArtifactId:'ime',requestOpenArtifact:()=>{},closeArtifact:()=>{},rightPanelOpen:true,activeTab:'artifact',setActiveTab:()=>{},documentWindow,requestOpenDocument:id=>setDocumentWindow({id,placement:'floating'}),closeDocument:()=>{api.documentClosed++;setDocumentWindow(null)},placeDocument:(id,placement)=>setDocumentWindow({id,placement})}}><WindowDocument text="Original" props={{title:'IME notes',editableStateKey:'draft'}}/></WorkspaceProvider></SecureArtifactProvider></StateProvider>}
  function Region(){const ref=useRef(null),[open,setOpen]=useState(true),[popup,setPopup]=useState(true);useModalRegion(ref,open,()=>{api.regionCloses++;setOpen(false)},'#outer-editor');return open?<section ref={ref} className="artifact" id="region"><textarea id="outer-editor" aria-label="Outer editor" defaultValue="Retained draft"/>{kind==='nested'?<Document/>:null}{kind==='hierarchy'&&popup?<section data-escape-scope id="popup" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();api.popupClosed++;setPopup(false)}}}><textarea aria-label="Popup editor" defaultValue="Retained draft"/></section>:null}</section>:null}
  function Floating(){const [open,setOpen]=useState(true);return <FloatingWindow id="ime-floating" title="IME floating" open={open} escapeBehavior={mode==='collapse'?'collapse':'close'} minimizeOnly={mode==='minimize'} onClose={()=>{api.regionCloses++;setOpen(false)}}><textarea aria-label="Floating editor" defaultValue="Retained draft"/></FloatingWindow>}
  const root=createRoot(document.getElementById('root'));api.dispose=()=>root.unmount();
  api.mount=()=>root.render(kind==='floating'?<Floating/>:kind==='document'?<div className="artifact"><Document/></div>:<Region/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'empty'}});
 server=createServer((request,response)=>{if(request.url==='/bundle.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0]!.text);}else{response.setHeader('Content-Type','text/html');response.end('<!doctype html><button id="prior">Prior focus</button><aside id="already-inert" inert>Previously inert</aside><div id="root"></div><script src="/bundle.js"></script>');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 browser=await chromium.launch({headless:true});
});
afterAll(async()=>{await browser?.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
async function mount(page:Page,kind:string,mode='close'){
 await page.goto(`${origin}/?kind=${kind}&mode=${mode}`);await page.locator('#prior').focus();await page.evaluate(()=>(window as any).mount());
}
async function documentEditor(page:Page){
 await page.getByRole('button',{name:'Open document',exact:true}).click();const editor=page.getByRole('textbox',{name:'Document text',exact:true});
 await browserExpect(editor).toBeEditable();await editor.fill('Retained draft');
 expect(await page.evaluate(()=>(window as any).store.get('/values/draft'))).toMatchObject({text:'Retained draft',sourceId:'binding:text'});return editor;
}
async function retain(page:Page,editor:Locator,event:typeof composing[number]){
 await editor.focus();const before=await page.evaluate(()=>({values:(window as any).store.getSnapshot(),updates:(window as any).updates}));
 await editor.evaluate((element,event)=>{(window as any).retainedEditor=element;element.dispatchEvent(new KeyboardEvent('keydown',{...event,bubbles:true,cancelable:true}));},event);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
 expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(0);
 expect(await page.evaluate(()=>(window as any).documentClosed)).toBe(0);
 await browserExpect(editor).toBeVisible();await browserExpect(editor).toHaveValue('Retained draft');
 expect(await editor.evaluate(element=>element===(window as any).retainedEditor&&element===document.activeElement)).toBe(true);
 expect(await page.evaluate(()=>({values:(window as any).store.getSnapshot(),updates:(window as any).updates}))).toEqual(before);
}
for(const event of composing){
 it(`modal capture preserves composing Escape (${event.name})`,async()=>{
  const page=await browser.newPage();try{await mount(page,'modal');const editor=page.getByRole('textbox',{name:'Outer editor'});await retain(page,editor,event);await browserExpect(page.locator('#region')).toBeVisible();await editor.press('Escape');expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(1);}finally{await page.close();}
 });
 for(const mode of ['close','collapse','minimize'])it(`floating owners preserve composing Escape (${event.name}, ${mode})`,async()=>{
  const page=await browser.newPage();try{
   await mount(page,'floating',mode);const editor=page.getByRole('textbox',{name:'Floating editor'});await retain(page,editor,event);
   const owner=page.locator('[data-floating-id="ime-floating"]');await browserExpect(owner).toHaveAttribute('data-collapsed','false');await editor.press('Escape');
   if(mode==='close'){expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(1);await browserExpect(owner).toBeHidden();}else{
    await browserExpect(owner).toHaveAttribute('data-collapsed','true');expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(0);
    await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(mode==='collapse'?1:0);
   }
  }finally{await page.close();}
 });
 it(`document window preserves composing Escape (${event.name})`,async()=>{
  const page=await browser.newPage();try{await mount(page,'document');const editor=await documentEditor(page);await retain(page,editor,event);await browserExpect(page.getByRole('region',{name:'IME notes document window'})).toBeVisible();await editor.press('Escape');expect(await page.evaluate(()=>(window as any).documentClosed)).toBe(1);await browserExpect(editor).toHaveCount(0);}finally{await page.close();}
 });
 it(`ordinary Escape dismisses child before region (${event.name})`,async()=>{
  const page=await browser.newPage();try{
   await mount(page,'nested');const editor=await documentEditor(page);await retain(page,editor,event);await editor.press('Escape');
   expect(await page.evaluate(()=>(window as any).documentClosed)).toBe(1);expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(0);await browserExpect(page.locator('#region')).toBeVisible();
   await page.getByRole('textbox',{name:'Outer editor'}).press('Escape');expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(1);await browserExpect(page.locator('#prior')).toBeFocused();
  }finally{await page.close();}
 });
}
it('hierarchy fixture delegates nested scope and restores focus/inert on region disposal',async()=>{
 const page=await browser.newPage();try{
  await mount(page,'hierarchy');await browserExpect(page.locator('#region')).toBeVisible();
  expect(await page.locator('#prior').evaluate(element=>(element as HTMLElement).inert)).toBe(true);
  await page.getByRole('textbox',{name:'Popup editor'}).press('Escape');expect(await page.evaluate(()=>(window as any).popupClosed)).toBe(1);expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(0);
  await page.evaluate(()=>(window as any).dispose());await browserExpect(page.locator('#prior')).toBeFocused();
  expect(await page.locator('#prior').evaluate(element=>(element as HTMLElement).inert)).toBe(false);expect(await page.locator('#already-inert').evaluate(element=>(element as HTMLElement).inert)).toBe(true);
  await page.evaluate(()=>{const replacement=document.createElement('textarea');replacement.id='replacement';replacement.value='Retained draft';document.getElementById('root')!.append(replacement);replacement.focus();});await page.locator('#replacement').press('Escape');
  expect(await page.evaluate(()=>(window as any).regionCloses)).toBe(0);await browserExpect(page.locator('#replacement')).toBeFocused();await browserExpect(page.locator('#replacement')).toHaveValue('Retained draft');
 }finally{await page.close();}
});
