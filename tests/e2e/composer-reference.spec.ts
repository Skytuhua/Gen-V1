import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {taskFixture,serveTaskFixture} from './task-interface-fixture';

async function mount(page:Page,width=1440,theme='light'){
 await page.setViewportSize({width,height:1000});await serveTaskFixture(page,taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Reference fixture'}}}}));await page.goto('/');
 await page.evaluate(async({reactPath,domPath,theme})=>{
  const r=await import(reactPath),d=await import(domPath),React=r.default??r,DOM=d.default??d;
  const stylePath='/src/styles.css';await import(stylePath);const entry='/src/ComposerToolbar.tsx',module=await import(entry);const events:string[]=[];
  const root=document.createElement('section');root.className='composer-reference-fixture';root.setAttribute('aria-label','PR composer fixture');root.style.cssText='position:fixed;inset:0;background:var(--canvas);z-index:10000;padding:140px 16px 30px;overflow:auto;';document.body.append(root);document.documentElement.dataset.theme=theme;
  const current={models:[{id:'test/sol',name:'GPT-6.1 Sol',provider:'test',thinkingLevels:['low','medium','high']}],modelId:'test/sol',thinkingLevel:'medium',projectLabel:'acme-webapp',changeSummary:{added:482,removed:37},onModelChange:()=>events.push('model'),onThinkingChange:()=>events.push('effort'),onProject:()=>events.push('project'),onChanges:()=>events.push('changes'),onCreatePR:()=>events.push('pr'),onTranscript:()=>{}};
  const h=React.createElement,button=(label:string,children:unknown)=>{const send=label.startsWith('Send'),attach=label.startsWith('Attach');const glyph=label.startsWith('Inspect')?h('svg',{width:15,height:15,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.4,'aria-hidden':true},h('path',{d:'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M7 13v4'})):send?h('svg',{width:18,height:18,viewBox:'0 0 20 20',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},h('path',{d:'m5 9 5-5 5 5M10 4v12'})):children;return h('button',{type:'button',className:send?'send-button':attach?'icon-button attach-button':'icon-button','aria-label':label,onClick:()=>events.push(label)},glyph);};
  const actions=module.ComposerTaskActions?h(module.ComposerTaskActions,current):null;
  DOM.createRoot(root).render(h('div',{className:'composer-dock',style:{width:'100%',maxWidth:760,margin:'0 auto'}},actions,
   h('form',{className:'composer',onSubmit:(event:Event)=>event.preventDefault()},h('textarea',{'aria-label':'Fixture message',placeholder:'Ask anything, or type / for skills',rows:2}),
    h(module.ComposerToolbar,{...current,separateActions:true,
     leading:button('Attach reference files','+'),runtime:h(React.Fragment,null,h('span',{className:'pill runtime-pill'},'Local'),h('label',{className:'mode-picker'},h('select',{'aria-label':'Fixture task mode'},h('option',null,'Build')))),
     context:button('Inspect reference context','Context'),trailing:button('Send reference message','Send')})),
   h('button',{type:'button',className:'icon-button','aria-label':'Close reference panel',style:{marginTop:24}},h('svg',{className:'lucide lucide-x',width:16,height:16,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:'M6 6l12 12M6 18L18 6',stroke:'currentColor',strokeWidth:2}))),
   h('button',{type:'button',className:'icon-button','aria-label':'Minimize reference panel',style:{marginTop:24}},h('svg',{className:'lucide lucide-chevron-down',width:16,height:16,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:'M6 9l6 6 6-6',stroke:'currentColor',strokeWidth:2})))));
  Object.assign(window,{composerReferenceEvents:events});
 },{reactPath:'/@fs/'+resolve('node_modules/.vite/deps/react.js').replaceAll('\\','/'),domPath:'/@fs/'+resolve('node_modules/.vite/deps/react-dom_client.js').replaceAll('\\','/'),theme});
 await expect(page.getByRole('region',{name:'PR composer fixture',exact:true})).toBeVisible();return page.getByRole('region',{name:'PR composer fixture',exact:true});
}

test('reference composer has context chips above one compact footer and keeps every working control',async({page})=>{
 const fixture=await mount(page);const card=fixture.locator('.composer'),actions=fixture.locator('.composer-secondary-actions');await expect(actions).toBeVisible();await expect(actions.getByRole('button',{name:'Create PR',exact:true})).toBeVisible();
 expect((await actions.boundingBox())!.y+(await actions.boundingBox())!.height).toBeLessThanOrEqual((await card.boundingBox())!.y);
 const footer=card.locator('.composer-toolbar');for(const name of ['Attach reference files','Open project folder','Inspect reference context','Send reference message'])await expect(footer.getByRole('button',{name,exact:true})).toBeVisible();
 await expect(footer.getByRole('combobox',{name:'Model',exact:true})).toBeVisible();await expect(footer.locator('.model-picker-trigger-effort')).toHaveText('Medium');await expect(footer.getByRole('button',{name:'Create PR',exact:true})).toHaveCount(0);
 const controls=await footer.locator('.composer-footer-main').boundingBox();expect(controls!.height).toBeLessThanOrEqual(38);expect((await card.boundingBox())!.height).toBeLessThanOrEqual(122);
 await actions.getByRole('button',{name:'Inspect changes',exact:true}).click();await actions.getByRole('button',{name:'Create PR',exact:true}).click();await footer.getByRole('button',{name:'Open project folder',exact:true}).click();expect(await page.evaluate(()=>(window as unknown as {composerReferenceEvents:string[]}).composerReferenceEvents)).toEqual(['changes','pr','project']);
});

test('close X is red while non-destructive chrome stays neutral, with saturated accessible semantic colors',async({page})=>{
 for(const theme of ['light','dark']){
  const fixture=await mount(page,1440,theme);
  const colors=await fixture.evaluate(element=>{const css=getComputedStyle(document.documentElement),names=['--canvas','--surface','--accent','--danger','--success','--pending','--accent-solid','--accent-hover'];return Object.fromEntries(names.map(name=>{const probe=document.createElement('span');probe.style.color=css.getPropertyValue(name);element.append(probe);const color=getComputedStyle(probe).color;probe.remove();return[name,color];}));});
  const close=await fixture.getByRole('button',{name:'Close reference panel',exact:true}).locator('svg').evaluate(node=>getComputedStyle(node).color);expect(close).toBe(colors['--danger']);expect(await fixture.getByRole('button',{name:'Minimize reference panel',exact:true}).locator('svg').evaluate(node=>getComputedStyle(node).color)).not.toBe(colors['--danger']);
  const rgb=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number);const luminance=(color:string)=>rgb(color).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;}).reduce((sum,n,index)=>sum+n*[.2126,.7152,.0722][index]!,0);
  for(const name of ['--accent','--danger','--success','--pending']){const first=luminance(colors[name]!),second=luminance(colors['--surface']!);expect((Math.max(first,second)+.05)/(Math.min(first,second)+.05),theme+name).toBeGreaterThanOrEqual(4.5);}for(const name of ['--accent-solid','--accent-hover'])expect(1.05/(luminance(colors[name]!)+.05),theme+name).toBeGreaterThanOrEqual(4.5);
  const [red,green,blue]=rgb(colors['--danger']!);expect(red).toBeGreaterThan(green!*1.5);expect(red).toBeGreaterThan(blue!*1.3);
  await fixture.evaluate(node=>node.remove());
 }
});

test('reference composer reflows by its own width, preserves keyboard access and avoids horizontal overflow',async({page})=>{
 const fixture=await mount(page,390);await page.emulateMedia({reducedMotion:'reduce'});const dock=fixture.locator('.composer-dock');expect(await dock.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 const footer=fixture.locator('.composer-toolbar');const trigger=footer.getByRole('combobox',{name:'Model',exact:true});await trigger.focus();await page.keyboard.press('Enter');const picker=page.getByRole('dialog',{name:'Model and reasoning',exact:true});await expect(picker.getByRole('searchbox',{name:'Search models',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);await expect(trigger).toBeFocused();
 await footer.getByRole('button',{name:'Send reference message',exact:true}).focus();await expect(footer.getByRole('button',{name:'Send reference message',exact:true})).toBeFocused();
 await expect(footer.getByText('Local',{exact:true})).toBeVisible();for(const name of ['Open project folder','Inspect reference context','Send reference message']){const box=await footer.getByRole('button',{name,exact:true}).boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);}
});

if(process.env.COMPOSER_REFERENCE_CAPTURE_DIR)for(const mode of ['light','dark','narrow'] as const)test(`capture reference composer ${mode}`,async({page})=>{const fixture=await mount(page,mode==='narrow'?390:1440,mode==='dark'?'dark':'light');await fixture.getByRole('textbox',{name:'Fixture message',exact:true}).fill('Refresh the session before checkout expires.');const path=resolve(process.env.COMPOSER_REFERENCE_CAPTURE_DIR!);await mkdir(path,{recursive:true});await page.screenshot({path:resolve(path,`composer-reference-${mode}.png`)});});

test('actual integrated context inspector stays anchored above the compact composer and inside the viewport',async({page})=>{
 await serveTaskFixture(page,taskFixture({root:'text',elements:{text:{type:'Text',props:{text:'Context fixture'}}}}));
 for(const width of [1440,900,390]){
  await page.setViewportSize({width,height:1000});await page.goto('/');const trigger=page.getByRole('button',{name:'Inspect context usage',exact:true});await trigger.click();const popover=page.getByRole('dialog',{name:'Context inspector',exact:true});await expect(popover).toBeVisible();
  const panel=await popover.boundingBox(),anchor=await trigger.boundingBox();expect(panel!.x).toBeGreaterThanOrEqual(0);expect(panel!.x+panel!.width).toBeLessThanOrEqual(width);expect(panel!.y).toBeGreaterThanOrEqual(0);expect(panel!.y+panel!.height).toBeLessThanOrEqual(anchor!.y+3);expect(panel!.width).toBeGreaterThanOrEqual(280);await page.keyboard.press('Escape');await expect(popover).toHaveCount(0);await expect(trigger).toBeFocused();
 }
});
