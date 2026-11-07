import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

type FixtureKind='toolbar'|'markdown'|'combined';
async function mount(page:Page,kind:FixtureKind,props:Record<string,unknown>){
 await serveTaskFixture(page,taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Fixture'}}}}));await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-motion','system');
 const source=await (await page.request.get('/src/Markdown.tsx')).text(),main=await (await page.request.get('/src/main.tsx')).text();
 const modules={react:source.match(/["']([^"']*\/react\.js[^"']*)["']/)![1],dom:main.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)![1]};
 await page.evaluate(async({kind,props,modules})=>{
  const reactModule=await import(modules.react),domModule=await import(modules.dom),React=reactModule.default??reactModule,DOM=domModule.default??domModule,entry=kind==='toolbar'?'/src/ComposerToolbar.tsx':'/src/Markdown.tsx',module=await import(entry),Component=kind==='toolbar'?module.ComposerToolbar:module.Markdown;
  document.documentElement.style.setProperty('--ui-popup-layer','10001');const target=document.createElement('section');target.className='component-fixture';target.setAttribute('aria-label','Component fixture');target.style.cssText='position:fixed;inset:0;padding:32px;background:var(--surface);z-index:10000;overflow:auto';document.body.append(target);const root=DOM.createRoot(target);const events:{type:string;value?:unknown}[]=[];
  let current={...props};const callbacks={onModelChange:(value:string)=>events.push({type:'model',value}),onThinkingChange:(value:string)=>events.push({type:'thinking',value}),onProject:()=>events.push({type:'project'}),onChanges:()=>events.push({type:'changes'}),onCreatePR:()=>events.push({type:'pr'}),onTranscript:(value:string)=>events.push({type:'transcript',value})};
  const toolbarEntry='/src/ComposerToolbar.tsx',toolbarModule=kind==='combined'?await import(toolbarEntry):null;
  const render=()=>root.render(kind==='combined'?
   React.createElement('div',{style:{width:'min(960px,100%)',margin:'80px auto',display:'grid',gap:48}},
    React.createElement('div',{style:{maxWidth:760,fontSize:16,lineHeight:1.7}},React.createElement(module.Markdown,{text:current.text,animate:true,initialReveal:false})),
    React.createElement('div',{style:{padding:16,border:'1px solid var(--border)',borderRadius:18,background:'var(--subtle)'}},
     React.createElement('div',{style:{minHeight:72,padding:'4px 7px',color:'var(--muted)'}},'Ask anything, or bring something to work on…'),
     React.createElement(toolbarModule!.ComposerToolbar,{...callbacks,...current})))
   :React.createElement(Component,{...(kind==='toolbar'?callbacks:{}),...current}));
  render();Object.assign(window,{componentFixture:{events,update:(next:Record<string,unknown>)=>{current={...current,...next};render();},unmount:()=>root.unmount()}});
 },{kind,props,modules});
 await expect(page.getByRole('region',{name:'Component fixture',exact:true})).toBeVisible();
}
const props={models:[{id:'test/sol',name:'Sol',provider:'test',thinkingLevels:['low','medium','high']}],modelId:'test/sol',thinkingLevel:'medium',projectLabel:'checkout',changeSummary:{added:12,removed:4}};
const update=(page:Page,next:Record<string,unknown>)=>page.evaluate(next=>(window as unknown as {componentFixture:{update:(next:Record<string,unknown>)=>void}}).componentFixture.update(next),next);
const events=(page:Page)=>page.evaluate(()=>(window as unknown as {componentFixture:{events:{type:string;value?:unknown}[]}}).componentFixture.events);

test('composer exposes concise project, changes and PR actions and only actual thinking levels',async({page})=>{
 await mount(page,'toolbar',props);const fixture=page.getByRole('region',{name:'Component fixture',exact:true});
 await fixture.getByRole('button',{name:'Select project',exact:true}).click();await fixture.getByRole('button',{name:'Inspect changes',exact:true}).click();await fixture.getByRole('button',{name:'Create PR',exact:true}).click();
 expect((await events(page)).map(item=>item.type)).toEqual(['project','changes','pr']);await expect(fixture).toContainText('+12');await expect(fixture).toContainText('−4');
 const model=fixture.getByRole('combobox',{name:'Model',exact:true});await model.click();await page.getByRole('button',{name:'Reasoning: Medium',exact:true}).click();await expect(page.getByRole('menuitemcheckbox')).toHaveText(['Default','Low','Medium','High']);await page.getByRole('menuitemcheckbox',{name:'High',exact:true}).click();expect((await events(page)).at(-1)).toMatchObject({type:'thinking',value:'high'});
 await update(page,{working:true});await expect(page.getByRole('dialog',{name:'Model and reasoning',exact:true})).not.toBeVisible();await expect(fixture.getByRole('combobox',{name:'Model',exact:true})).toBeDisabled();await expect(fixture.getByRole('button',{name:'Create PR',exact:true})).toBeDisabled();
});

test('composer unknown counts and unsupported thinking remain unavailable instead of invented',async({page})=>{
 await mount(page,'toolbar',{...props,models:[{id:'test/sol',name:'Sol',provider:'test'}],changeSummary:undefined});const fixture=page.getByRole('region',{name:'Component fixture',exact:true});
 await expect(fixture.getByRole('button',{name:'Inspect changes',exact:true})).toHaveText('Changes');await fixture.getByRole('combobox',{name:'Model',exact:true}).click();await expect(page.getByRole('dialog',{name:'Model and reasoning',exact:true})).toContainText('No reasoning settings');await expect(page.getByRole('button',{name:/^Reasoning:/})).toHaveCount(0);await expect(fixture).not.toContainText('+0');await expect(fixture).not.toContainText('Ultra');
});

test('voice returns final text once, never sends, and rejects callbacks from an unmounted composer',async({page})=>{
 await page.addInitScript(()=>{class Recognition{static all:Recognition[]=[];onresult:((event:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((event:unknown)=>void)|null=null;onstart:(()=>void)|null=null;aborted=false;constructor(){Recognition.all.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.aborted=true;this.onend?.();}}Object.assign(window,{SpeechRecognition:Recognition,voiceInstances:Recognition.all});});
 await mount(page,'toolbar',props);const start=page.getByRole('region',{name:'Component fixture',exact:true}).getByRole('button',{name:'Start voice input',exact:true});await start.click();
 await page.evaluate(()=>{const instance=(window as unknown as {voiceInstances:{onresult:(event:unknown)=>void}[]}).voiceInstances[0];const value={resultIndex:0,results:[{isFinal:true,0:{transcript:'Keep the current draft'},length:1}]};instance.onresult(value);instance.onresult(value);});expect((await events(page)).filter(item=>item.type==='transcript')).toEqual([{type:'transcript',value:'Keep the current draft'}]);
 await page.evaluate(()=>{const instance=(window as unknown as {voiceInstances:{onresult:(event:unknown)=>void}[]}).voiceInstances[0];Object.assign(window,{lateVoice:instance.onresult});(window as unknown as {componentFixture:{unmount:()=>void}}).componentFixture.unmount();});
 await page.evaluate(()=>(window as unknown as {lateVoice:(event:unknown)=>void}).lateVoice({resultIndex:1,results:[null,{isFinal:true,0:{transcript:'Late input'},length:1}]}));expect((await events(page)).filter(item=>item.type==='transcript')).toHaveLength(1);expect(await page.evaluate(()=>(window as unknown as {voiceInstances:{aborted:boolean}[]}).voiceInstances[0].aborted)).toBe(true);
});

test('sentence arrival reveals only new prose while retaining selection and untouched code',async({page})=>{
 const initial='Keep this sentence.\n\n```js\nconst value = 1;\n```';await mount(page,'markdown',{text:initial,animate:true,initialReveal:false});const root=page.locator('.component-fixture .markdown');await expect(root.locator('[data-reveal-start]')).toHaveCount(0);
 await root.locator('p').evaluate(node=>{const range=document.createRange();range.setStart(node.firstChild!,0);range.setEnd(node.firstChild!,4);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));Object.assign(window,{savedProseNode:node.firstChild,savedCode:node.parentElement!.querySelector('pre')});});
 await update(page,{text:initial+'\n\nA newly arrived sentence.'});await expect(root.locator('[data-reveal-start]').first()).toBeAttached();
 expect(await root.locator('p').first().evaluate(node=>node.firstChild===(window as unknown as {savedProseNode:Node}).savedProseNode)).toBe(true);expect(await root.locator('pre').evaluate(node=>node===(window as unknown as {savedCode:Node}).savedCode)).toBe(true);
 expect(await page.evaluate(()=>getSelection()?.toString())).toBe('Keep');await expect(root.locator('pre')).toHaveText('const value = 1;\n');expect(await root.locator('[data-reveal-start]').evaluateAll(nodes=>nodes.every(node=>Number((node as HTMLElement).dataset.revealStart)>=19))).toBe(true);
});

test('rapid prose updates are bounded and unchanged snapshots or theme changes never replay an entrance',async({page})=>{
 await mount(page,'markdown',{text:'Original sentence.',animate:true,initialReveal:false});const root=page.locator('.component-fixture .markdown');
 for(let index=1;index<=16;index++)await update(page,{text:'Original sentence. '+Array.from({length:index},(_,word)=>'word'+word).join(' ')});
 expect(await root.locator('[data-reveal-start]').count()).toBeLessThanOrEqual(64);await expect(root.locator('[data-reveal-start]')).toHaveCount(0,{timeout:1500});
 await page.evaluate(()=>{const original=Element.prototype.animate;Object.assign(window,{revealReplay:0});Element.prototype.animate=function(...args){if((this as HTMLElement).dataset.revealStart!==undefined)(window as unknown as {revealReplay:number}).revealReplay++;return original.apply(this,args);};document.documentElement.dataset.theme='dark';});
 await update(page,{text:'Original sentence. '+Array.from({length:16},(_,word)=>'word'+word).join(' ')});expect(await page.evaluate(()=>(window as unknown as {revealReplay:number}).revealReplay)).toBe(0);await expect(root).toContainText('word15');
});

test('reduced-motion prose arrives immediately without a reveal backlog',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await mount(page,'markdown',{text:'A previous sentence.',animate:true,initialReveal:false});
 await page.evaluate(()=>{const original=Element.prototype.animate;Object.assign(window,{revealFrames:[]});Element.prototype.animate=function(...args){if((this as HTMLElement).dataset.revealStart!==undefined)(window as unknown as {revealFrames:unknown[]}).revealFrames.push(args);return original.apply(this,args);};});await update(page,{text:'A previous sentence. Another one arrives.'});
 await expect(page.locator('.component-fixture .markdown')).toContainText('Another one arrives.');const captured=await page.evaluate(()=>(window as unknown as {revealFrames:[Keyframe[],KeyframeAnimationOptions][]}).revealFrames);expect(captured).toHaveLength(0);
});

test('the toolbar remains keyboard reachable within a phone width',async({page})=>{
 await page.setViewportSize({width:390,height:844});await mount(page,'toolbar',props);const button=page.getByRole('region',{name:'Component fixture',exact:true}).getByRole('button',{name:'Create PR',exact:true});await button.focus();await expect(button).toBeFocused();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('replacing prose reveals the changed middle and preserves an unchanged selected prefix',async({page})=>{
 await mount(page,'markdown',{text:'Stable opening. Previous answer. Stable ending.',animate:true,initialReveal:false});const root=page.locator('.component-fixture .markdown');
 await root.locator('p').evaluate(node=>{const range=document.createRange();range.setStart(node.firstChild!,0);range.setEnd(node.firstChild!,6);getSelection()!.removeAllRanges();getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await update(page,{text:'Stable opening. Corrected answer. Stable ending.'});await expect(root.locator('[data-reveal-start]').first()).toBeAttached();expect(await page.evaluate(()=>getSelection()?.toString())).toBe('Stable');expect(await root.locator('[data-reveal-start]').evaluateAll(nodes=>nodes.every(node=>Number((node as HTMLElement).dataset.revealStart)>=16))).toBe(true);await expect(root).toHaveText('Stable opening. Corrected answer. Stable ending.');
});

test('new tokens do not cancel an already running reveal and restored history stays quiet',async({page})=>{
 await mount(page,'markdown',{text:'Opening.',animate:true,initialReveal:false});const root=page.locator('.component-fixture .markdown');await expect(root).toHaveText('Opening.');
 const result=await page.evaluate(()=>new Promise<{edges:number;connected:boolean;state:AnimationPlayState}>(resolve=>{
  const root=document.querySelector('.component-fixture .markdown')!;let cover:Element|null=null,animation:Animation|undefined;
  const observer=new MutationObserver(()=>{
   if(!cover){cover=root.querySelector('[data-reveal-start]');if(!cover)return;animation=cover.getAnimations()[0];(window as unknown as {componentFixture:{update:(next:Record<string,unknown>)=>void}}).componentFixture.update({text:'Opening. First arrival. Second arrival.'});}
   else if(root.textContent?.includes('Second arrival.')){observer.disconnect();resolve({edges:root.querySelectorAll('.sentence-reveal-edge').length,connected:cover.isConnected,state:animation!.playState});}
  });observer.observe(root,{childList:true,subtree:true,characterData:true});(window as unknown as {componentFixture:{update:(next:Record<string,unknown>)=>void}}).componentFixture.update({text:'Opening. First arrival.'});
 }));
 expect(result.edges).toBe(1);expect(result.connected).toBe(true);expect(result.state).not.toBe('idle');
 await page.evaluate(()=>(window as unknown as {componentFixture:{unmount:()=>void}}).componentFixture.unmount());expect(await page.locator('[data-reveal-start]').count()).toBe(0);
});

test('voice is revoked when work begins and interim transcripts never reach the draft',async({page})=>{
 await page.addInitScript(()=>{class Recognition{static all:Recognition[]=[];onresult:((event:unknown)=>void)|null=null;onend:(()=>void)|null=null;onerror:((event:unknown)=>void)|null=null;onstart:(()=>void)|null=null;aborted=false;constructor(){Recognition.all.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){this.aborted=true;this.onend?.();}}Object.assign(window,{SpeechRecognition:Recognition,voiceInstances:Recognition.all});});
 await mount(page,'toolbar',props);const fixture=page.getByRole('region',{name:'Component fixture',exact:true});await fixture.getByRole('button',{name:'Start voice input',exact:true}).click();
 await page.evaluate(()=>{const recognition=(window as unknown as {voiceInstances:{onresult:(event:unknown)=>void}[]}).voiceInstances[0];recognition.onresult({resultIndex:0,results:[{isFinal:false,0:{transcript:'Partial'},length:1}]});Object.assign(window,{lateVoice:recognition.onresult});});await update(page,{working:true});await expect(fixture.getByRole('button',{name:'Start voice input',exact:true})).toBeDisabled();
 await page.evaluate(()=>(window as unknown as {lateVoice:(event:unknown)=>void}).lateVoice({resultIndex:0,results:[{isFinal:true,0:{transcript:'Late'},length:1}]}));expect((await events(page)).filter(item=>item.type==='transcript')).toEqual([]);expect(await page.evaluate(()=>(window as unknown as {voiceInstances:{aborted:boolean}[]}).voiceInstances[0].aborted)).toBe(true);
});

test('fresh prose may reveal once while code stays immediately readable and unsupported voice explains why',async({page})=>{
 await page.addInitScript(()=>Object.defineProperties(window,{SpeechRecognition:{value:undefined,configurable:true},webkitSpeechRecognition:{value:undefined,configurable:true}}));await mount(page,'toolbar',props);const voice=page.getByRole('region',{name:'Component fixture',exact:true}).getByRole('button',{name:'Voice input unavailable',exact:true});await expect(voice).toBeDisabled();await expect(voice).toHaveAttribute('title','Voice input is unavailable in this browser');
 await page.addInitScript(()=>{const records:{connected:boolean;inCode:boolean}[]=[];Object.assign(window,{initialProseReveals:records});const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){if(this.hasAttribute('data-reveal-start'))records.push({connected:this.isConnected,inCode:Boolean(this.closest('pre,code'))});return animate.call(this,frames,options);};});
 await page.evaluate(()=>(window as unknown as {componentFixture:{unmount:()=>void}}).componentFixture.unmount());await mount(page,'markdown',{text:'A fresh answer.\n\n```js\nconst ready = true;\n```',animate:true,initialReveal:true});const root=page.locator('.component-fixture .markdown');await expect(root.locator('pre')).toHaveText('const ready = true;\n');
 const reveals=await page.evaluate(()=>(window as unknown as {initialProseReveals:{connected:boolean;inCode:boolean}[]}).initialProseReveals);expect(reveals.length).toBeGreaterThan(0);expect(reveals.every(reveal=>reveal.connected&&!reveal.inCode)).toBe(true);expect(await root.locator('pre [data-reveal-start]').count()).toBe(0);
});

const captureDirectory=process.env.COMPOSER_MOTION_CAPTURE_DIR;
if(captureDirectory)for(const mode of ['light','dark','narrow'] as const)test(`capture composer and sentence arrival ${mode}`,async({page})=>{
 await page.setViewportSize(mode==='narrow'?{width:390,height:844}:{width:1440,height:1000});await mount(page,'combined',{...props,text:'The checkout failure is isolated to the total calculation.'});await page.evaluate(mode=>document.documentElement.dataset.theme=mode==='dark'?'dark':'light',mode);await mkdir(captureDirectory,{recursive:true});
 await expect(page.locator('.component-fixture .composer-toolbar')).toBeVisible();await update(page,{text:'The checkout failure is isolated to the total calculation.\n\nThe patch preserves the public API and adds coverage for discounts.'});await expect(page.locator('.component-fixture .markdown')).toContainText('adds coverage for discounts');await expect(page.locator('.component-fixture [data-reveal-start]')).toHaveCount(0);await page.screenshot({path:resolve(captureDirectory,`composer-prose-${mode}.png`)});
});

for(const policy of ['off','reduced'] as const)test(`app ${policy} settles active prose and admits no new reveal`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await mount(page,'markdown',{text:'Stable opening.',animate:true});
 const root=page.locator('.component-fixture .markdown');await expect(root).toHaveText('Stable opening.');
 await page.evaluate(policy=>Object.assign(window,{proseSettlement:new Promise(resolve=>{
  const observer=new MutationObserver(()=>{const before=document.querySelectorAll('.component-fixture [data-reveal-start]').length;if(!before)return;observer.disconnect();document.documentElement.dataset.motion=policy;queueMicrotask(()=>resolve({before,after:document.querySelectorAll('.component-fixture [data-reveal-start]').length}));});observer.observe(document.querySelector('.component-fixture')!,{childList:true,subtree:true});
 })}),policy);
 await update(page,{text:'Stable opening. A deliberately long arriving sentence keeps its reveal active while preferences change.'});
 const result=await page.evaluate(()=>(window as unknown as {proseSettlement:Promise<{before:number;after:number}>}).proseSettlement);expect(result.before).toBeGreaterThan(0);expect(result.after).toBe(0);
 await update(page,{text:'Stable opening. Another sentence arrives with reduced travel.'});await expect(root).toHaveText('Stable opening. Another sentence arrives with reduced travel.');expect(await root.locator('[data-reveal-start]').count()).toBe(0);
 await page.evaluate(()=>document.documentElement.dataset.motion='system');expect(await root.locator('[data-reveal-start]').count()).toBe(0);
 await page.evaluate(()=>(window as unknown as {componentFixture:{unmount:()=>void}}).componentFixture.unmount());expect(await root.count()).toBe(0);
});
