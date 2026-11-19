import {expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {args,json,main,output,required,run,windows} from './common.ts';
import {installedSession,nativeBounds} from './installed-session.ts';

export type Seed={version:1;synthetic:true;threads:{id:string;title:string;message:string;artifactValue:string;draft:string;memory:string;artifactId:string;stateId:string}[];account:{id:string;directory:string};settings:unknown;layout?:unknown;passed:boolean};
main(import.meta.url,async()=>{
 windows();const {options}=args(),tree=resolve(required(options,'v061-worktree')),executable=resolve(required(options,'exe')),out=output(options),host=join(process.env.LOCALAPPDATA!,'GenerativeHarness'),profile=join(process.env.APPDATA!,'GenerativeHarnessDesktop');
 if(await run('git',['rev-parse','HEAD'],{cwd:tree,capture:true})!==await run('git',['rev-parse','v0.6.1^{commit}'],{cwd:tree,capture:true})||await run('git',['status','--porcelain'],{cwd:tree,capture:true}))throw Error('Historical worktree must be clean at v0.6.1.');
 for(const path of [host,profile])if((await readdir(path).catch(error=>{if(error.code==='ENOENT')return [];throw error;})).length)throw Error('Seed requires empty default host and desktop profiles. Back up and relocate existing profiles manually.');
 const metadata=JSON.parse(await readFile(join(executable,'../resources/host/package.json'),'utf8'));if(metadata.version!=='0.6.1')throw Error('Seed requires installed 0.6.1.');
 const {Store}=await import(pathToFileURL(join(tree,'packages/storage/store.ts')).href),{taskFixture}=await import(pathToFileURL(join(tree,'tests/e2e/task-interface-fixture.ts')).href),{accountProfileRoot}=await import(pathToFileURL(join(tree,'packages/runtime/account-profile.ts')).href);
 const account={id:randomUUID(),providerId:'openai',label:'RC synthetic account (no credentials)',enabled:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},directory=accountProfileRoot(host,account);
 const seed:Seed={version:1,synthetic:true,threads:[],account:{id:account.id,directory},settings:{theme:'dark',modelId:null},passed:false};
 const store=new Store(host);try{store.internal('rc.synthetic.seed',null,()=>{
  for(let i=1;i<=3;i++){
   const id='rc061-thread-'+i,fixture=JSON.parse(JSON.stringify(taskFixture({root:'fields',elements:{fields:{type:'Input',props:{stateKey:'note',label:'Delivery note'}}}},{},{note:'RC accepted value '+i})).replaceAll('task-thread',id).replaceAll('task-surface','rc061-artifact-'+i).replaceAll('task-state','rc061-state-'+i).replaceAll('"reply"','"rc061-message-'+i+'"'));
   fixture.threads[0].title='RC 0.6.1 synthetic thread '+i;fixture.threads[0].sessionPath=null;fixture.messages[0].content='RC retained message '+i;
   for(const [key,kind]of Object.entries({threads:'thread',messages:'message',artifacts:'artifact',userStates:'userState',data:'data'}))for(const item of fixture[key])store.put(kind,item.id,item.threadId??null,item);
   const memory='RC retained thread note '+i,memoryId=id+':rc-note';store.put('taskMemory',memoryId,id,{id:memoryId,threadId:id,key:'rc-note',content:memory,revision:1,author:'user',updatedAt:new Date().toISOString()});store.put('memoryVersion',memoryId,id,{revision:1});
   seed.threads.push({id,title:fixture.threads[0].title,message:fixture.messages[0].content,artifactValue:'RC accepted value '+i,artifactId:'rc061-artifact-'+i,stateId:'rc061-state-'+i,draft:i<=2?'RC unsent draft '+i:'',memory});
  }store.put('settings','global',null,seed.settings);store.put('account',account.id,null,account);
 });}finally{store.close();}
 await mkdir(directory,{recursive:true});await writeFile(join(directory,'RC-SYNTHETIC-NO-TOKENS.txt'),'Synthetic profile metadata only; no credentials.\n');await json(join(out,'seed.json'),seed);
 try{await installedSession(executable,async(page,pid)=>{
  for(const thread of seed.threads.slice(0,2)){await page.locator('.thread-item').filter({hasText:thread.title}).click();const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill(thread.draft);await expect.poll(()=>page.evaluate(id=>new Promise<unknown>((accept,reject)=>{const request=indexedDB.open('generative-harness-journal',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,row=db.transaction('entries').objectStore('entries').get('draft:'+id);row.onsuccess=()=>{accept(row.result?.value);db.close();};row.onerror=()=>reject(row.error);};}),thread.id)).toBe(thread.draft);}
  seed.layout=await nativeBounds(pid,{left:80,top:80,width:1100,height:780});await page.screenshot({path:join(out,'seed-drafts.png')});
 });seed.passed=true;}finally{await json(join(out,'seed.json'),seed);}console.log('Seeded 3 historical threads, accepted artifact states, notes, settings, synthetic account; 2 native drafts.');
});
