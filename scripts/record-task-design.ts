import {spawn} from 'node:child_process';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {expect,type Page,type Locator} from '@playwright/test';
import {CAPABILITIES,validateSurface} from '../packages/ui-catalog/index.ts';
import type {HostCommand,Snapshot} from '../packages/contracts/index.ts';
import {taskFixture,serveTaskFixture} from '../tests/e2e/task-interface-fixture.ts';
import {createSigningPdfFixture} from '../tests/e2e/document-preview-fixture.ts';
import {proceduralComparisonPng} from './expanded-review-host.ts';
import {openCaptureBrowser,recordWindow,captureTheme,installThemeAudit,type CaptureTheme} from './review-capture.ts';
import {graphData,graphSpec,type PRPhase} from './review-pr.ts';
import {taskDesignScenes,TASK_DESIGN_SELECTORS,TASK_DESIGN_PROVENANCE,type TaskDesignScene} from './task-design-scenes.ts';

const argument=(name:string)=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1];};
const requestedTheme=captureTheme(argument('--theme'));
const scenes=taskDesignScenes(),advertised=CAPABILITIES.map(item=>item.name).sort();
const componentNames=(scene:TaskDesignScene)=>[...new Set(Object.values(scene.spec.elements).map(node=>node.type))].sort();
for(const scene of scenes)validateSurface(scene.spec);
const missing=advertised.filter(name=>!scenes.some(scene=>componentNames(scene).includes(name)));
if(missing.length)throw new Error('Recording scenes omit advertised components: '+missing.join(', '));
for(const name of advertised)if(!TASK_DESIGN_SELECTORS[name])throw new Error('No visible selector for '+name);
if(process.argv.includes('--list')||process.argv.includes('--dry-run')){
 console.log(JSON.stringify({provenance:TASK_DESIGN_PROVENANCE,advertised,missing,scenes:scenes.map(scene=>({id:scene.id,title:scene.title,components:componentNames(scene)})),command:'pnpm exec tsx scripts/record-task-design.ts --output <fresh-directory> [--stills-only] [--scenes id,id] [--variants light,dark,narrow]'},null,2));
}else await record();

type Fixture=Awaited<ReturnType<typeof serveTaskFixture>>;
type Chapter={title:string;startSeconds:number;frame:string;visibleComponents:string[]};
type Observation={component:string;scene:string;variant:string;chapter:string;frame:string;selector:string;interaction?:string};
type SceneResult={scene:string;title:string;variant:string;theme:CaptureTheme;themeAudit?:unknown;fixture:true;caption:string;video?:string;chapters:Chapter[];observations:Observation[];probe?:unknown;commands?:{type:string;actionId?:unknown}[];failed?:string};
type Context={page:Page;host:Fixture;scene:TaskDesignScene;stills:boolean;chapter:(title:string)=>Promise<void>;hold:(ms?:number)=>Promise<void>;click:(locator:Locator)=>Promise<void>;check:(component:string,description:string)=>void};
function recordWait(stills:boolean,ms=700){return delay(stills?Math.min(140,ms):ms);}

async function startVite(){
 try{await fetch('http://127.0.0.1:5465',{signal:AbortSignal.timeout(500)});throw new Error('Port5465 is already in use; no existing server will be adopted.');}catch(error){if(error instanceof Error&&error.message.startsWith('Port5465'))throw error;}
 const root=resolve(import.meta.dirname,'..'),child=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5465','--strictPort'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',failure:Error|undefined;child.stdout?.on('data',bytes=>{output=(output+String(bytes)).slice(-12000);});child.stderr?.on('data',bytes=>{output=(output+String(bytes)).slice(-12000);});child.on('error',error=>{failure=error;});
 const stop=()=>new Promise<void>(done=>{if(child.exitCode!==null){done();return;}const timer=setTimeout(()=>{child.kill('SIGKILL');done();},4000);child.once('exit',()=>{clearTimeout(timer);done();});child.kill('SIGTERM');});
 try{for(let attempt=0;attempt<80;attempt++){if(failure)throw failure;if(child.exitCode!==null)throw new Error('Owned Vite5465 exited: '+output);if(output.includes('http://127.0.0.1:5465'))try{const response=await fetch('http://127.0.0.1:5465',{signal:AbortSignal.timeout(500)});if(response.ok)return {child,stop};}catch{}await delay(150);}throw new Error('Owned Vite5465 did not become ready: '+output);}catch(error){await stop();throw error;}
}

async function installFixture(page:Page,scene:TaskDesignScene,theme:'light'|'dark',stills:boolean){
 // tsx preserves function names inside serialized fixture callbacks. Supply its
 // naming helper to this intercepted test page; no application code uses it.
 await page.addInitScript({content:'globalThis.__name = (target, name) => Object.defineProperty(target, "name", {value: name, configurable: true});'});
 const snapshot=taskFixture(structuredClone(scene.spec),structuredClone(scene.inputs),structuredClone(scene.values??{}));
 snapshot.settings.theme=theme;snapshot.artifacts[0].title=scene.title;snapshot.artifacts[0].purpose='Synthetic renderer review';snapshot.messages[0].content=scene.request;snapshot.messages[0].role='user';snapshot.threads[0].title=scene.title;snapshot.threads[0].projectName='Task-specific interface review';
 const assets=new Map<string,{bytes:Uint8Array;type:string}>();assets.set('before-image',{bytes:proceduralComparisonPng(false),type:'image/png'});assets.set('after-image',{bytes:proceduralComparisonPng(true),type:'image/png'});assets.set('agreement',{bytes:await createSigningPdfFixture({pages:2}),type:'application/pdf'});
 const grant=(id:string)=>({id,threadId:'task-thread',kind:'attachment' as const,path:`C:/synthetic-recording/${id}`,label:id==='agreement'?'agreement.pdf':id+'.png',writable:false,createdAt:new Date().toISOString()});
 snapshot.resources=[...assets.keys()].map(grant);
 const actionIds=new Set(Object.values(scene.spec.elements).flatMap(node=>['actionId','onOpenActionId','feedbackActionId'].flatMap(key=>typeof node.props[key]==='string'?[String(node.props[key])]:[])));
 for(const id of [...actionIds,'resolve','merge','answer','ask'])snapshot.artifacts[0].actions[id]={kind:'agent'};
 let host!:Fixture;
 const publish=async()=>{snapshot.artifacts[0].updatedAt=new Date().toISOString();await host.publish();};
 const phase=async(value:PRPhase,completed=0)=>{host.setInput('graph',graphData(value,completed));snapshot.artifacts[0].spec=graphSpec('vertical',value);snapshot.artifacts[0].revision++;await publish();};
 host=await serveTaskFixture(page,snapshot,async command=>{
  const actionId=command.payload.actionId;
  if(scene.id.startsWith('pr-')&&actionId==='resolve'){await phase('resolving');await delay(1100);await phase('resolving',8);await delay(900);await phase('resolving',42);await delay(600);await phase('ready');}
  else if(scene.id.startsWith('pr-')&&actionId==='merge'){await phase('merging');await delay(1600);await phase('merged');}
  else if(scene.id==='questions'&&actionId==='answer'){
   host.setInput('retry',{status:'pending'});await publish();await recordWait(stills,600);
   host.setInput('retry',{status:'ready',answer:'Reuse the same idempotency key when retrying the same order. Inspect the recorded result before starting a different order.',followupsPending:true});await publish();await recordWait(stills,500);
   snapshot.artifacts[0].spec!.elements.followup={type:'Disclosure',props:{title:'When should the key change?',stateKey:'keyOpen',text:'Use a new key for a different order, not for another delivery attempt of the same order.'}};snapshot.artifacts[0].spec!.elements.retry.children!.push('followup');snapshot.artifacts[0].revision++;host.setInput('retry',{status:'ready',answer:'Reuse the same idempotency key when retrying the same order. Inspect the recorded result before starting a different order.',followupsPending:false});await publish();
  }else if(scene.id==='questions'&&actionId==='ask'){
   const question=String((command.payload.payload as Record<string,unknown>)?.question??'');
   if(question.trim()){snapshot.artifacts[0].spec!.elements.newQuestion={type:'Disclosure',props:{title:question,stateKey:'newQuestionOpen',defaultOpen:true,text:'Inspect the response and existing order using the same key before submitting a different order.'}};snapshot.artifacts[0].spec!.elements.questions.children!.splice(-1,0,'newQuestion');snapshot.artifacts[0].revision++;await publish();}
  }
  return {accepted:true,fixture:true};
 });
 await page.route('**/api/resources/*/content*',async route=>{const id=decodeURIComponent(new URL(route.request().url()).pathname.split('/')[3]??''),asset=assets.get(id);await route.fulfill(asset?{contentType:asset.type,body:Buffer.from(asset.bytes)}:{status:404});});
 await page.route('**/api/commands',async route=>{const command=route.request().postDataJSON() as HostCommand;if(command.type!=='resource.upload')return route.fallback();const bytes=Buffer.from(String(command.payload.base64),'base64'),id='recorded-mark-'+randomUUID(),resource=grant(id);assets.set(id,{bytes,type:'image/png'});snapshot.resources.push(resource);snapshot.seq++;await route.fulfill({json:{commandId:command.id,seq:snapshot.seq,result:resource}});});
 let tokenPresent=false,version=0;
 await page.route('**/api/artifacts/task-surface/credentials/projectApiToken*',async route=>{const method=route.request().method();if(method!=='GET'){tokenPresent=method==='PUT';version++;}await route.fulfill({json:{present:tokenPresent,version,expiresAt:tokenPresent?Date.now()+3600000:null}});});
 const initialArtifact=snapshot.artifacts[0];
 if(!stills)snapshot.artifacts=[];
 return {...host,publishInitial:async()=>{if(!snapshot.artifacts.length){snapshot.artifacts.push(initialArtifact);await host.publish();}}};
}

async function record(){
 const stills=process.argv.includes('--stills-only'),wanted=argument('--scenes')?.split(','),selected=wanted?scenes.filter(scene=>wanted.includes(scene.id)):scenes;
 if(!selected.length||wanted?.some(id=>!selected.some(scene=>scene.id===id)))throw new Error('Use --list to choose valid scene IDs.');
 const variants=stills?(argument('--variants')??'light,dark,narrow').split(','):['recording'];if(variants.some(value=>!['light','dark','narrow','recording'].includes(value)))throw new Error('Variants: light,dark,narrow');
 const output=resolve(argument('--output')??`docs/evidence/task-specific-ui-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(output,{recursive:true});
 try{await access(join(output,'manifest.json'));throw new Error('Choose a fresh output directory; prior evidence will not be overwritten.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const manifest={provenance:TASK_DESIGN_PROVENANCE,renderer:'Actual Vite source renderer on an exclusively owned loopback server; HTTP/SSE protocol is intercepted by explicit fixtures.',mode:stills?'stills':'video',createdAt:new Date().toISOString(),advertised,sourceCompositionPairs:[['time-offered','time-visits'],['review-copy','review-patch'],['investigation-failure','investigation-latency']].filter(pair=>pair.every(id=>selected.some(scene=>scene.id===id))),captures:[] as SceneResult[],coverage:[] as Observation[],missing:advertised.slice()};
 const save=async()=>{manifest.coverage=manifest.captures.flatMap(result=>result.observations);manifest.missing=advertised.filter(name=>!manifest.coverage.some(row=>row.component===name));await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2));};
 const owned=await startVite();let browser:Awaited<ReturnType<typeof openCaptureBrowser>>|undefined;
 try{
  browser=await openCaptureBrowser();await browser.context.close();
  for(const scene of selected)for(const variant of variants){
   const theme=variant==='dark'?'dark':variant==='light'?'light':requestedTheme,viewport=variant==='narrow'?{width:390,height:844}:{width:1920,height:1080};
   const context=await browser.browser.newContext({viewport,deviceScaleFactor:1,colorScheme:theme}),page=await context.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
   const audit=await installThemeAudit(page,theme);
   const result:SceneResult={scene:scene.id,title:scene.title,variant,theme,fixture:true,caption:scene.caption??TASK_DESIGN_PROVENANCE,chapters:[],observations:[]};manifest.captures.push(result);
   let stop:undefined|(()=>Promise<Record<string,unknown>>);let started=performance.now();const base=scene.id+'-'+variant,observed=new Set<string>(),interactions=new Map<string,string>();
   try{
    const host=await installFixture(page,scene,theme,stills);await page.goto('http://127.0.0.1:5465/');await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
    if(stills){audit.reset();}else{result.video=base+'.mp4';stop=await recordWindow(browser.server,page,join(output,result.video));started=performance.now();await delay(900);await host.publishInitial();}
    await expect(page.locator('.artifact')).toBeVisible();if(stills)audit.reset();await audit.assert();
    if(scene.id==='document')await expect(page.locator('.document-preview')).toHaveAttribute('data-preview-state','ready',{timeout:25000});
    if(scene.id==='image-work')await expect(page.locator('.image-compare-stage')).toHaveAttribute('data-ready','true');
    const chapter=async(title:string)=>{
     await delay(stills?650:500);
     // QA stills inspect settled frames; video audits remain continuous through
     // navigation, including all transient root-theme changes.
     if(stills)audit.reset();await audit.assert();const visible:string[]=[];
     for(const component of componentNames(scene)){
      const locator=page.locator('.artifact '+TASK_DESIGN_SELECTORS[component]).filter({visible:true}).first();
      if(await locator.count()&&await locator.isVisible()&&await locator.evaluate(node=>{const r=node.getBoundingClientRect();return r.bottom>70&&r.top<innerHeight-90&&r.right>0&&r.left<innerWidth;})){visible.push(component);observed.add(component);}
     }
     const frame=`${base}-chapter-${result.chapters.length+1}.png`;await page.screenshot({path:join(output,frame)});const chapterEntry={title,startSeconds:(performance.now()-started)/1000,frame,visibleComponents:visible};result.chapters.push(chapterEntry);
     for(const component of visible)result.observations.push({component,scene:scene.id,variant,chapter:title,frame,selector:TASK_DESIGN_SELECTORS[component],...(interactions.has(component)?{interaction:interactions.get(component)}:{})});
    };
    const hold=(ms=700)=>recordWait(stills,ms),click=async(locator:Locator)=>{await locator.scrollIntoViewIfNeeded();const bounds=await locator.boundingBox();if(!bounds)throw new Error('Control has no geometry');await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2,{steps:stills?1:14});await hold(180);await locator.click();await hold();};
    const ctx:Context={page,host,scene,stills,chapter,hold,click,check:(component,description)=>interactions.set(component,description)};
    await hold(1100);await chapter('Opening · '+scene.title);await actions(ctx);
    for(const component of componentNames(scene))if(!observed.has(component)){
     const locator=page.locator('.artifact '+TASK_DESIGN_SELECTORS[component]).filter({visible:true}).first();await expect(locator,`Visible ${component} in ${scene.id}`).toBeVisible();await locator.scrollIntoViewIfNeeded();await expect(locator).toBeInViewport({ratio:.01});await chapter('Inspect '+component);
    }
    expect(errors,'Browser errors in '+scene.id).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),'No page-wide overflow').toBe(false);
    const omitted=componentNames(scene).filter(component=>!observed.has(component));expect(omitted,'Unobserved scene components').toEqual([]);
    await chapter('Settled · same artifact and saved choices');await hold(1200);result.commands=host.commands.map(command=>({type:command.type,...(command.type==='action.submit'?{actionId:command.payload.actionId}:{})}));
    await audit.assert();result.themeAudit=audit.records();if(stop){result.probe=await stop();stop=undefined;}console.log('CAPTURED '+base+' ('+observed.size+' visible component types)');
   }catch(error){result.failed=String(error);if(stop){result.probe=await stop().catch(cause=>({error:String(cause)}));stop=undefined;}await page.screenshot({path:join(output,base+'-failed.png')}).catch(()=>{});throw error;}
   finally{try{await context.close();}finally{await save();}}
  }
  if(!wanted)expect(manifest.missing,'Every advertised component has visible chapter evidence').toEqual([]);
  await writeFile(join(output,'index.html'),reviewIndex(manifest));await writeFile(join(output,'README.md'),`# Task-specific interface review\n\n${TASK_DESIGN_PROVENANCE}\n\nOpen index.html for chaptered recordings or captures. manifest.json records per-component visible selector evidence, state interactions and failures. No fixture is claimed as genuine generation, approved execution or production-host acceptance.\n\nCommand: pnpm exec tsx scripts/record-task-design.ts --output <fresh-directory>${stills?' --stills-only':''}\n`);console.log('REVIEW_OUTPUT '+output);
 }finally{try{await browser?.browser.close();}finally{try{await browser?.server.close();}finally{await owned.stop();await save();}}}
}

async function actions(c:Context){
 const {page,host,scene,chapter,hold,click,check}=c;const button=(name:string)=>page.getByRole('button',{name,exact:true}),tab=(name:string)=>page.getByRole('tab',{name,exact:true});
 const recordedAction=async(locator:Locator)=>{const count=host.commands.filter(command=>command.type==='action.submit').length;await click(locator);await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(count+1);};
 if(scene.id.startsWith('time-')){
  if(scene.id==='time-visits'){await click(button('Select Fern & Fig'));await expect(button('Select Fern & Fig')).toHaveAttribute('aria-pressed','true');await click(button('Night'));await expect(button('Select Fern & Fig')).toHaveAttribute('aria-pressed','true');check('MapView','Map selection persists through a local theme change.');await chapter('Visit location and local theme');}
  const interval=page.getByRole('option',{name:'Working session',exact:true});await click(interval);await expect(interval).toHaveAttribute('aria-selected','true');await expect.poll(()=>host.snapshot.userStates[0].values.chosenTime).toMatchObject({selectedId:'long'});check('SchedulePicker','A 90-minute source interval is selected and retained on reload.');await chapter('Select the actual interval');await page.reload();await expect(interval).toHaveAttribute('aria-selected','true');await recordedAction(button(scene.id==='time-offered'?'Propose time':'Propose visit'));await chapter('A time proposal · no calendar booking');
 }else if(scene.id.startsWith('review-')){
  await expect(page.getByText('Checkout totals now include item quantity. Existing callers keep the same total(items) signature.',{exact:true})).toBeVisible();await click(page.getByRole('radio',{name:'Request changes',exact:true}));await page.getByRole('textbox',{name:'Review comment',exact:true}).fill('State which callers were checked.');await click(button('Next item'));await click(page.getByRole('radio',{name:'Accept',exact:true}));check('ReviewQueue','Material decisions/comments retain stable item IDs and submit one exact review.');if(scene.id==='review-patch')check('Diff','The supplied before/after code stays visible while reviewing its consequence.');await chapter('Decisions attached to the supplied material');await recordedAction(button('Send review'));await page.reload();await expect(page.getByRole('radio',{name:'Accept',exact:true})).toBeChecked();await chapter('Review restored after reload');
 }else if(scene.id==='investigation-failure'){
  await expect(page.getByRole('region',{name:'Assertion comparison',exact:true})).toContainText('12');await click(tab('empty basket returns zero'));await click(tab('includes item quantity'));check('Diagnostics','Passed and failed source checks select their own details; the assertion remains sourced.');await chapter('Assertion mismatch and related source');
  const supplied=structuredClone(scene.inputs.failures) as {items:Array<{status:string}>};supplied.items[2].status='passed';host.setInput('failures',supplied);await host.publish();await hold(900);await chapter('Supplied check result update · illustrative, no test execution');
 }else if(scene.id==='investigation-latency'){
  await click(tab('Response time'));await expect(page.getByRole('region',{name:'Selected statistic',exact:true})).toContainText('184');check('Stats','Metric selection changes the sourced measurement/trend.');await chapter('Measurement, without duplicated navigation values');
  await click(page.getByRole('treeitem',{name:'Parse document',exact:true}));check('TraceWaterfall','Selecting the actual failed span exposes its supplied duration.');await chapter('The relevant nested span');
  await click(page.getByRole('option',{name:'error: Quantity assertion failed',exact:true}));const details=page.locator('.log-selection');await expect(details).toContainText('checkout-17');await click(details.getByText('Event details',{exact:true}));check('LogExplorer','An event expands its own source details and correlation context.');await chapter('Correlated event context');
 }else if(scene.id==='software-release'){
  await click(tab('tests/total.test.ts'));await expect(page.getByLabel('Selected patch',{exact:true})).toContainText('includes quantity');await click(tab('src/total.ts'));check('ChangeSet','File selection preserves the exact supplied hunk and rationale.');await chapter('Review the actual file and hunk');
  await click(tab('API contract'));await click(tab('GET /orders/{id}'));check('ApiExplorer','Endpoint and response selection inspect the contract without making a request.');await chapter('Method/path and request–response exchange');
  const response=page.getByRole('tab',{name:'Response 404',exact:true});if(await response.count()){await click(response);await chapter('Choose a supplied response example');}await click(tab('Release checks'));await click(tab('Build'));check('Pipeline','The blocked stage links to its actual failed prerequisite.');await expect(button('Inspect Typecheck prerequisite')).toBeVisible();await chapter('Dependency and blocking cause');await click(button('Inspect Typecheck prerequisite'));await expect(page.locator('.software-pipeline .software-detail')).toContainText('Type number');await chapter('Inspect the failed prerequisite');
 }else if(scene.id==='image-work'){
  const slider=page.getByRole('slider',{name:'Comparison position',exact:true});await slider.focus();await slider.press('ArrowRight');await click(button('Side by side'));await expect(button('Side by side')).toHaveAttribute('aria-pressed','true');check('ImageCompare','Pointer/keyboard comparison modes inspect two actual supplied images.');await chapter('Compare the supplied pixels');
  await click(tab('Adjust export proposal'));const sourceImage=page.getByAltText('Source image for the export proposal');await expect(sourceImage).toBeVisible();await sourceImage.scrollIntoViewIfNeeded();await chapter('Inspect the supplied image');const width=page.getByRole('spinbutton',{name:'Width',exact:true});await width.fill('1920');check('ParameterControls','Source→draft proposal shows only changed parameters; source image remains unchanged.');check('Image','The actual source image remains visible beside its export proposal.');await chapter('Source image beside precise adjustment proposal');await recordedAction(button('Review export proposal'));await click(button('Reset Width'));await expect(width).toBeFocused();await chapter('Reset the proposal and return to its source control');
  await click(tab('Image feedback'));await expect(button('Add pin')).toBeEnabled();await click(button('Add pin'));await page.getByRole('textbox',{name:'Pin feedback',exact:true}).fill('Keep more separation around the export controls.');await button('Pin 1').focus();await button('Pin 1').press('Shift+ArrowRight');check('ImageAnnotator','A normalized feedback pin and its comment remain attached to the supplied image.');await chapter('Feedback attached to the image');await recordedAction(button('Send image feedback'));
 }else if(scene.id==='measurements'){
  await click(tab('Cost'));await expect(page.getByRole('region',{name:'Selected statistic',exact:true})).toContainText('Unavailable');await click(tab('Response time'));check('Stats','Unknown cost remains unavailable; known latency retains units.');await chapter('Useful trend and honest unknown');await click(tab('Compare options'));await click(button('Select Studio'));await click(page.getByRole('checkbox',{name:'Differences only',exact:true}));check('Comparison','Source criteria drive differences-only inspection and explicit selection.');await chapter('Compare actual differences');await recordedAction(button('Save preference'));
 }else if(scene.id==='private-entry'){
  const field=page.getByLabel('Project API token',{exact:true});await expect(field).toBeEnabled();await field.fill('SYNTHETIC_RECORDING_TOKEN_NOT_A_SECRET');await click(button('Save token'));await expect(page.getByText('Saved for this host session',{exact:true})).toBeVisible();await expect(field).toHaveValue('');check('CredentialEntry','An explicitly synthetic token uses only the private fixture endpoint; ordinary state/commands contain no token.');await chapter('Private in-memory save · synthetic value');expect(JSON.stringify(host.snapshot)).not.toContain('SYNTHETIC_RECORDING_TOKEN_NOT_A_SECRET');await click(button('Remove token'));await expect(page.getByText('No token saved',{exact:true})).toBeVisible();await chapter('Remove the saved fixture credential');
 }else if(scene.id==='document'){
  await click(page.getByRole('radio',{name:/Acme Studio LLC/}));await click(button('Next step'));await chapter('Contextual notices question, same PDF');await click(page.getByRole('radio',{name:/Personal/}));check('ChoiceList','Contextual answers update the durable field shared with the PDF.');await page.locator('.surface-section').filter({visible:true}).scrollIntoViewIfNeeded();await chapter('The current question and chosen notices address');await click(button('Next step'));await expect(page.getByRole('img',{name:'Selected visual signature',exact:true})).toBeVisible();await chapter('Generated mark saved as a bounded PNG resource');await click(button('Draw'));const canvas=page.getByRole('application',{name:'Draw visual signature',exact:true});await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;for(const offset of [0,.2]){await page.mouse.move(box.x+box.width*.15,box.y+box.height*(.42+offset));await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*(.3+offset),{steps:18});await page.mouse.up();}check('SignaturePad','Two strokes draw immediately; Clear and source-backed PNG generation remain in the same well.');check('DocumentPreview','Actual PDF bytes render and react to durable fields/marks without remounting the artifact.');await chapter('Immediate multi-stroke drawing');await click(button('Next step'));check('Steps','Keyed question navigation retains local edits in the same artifact.');await click(page.getByRole('checkbox',{name:'I have reviewed these details',exact:true}));await chapter('Review the content · no export execution');
 }else if(scene.id.startsWith('pr-')){
  const resolve=button('Resolve conflicts');await click(resolve);await expect(button('Resolving…')).toBeDisabled();check('Button','The clicked operation control remains disabled in its source-declared busy phase.');await chapter('Resolve stays mounted while source phases change');await expect(button('Merge')).toBeVisible({timeout:10000});check('RelationshipGraph','The same vertical history grows a resolution and source-declared readiness checks.');await chapter('Resolution history and readiness');await click(button('Merge'));await expect(button('Merging…')).toBeDisabled();await chapter('Source-declared merging phase');await expect(page.locator('.task-graph')).toHaveAttribute('data-tone','merged',{timeout:10000});await chapter('Purple completion · simulated external effect');
 }else if(scene.id==='questions'){
  await click(button('How should retries work?'));await expect(page.getByText('Reuse the same idempotency key when retrying the same order. Inspect the recorded result before starting a different order.',{exact:true})).toBeVisible();await expect(button('When should the key change?')).toBeVisible();await click(button('When should the key change?'));check('Disclosure','Pending answer, content arrival and a nested follow-up preserve the earlier branch.');check('Code','The request snippet is part of the specific retry explanation.');await chapter('An answer grows its own follow-up');await click(button('What happens when a request conflicts?'));await page.getByRole('textbox',{name:'Your question',exact:true}).fill('Can I inspect an existing order?');const questionCount=host.commands.filter(command=>command.type==='action.submit').length;await page.getByRole('textbox',{name:'Your question',exact:true}).press('Enter');await expect.poll(()=>host.commands.filter(command=>command.type==='action.submit').length).toBe(questionCount+1);await expect(button('Can I inspect an existing order?')).toBeVisible();check('Form','One accepted semantic question joins the same tree.');check('Input','Only accepted question text clears; the field retains focus.');await expect(page.getByRole('textbox',{name:'Your question',exact:true})).toBeFocused();await chapter('New root, preserved branches and focus');
 }else if(scene.id==='migration'){
  const names=['workspaces','users','projects','messages'];for(const [index,name]of names.entries()){
   await click(tab(name));
   const original=host.snapshot.data.find(record=>record.id==='input-'+name)!.value as {id:string;name:string;workspace?:string|null}[];
   const workspaces=host.snapshot.data.find(record=>record.id==='input-workspaces')!.value as {id:string}[];
   const accepted=index?original.map((row,i)=>({...row,workspace:workspaces[i%workspaces.length].id})):original;
   if(index)for(const row of accepted)expect(workspaces.map(workspace=>workspace.id),'Every assignment resolves to a shown workspace').toContain(row.workspace);
   host.setInput(name,accepted);
   host.setInput(name+'Changes',{revision:index+1,activeRowId:original[0].id,rows:original.map(row=>({id:row.id,status:index?'updated':'added',cells:[{key:index?'workspace':'name',status:index?'updated':'added',...(index?{before:null}:{})}]}))});
   host.setInput('migrationTabs',{detail:index===3?'All supplied assignments reviewed':'Inspect the accepted assignments',status:index===3?'success':'running',items:names.map((label,i)=>({label,status:i<=index?'success':'neutral'}))});
   host.setInput('migrationSummary',`**2 workspace records** · **${index*2} of 6 assignments reviewed**`);
   const schema=structuredClone(scene.inputs.migrationSchema) as {nodes:{id:string;status?:string}[]};
   for(const node of schema.nodes)node.status=names.indexOf(node.id)<=index?'success':'neutral';
   host.setInput('migrationSchema',schema);host.setInput('progress',(index+1)*2);await host.publish();await hold(600);await expect(page.getByText('Change metadata is unavailable from this source.',{exact:true})).toHaveCount(0);await chapter('Accepted source changes · '+name);
  }host.setInput('result',{status:'success',label:'Workspace links reviewed'});await host.publish();await click(button('Migration evidence'));check('Table','Accepted source rows/cells update in place; completed tabs remain inspectable.');check('Tabs','Each completed table can be revisited without losing its identity.');check('Progress','Numbers come only from explicit fixture source updates, not elapsed time.');check('Status','Completion is an explicit fixture source state.');check('Metric','The supplied source count is distinct from progress.');check('Timeline','Supplied operation events retain their source meaning.');check('Chart','The chart exposes actual supplied row counts.');await chapter('Supporting evidence is explicit inspection');
  await click(button('users.workspace_id'));await expect(tab('users')).toHaveAttribute('aria-selected','true');check('RelationshipGraph','A schema endpoint opens its table, whose workspace assignments match the shown target IDs.');await chapter('Follow a schema link to its accepted rows');
  await click(button('SQL and approval details'));check('Code','The complete supplied SQL stays behind explicit inspection.');await chapter('Inspect the supplied SQL without executing it');
 }else if(scene.id==='work-objects'){
  await click(button('Keep retries ordered'));await page.getByRole('combobox',{name:'Move selected card',exact:true}).selectOption('review');check('WorkflowBoard','A lane move remains a local proposal with source/destination identity.');await chapter('Lane movement as a proposal');await click(tab('Architecture'));await click(button('Bounded parser'));await click(button('Focus neighbors'));check('ArchitectureCanvas','Connected-neighbor focus uses the supplied graph.');await chapter('Actual layers and connected neighbors');await click(tab('Trace'));await click(page.getByRole('treeitem',{name:'Parse document',exact:true}));check('TraceWaterfall','Span nesting shares the supplied timeline; unknown time remains unavailable.');await chapter('Nested timing, not a generic report');
 }else if(scene.id==='delivery'){
  const before=await page.locator('.workspace').boundingBox();await click(button('Open handoff'));
  const documentWindow=page.getByRole('region',{name:'Delivery handoff document window',exact:true}),editor=documentWindow.getByRole('textbox',{name:'Document text',exact:true});
  await expect(documentWindow).toHaveAttribute('data-placement','docked');await expect(editor).toHaveValue(String(scene.inputs.handoff));
  const draft=String(scene.inputs.handoff)+'\n\nKeep the source alongside the PDF.';await editor.fill(draft);await expect.poll(()=>host.snapshot.userStates[0].values.handoffDraft).toMatchObject({text:draft});
  check('Document','The prepared handoff opens as actual editable text; its draft survives placement changes and reload.');await chapter('Read and edit the prepared handoff');
  await click(documentWindow.getByRole('button',{name:'Float document',exact:true}));await expect(documentWindow).toHaveAttribute('data-placement','floating');await expect(editor).toHaveValue(draft);await chapter('Float the same document beside the conversation');
  await click(documentWindow.getByRole('button',{name:'Dock document',exact:true}));await expect(documentWindow).toHaveAttribute('data-placement','docked');
  const move=documentWindow.getByRole('button',{name:'Move Delivery handoff',exact:true}),bounds=await move.boundingBox();if(!bounds)throw new Error('Document move handle has no geometry');
  await page.mouse.move(bounds.x+Math.min(70,bounds.width/2),bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x-60,bounds.y+55,{steps:c.stills?1:20});await page.mouse.up();await hold();await expect(documentWindow).toHaveAttribute('data-placement','floating');await expect(editor).toHaveValue(draft);
  await click(documentWindow.getByRole('button',{name:'Close document',exact:true}));await expect(documentWindow).toHaveCount(0);await expect.poll(async()=> (await page.locator('.workspace').boundingBox())!.width).toBeCloseTo(before!.width,0);await chapter('Conversation recenters after closing the document');
  await click(button('Open handoff'));await expect(editor).toHaveValue(draft);await click(documentWindow.getByRole('button',{name:'Close document',exact:true}));await page.reload();await click(button('Open handoff'));await expect(editor).toHaveValue(draft);await chapter('Reopen the same draft after reload');await click(documentWindow.getByRole('button',{name:'Close document',exact:true}));
  await page.getByRole('textbox',{name:'Delivery note',exact:true}).fill('Keep the source alongside the PDF.');await page.getByRole('combobox',{name:'Format',exact:true}).selectOption('source');await click(page.getByRole('checkbox',{name:'Include the original',exact:true}));check('Grid','Related fields share a compact responsive group.');check('Select','A supplied format is selected and included in the action.');check('Toggle','The boolean choice retains its actual false value.');await chapter('Prepare the local handoff choices');
  await click(button('Source files'));check('Panel','The source bundle groups its supplied document and inspectable evidence.');check('Tree','The supplied bundle hierarchy is inspectable.');check('EvidenceList','Source identities remain secondary to the decision.');check('Text','Only the useful original-file fact stays visible.');await chapter('Inspect the source bundle');
  expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(0);await recordedAction(button('Prepare download'));expect(host.commands.filter(command=>command.type==='action.submit')).toHaveLength(1);expect(host.commands.find(command=>command.type==='action.submit')?.payload).toMatchObject({actionId:'proposeDelivery',payload:{note:'Keep the source alongside the PDF.',format:'source',includeOriginal:false,document:{text:draft}}});check('Form','The exact chosen handoff proposal is submitted once; the fixture performs no export.');check('Input','The delivery note remains durable user state.');
 }else if(scene.id==='records'){
  const quantity=page.getByRole('spinbutton',{name:'Prints · Quantity',exact:true});await quantity.fill('6');await page.getByRole('combobox',{name:'Prints · Priority',exact:true}).selectOption('urgent');check('EditableTable','Typed edits preserve stable record identity and remain an explicit proposal.');await chapter('Changed source records, not a replacement form');await recordedAction(button('Review changes'));
 }
 await hold(500);
}

function reviewIndex(manifest:{provenance:string;captures:SceneResult[];missing:string[]}){
 const esc=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Task-specific interface review</title><style>body{margin:0;background:#000;color:#e6e6e6;font:14px/1.6 system-ui}main{max-width:1400px;margin:auto;padding:36px 24px}h1,h2{font-weight:550}p{max-width:900px;color:#aaa}article{margin:32px 0;padding-top:24px;border-top:1px solid #282828}video,img{display:block;max-width:100%;height:auto;background:#0f0f0f;border-radius:8px}video{width:100%}.frames{display:flex;flex-wrap:wrap;gap:12px}.frames a{flex:1 1 320px;max-width:600px}.chapters{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}button{background:#1f1f1f;color:#ddd;border:1px solid #3d3d3d;border-radius:6px;padding:6px 9px;cursor:pointer}a{color:#bcbcbc}a:focus-visible,button:focus-visible{outline:2px solid #91a7ff}small{color:#aaa}</style><main><h1>Task-specific interfaces</h1><p>${esc(manifest.provenance)}</p><p>These are current source-renderer demonstrations, separate from historical videos and genuine-Pi evidence. Video output is H.264 at1920×1080,30fps; unchanged/delayed compositor frames are held without interpolation.</p>${manifest.captures.map((capture,index)=>`<article><h2>${esc(capture.title)} · ${esc(capture.variant)}</h2><p>${esc(capture.caption)}</p>${capture.failed?`<p>FAILED: ${esc(capture.failed)}</p>`:capture.video?`<video id="video-${index}" controls playsinline preload="metadata" poster="${esc(capture.chapters[0]?.frame??'')}" src="${esc(capture.video)}"></video><div class="chapters">${capture.chapters.map(chapter=>`<button data-video="video-${index}" data-time="${chapter.startSeconds}">${esc(chapter.title)}</button>`).join('')}</div>`:`<div class="frames">${capture.chapters.map(chapter=>`<a href="${esc(chapter.frame)}"><img loading="lazy" src="${esc(chapter.frame)}" alt="${esc(chapter.title)}"><small>${esc(chapter.title)}</small></a>`).join('')}</div>`}</article>`).join('')}<p><a href="manifest.json">Visible component coverage and recording provenance</a></p><p>${manifest.missing.length?'Not covered in this selected subset: '+esc(manifest.missing.join(', ')):'Every advertised component has visible chapter evidence.'}</p></main><script>document.querySelectorAll('[data-video]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById(button.dataset.video);video.currentTime=Number(button.dataset.time);video.play();}));</script></html>`;
}
