import {test,expect,type Page} from '@playwright/test';
import {serveTaskFixture,taskFixture,growingQaSpec} from './task-interface-fixture';

async function mount(page:Page,kind:'markdown'|'artifact',props:Record<string,unknown>){
 await serveTaskFixture(page,taskFixture({root:'retained',elements:{retained:{type:'Text',props:{text:'Retained history.'}}}}));await page.goto('/');
 const motionSource=await(await page.request.get('/src/task-motion.tsx')).text(),mainSource=await(await page.request.get('/src/main.tsx')).text();
 const modules={react:motionSource.match(/["']([^"']*\/react\.js[^"']*)["']/)![1],dom:mainSource.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)![1]};
 await page.evaluate(async({kind,props,modules})=>{
  const reactModule=await import(modules.react),domModule=await import(modules.dom),React=reactModule.default??reactModule,DOM=domModule.default??domModule;
  const motionPath='/src/task-motion.tsx',markdownPath='/src/Markdown.tsx';const motion=await import(motionPath),markdown=await import(markdownPath);
  const target=document.createElement('section');target.className='micro-motion-fixture';target.setAttribute('aria-label','Micro motion fixture');target.style.cssText='position:fixed;inset:0;padding:40px;background:var(--surface);z-index:10000;overflow:auto';document.body.append(target);
  function ArtifactProbe({value}:{value:Record<string,unknown>}){
   const ref=React.useRef(null),body=React.useRef(null);motion.useArtifactEntrance(ref,value.enter===true,body);
   return React.createElement('section',{ref,className:'artifact micro-motion-artifact',style:{width:600,maxWidth:'100%',margin:0,padding:0,border:'1px solid #777',boxSizing:'border-box'}},
    React.createElement('header',{style:{height:36,minHeight:36,padding:0}},'A newly published task'),
    React.createElement('div',{ref:body,className:'artifact-body',style:{height:Number(value.bodyHeight),padding:12,boxSizing:'border-box'}},
     React.createElement(markdown.Markdown,{text:String(value.text??'Live task description.'),animate:true}),
     React.createElement('input',{'aria-label':'Live task draft',defaultValue:'Keep my draft'})));
  }
  let current={...props};const root=DOM.createRoot(target);
  const render=()=>root.render(kind==='artifact'?React.createElement(ArtifactProbe,{value:current}):React.createElement(markdown.Markdown,{text:current.text,animate:true,initialReveal:false}));
  render();Object.assign(window,{microMotionFixture:{update:(next:Record<string,unknown>)=>{current={...current,...next};render();},unmount:()=>root.unmount()}});
 },{kind,props,modules});
 await expect(page.getByRole('region',{name:'Micro motion fixture',exact:true})).toBeVisible();
}
const update=(page:Page,value:Record<string,unknown>)=>page.evaluate(value=>(window as unknown as{microMotionFixture:{update:(value:Record<string,unknown>)=>void}}).microMotionFixture.update(value),value);

test('new prose has a moving soft edge while prior text and code stay fully readable',async({page})=>{
 const before='Keep this sentence.\n\n```ts\nconst stable = true;\n```';await mount(page,'markdown',{text:before});
 await update(page,{text:before+'\n\nThe new explanation arrives as a readable sentence, without replacing earlier work.'});
 const root=page.locator('.micro-motion-fixture .markdown'),cover=root.locator('.sentence-reveal-veil').first();await expect(cover).toBeAttached();
 const paint=await cover.evaluate(node=>{const animation=node.getAnimations()[0];animation.pause();const timing=animation.effect!.getTiming();animation.currentTime=Number(timing.delay)+Number(timing.duration)*.5;return{clip:getComputedStyle(node).clipPath,opacity:Number(getComputedStyle(node).opacity)};});
 expect(paint.opacity).toBe(1);await expect(root.locator('.sentence-reveal-edge').first()).toBeAttached();
 await expect(root).toContainText('Keep this sentence.');await expect(root.locator('pre')).toHaveText('const stable = true;\n');await expect(root.locator('pre .sentence-reveal-veil')).toHaveCount(0);
 expect(await root.evaluate(node=>getComputedStyle(node).opacity)).toBe('1');
});

test('a theme change clears the old-color reveal without replaying the text',async({page})=>{
 await mount(page,'markdown',{text:'The retained result.'});await update(page,{text:'The retained result. A new detail is arriving.'});const covers=page.locator('.micro-motion-fixture .sentence-reveal-veil');await expect(covers.first()).toBeAttached();
 await covers.evaluateAll(nodes=>nodes.forEach(node=>node.getAnimations().forEach(animation=>animation.pause())));
 const retained=await page.evaluate(async()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return document.querySelectorAll('.micro-motion-fixture .sentence-reveal-veil').length;});expect(retained).toBe(0);
 await expect(page.locator('.micro-motion-fixture .markdown')).toHaveText('The retained result. A new detail is arriving.');
});

test('live artifact growth uses natural layout without replaying the entrance or tweening height',async({page})=>{
 await mount(page,'artifact',{enter:true,bodyHeight:45,text:'Preparing the task.'});
 const artifact=page.locator('.micro-motion-artifact');expect((await artifact.boundingBox())!.height).toBeCloseTo(118,0);
 await update(page,{bodyHeight:340,text:'The complete task now includes the supplied material and useful controls.'});
 await expect.poll(async()=>(await artifact.boundingBox())!.height).toBeCloseTo(378,0);
 const heights=await artifact.evaluate(async node=>{const samples:number[]=[];for(let frame=0;frame<8;frame++){samples.push(node.getBoundingClientRect().height);await new Promise(requestAnimationFrame);}return samples;});
 expect(heights.every(height=>height===378)).toBe(true);expect(await artifact.evaluate(node=>(node as HTMLElement).style.height)).toBe('');
 await expect(page.getByRole('textbox',{name:'Live task draft',exact:true})).toHaveValue('Keep my draft');
});

test('newly published structured prose reveals once while restored prose remains quiet',async({page})=>{
 const snapshot=taskFixture({root:'fact',elements:{fact:{type:'Text',props:{text:'The new task keeps its actual source material and its editing controls together.'}}}}),artifact=snapshot.artifacts[0];snapshot.artifacts=[];
 await page.addInitScript(()=>{const animate=Element.prototype.animate;Object.assign(window,{structuredReveals:0});Element.prototype.animate=function(...args){if(this.closest('.artifact')&&(this as HTMLElement).dataset.revealStart!==undefined)(window as unknown as{structuredReveals:number}).structuredReveals++;return animate.apply(this,args);};});
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();snapshot.artifacts=[artifact];await host.publish();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as{structuredReveals:number}).structuredReveals)).toBeGreaterThan(0);
 await page.waitForTimeout(800);const count=await page.evaluate(()=>(window as unknown as{structuredReveals:number}).structuredReveals);await host.publish();expect(await page.evaluate(()=>(window as unknown as{structuredReveals:number}).structuredReveals)).toBe(count);
 await page.reload();await expect(page.locator('.artifact .surface-text')).toBeVisible();expect(await page.evaluate(()=>(window as unknown as{structuredReveals:number}).structuredReveals)).toBe(0);
});

test('a first fetched answer gets its own text reveal after the real pending phase',async({page})=>{
 const snapshot=taskFixture(growingQaSpec,{answer:{status:'pending'}},{deliveryOpen:true});
 await page.addInitScript(()=>{const animate=Element.prototype.animate;Object.assign(window,{firstAnswerReveals:0});Element.prototype.animate=function(...args){if(this.classList.contains('task-answer-reveal'))(window as unknown as{firstAnswerReveals:number}).firstAnswerReveals++;return animate.apply(this,args);};});
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');await expect(page.locator('.disclosure-pending')).toBeVisible();host.setInput('answer',{status:'ready',answer:'Choose a destination for each package. Both addresses remain available for review.'});await host.publish();
 await expect(page.getByText('Choose a destination for each package. Both addresses remain available for review.',{exact:true})).toBeVisible();await expect.poll(()=>page.evaluate(()=>(window as unknown as{firstAnswerReveals:number}).firstAnswerReveals)).toBeGreaterThan(0);
});

test('actual pending follows the prose tail and disappears when the answer settles',async({page})=>{
 const snapshot=taskFixture(growingQaSpec,{answer:{status:'pending',answer:'Choose a destination for each package.'}},{deliveryOpen:true});const host=await serveTaskFixture(page,snapshot);await page.goto('/');
 const answer=page.locator('.task-incoming-answer').first();await expect(answer).toHaveAttribute('data-answer-pending','true');await expect(answer).toHaveAttribute('data-answer-visible','true');
 const mark=await answer.locator('.markdown>p').last().evaluate(node=>({content:getComputedStyle(node,'::after').content,display:getComputedStyle(node,'::after').display,width:parseFloat(getComputedStyle(node,'::after').width),state:getComputedStyle(node,'::after').animationPlayState}));expect(mark.content).not.toBe('none');expect(mark.display).toBe('inline-block');expect(mark.width).toBe(7);expect(mark.state).toBe('running');
 await expect(answer.locator('.task-answer-tail-fallback')).not.toBeVisible();host.setInput('answer',{status:'ready',answer:'Choose a destination for each package.'});await host.publish();await expect(answer).toHaveAttribute('data-answer-pending','false');await expect(answer.locator('.task-answer-tail-fallback')).toHaveCount(0);await expect(answer).toHaveText('Choose a destination for each package.');
});

test('code remains unmodified and the pending mark stays outside its source block',async({page})=>{
 const source='```ts\nconst ready = true;\n```';await serveTaskFixture(page,taskFixture(growingQaSpec,{answer:{status:'pending',answer:source}},{deliveryOpen:true}));await page.goto('/');
 const answer=page.locator('.task-incoming-answer').first();await expect(answer).toHaveAttribute('data-answer-pending','true');await expect(answer.locator('.task-answer-tail-fallback')).toBeVisible();await expect(answer.locator('pre')).toHaveText('const ready = true;\n');expect(await answer.locator('pre').evaluate(node=>getComputedStyle(node,'::after').content)).toBe('none');
});

test('the waiting mark is static under reduced motion and pauses after its branch closes',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await serveTaskFixture(page,taskFixture(growingQaSpec,{answer:{status:'pending',answer:'The supplied answer is still arriving.'}},{deliveryOpen:true}));await page.goto('/');const answer=page.locator('.task-incoming-answer').first();await expect(answer).toHaveAttribute('data-answer-visible','true');expect(await answer.locator('.markdown>p').last().evaluate(node=>getComputedStyle(node,'::after').animationName)).toBe('none');
 await page.getByRole('button',{name:'Can delivery be split?',exact:true}).click();await expect(answer).toHaveAttribute('data-answer-visible','false');
});

test('reduced motion keeps real content and immediate focus without spatial reveal effects',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await mount(page,'artifact',{enter:true,bodyHeight:180,text:'The new task remains immediately usable.'});
 const input=page.getByRole('textbox',{name:'Live task draft',exact:true});await input.focus();await expect(input).toBeFocused();await input.fill('Preserved edit');
 const state=await page.locator('.micro-motion-artifact').evaluate(node=>({height:(node as HTMLElement).style.height,frames:node.getAnimations().flatMap(animation=>(animation.effect as KeyframeEffect).getKeyframes())}));expect(state.height).toBe('');expect(state.frames.every(frame=>frame.transform===undefined&&frame.filter===undefined)).toBe(true);await expect(input).toHaveValue('Preserved edit');
});


test('new prose advances in whole Unicode graphemes with a bounded discrete edge',async({page})=>{
 await mount(page,'markdown',{text:'Retained prose.'});
 await update(page,{text:'Retained prose. '+('A\u{1F469}\u{1F3FD}\u200D\u{1F4BB} e\u0301 arrives with its complete family \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}. ').repeat(12)});
 const layer=page.locator('.micro-motion-fixture .sentence-reveal-layer');
 await expect(layer.locator('[data-reveal-progress]').first()).toBeAttached();
 const states=await page.evaluate(async()=>{const samples:{progress:number,edge:number,whole:boolean}[]=[];const prose=document.querySelector('.micro-motion-fixture .markdown')!.textContent!;const boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(prose)].map(segment=>segment.index));for(let i=0;i<8;i++){const cover=document.querySelector<HTMLElement>('.micro-motion-fixture [data-reveal-progress]');if(cover)samples.push({progress:Number(cover.dataset.revealProgress),whole:boundaries.has(Number(cover.dataset.revealProgress)),edge:document.querySelectorAll('.micro-motion-fixture .sentence-reveal-edge').length});await new Promise(resolve=>setTimeout(resolve,25));}return samples;});
 expect(states.every(state=>state.whole)).toBe(true);expect(new Set(states.map(state=>state.progress)).size).toBeGreaterThan(2);expect(states.some(state=>state.edge>0)).toBe(true);
 await page.waitForTimeout(470);expect(await layer.locator('*').count()).toBe(0);
});

test('interaction and reduced motion immediately settle arriving prose',async({page})=>{
 await mount(page,'markdown',{text:'Retained prose.'});await update(page,{text:'Retained prose. '+('A newly arriving sentence. ').repeat(30)});
 await expect(page.locator('.micro-motion-fixture .sentence-reveal-veil').first()).toBeAttached();
 await page.locator('.micro-motion-fixture .markdown').dispatchEvent('pointerdown');expect(await page.locator('.micro-motion-fixture .sentence-reveal-layer>*').count()).toBe(0);
 await page.emulateMedia({reducedMotion:'reduce'});await update(page,{text:'Retained prose. A reduced motion result.'});await expect(page.locator('.micro-motion-fixture .sentence-reveal-layer>*')).toHaveCount(0);
});


test('operation tab status slots keep labels and mounted drafts fixed through completion',async({page})=>{
 const snapshot=taskFixture({root:'tabs',elements:{tabs:{type:'Tabs',props:{labels:['users','projects'],stateKey:'table',statusBinding:'operation'},children:['users','projects']},users:{type:'Input',props:{label:'User draft',stateKey:'userDraft'}},projects:{type:'Input',props:{label:'Project draft',stateKey:'projectDraft'}}}},{operation:{status:'pending',items:[{label:'users',status:'neutral'},{label:'projects',status:'neutral'}]}},{table:'users'});
 const host=await serveTaskFixture(page,snapshot);await page.goto('/');const users=page.getByRole('tab',{name:'users',exact:true}),draft=page.getByRole('textbox',{name:'User draft',exact:true});await draft.fill('Keep this local edit');const identity=await draft.elementHandle();
 const left=await users.locator('.task-tab-label').evaluate(node=>node.getBoundingClientRect().left);
 host.setInput('operation',{status:'running',items:[{label:'users',status:'running'},{label:'projects',status:'neutral'}]});await host.publish();await expect(users.locator('.spinning')).toHaveCount(1);expect(await users.locator('.task-tab-label').evaluate(node=>node.getBoundingClientRect().left)).toBeCloseTo(left,1);
 host.setInput('operation',{status:'success',items:[{label:'users',status:'success'},{label:'projects',status:'success'}]});await host.publish();await expect(page.locator('.task-tabs-operation .spinning')).toHaveCount(0);expect(await users.locator('.task-tab-label').evaluate(node=>node.getBoundingClientRect().left)).toBeCloseTo(left,1);await expect(users).toHaveAttribute('aria-selected','true');await expect(draft).toHaveValue('Keep this local edit');expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
 await page.getByRole('tab',{name:'projects',exact:true}).click();await users.click();expect(await draft.evaluate((node,old)=>node===old,identity)).toBe(true);
});
