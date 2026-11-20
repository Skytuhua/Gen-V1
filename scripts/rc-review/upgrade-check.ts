import {expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {args,json,main,output,required,windows} from './common.ts';
import {flagsOff} from './flags-off.ts';
import {installedSession,nativeBounds} from './installed-session.ts';
import type {Seed} from './seed-v061-profile.ts';

export function compareNativeGeometry(expected:unknown,actual:unknown):{status:'passed'|'failed';expected:unknown;actual:unknown;tolerancePixels:number;scope:string;error?:string;edgeDeltas?:Record<string,number>}{
 const bounds=(value:unknown):value is Awaited<ReturnType<typeof nativeBounds>>=>Boolean(value&&typeof value==='object'&&['left','top','width','height'].every(key=>Number.isFinite((value as Record<string,unknown>)[key]))&&Number((value as Record<string,unknown>).width)>0&&Number((value as Record<string,unknown>).height)>0);
 const tolerancePixels=16,scope='Win32 GetWindowRect on both sides; 16 physical pixels per edge allow legacy frameless versus native-titlebar resize borders, not monitor/DPI acceptance.';
 if(!bounds(expected)||!bounds(actual))return {status:'failed' as const,expected,actual,tolerancePixels,scope,error:'Missing or invalid native window rectangle.'};
 const edgeDeltas={left:actual.left-expected.left,top:actual.top-expected.top,right:actual.left+actual.width-expected.left-expected.width,bottom:actual.top+actual.height-expected.top-expected.height};return {status:Object.values(edgeDeltas).every(value=>Math.abs(value)<=tolerancePixels)?'passed' as const:'failed' as const,expected,actual,tolerancePixels,edgeDeltas,scope};
}
main(import.meta.url,async()=>{
 windows();const {options}=args(),seed=JSON.parse(await readFile(required(options,'seed'),'utf8')) as Seed,out=output(options),exe=required(options,'exe'),checks:string[]=[];let passed=false,geometry:ReturnType<typeof compareNativeGeometry>|undefined;
 if(!seed.passed||seed.version!==1||seed.synthetic!==true)throw Error('Need completed historical seed receipt.');
 try{
  await flagsOff(dirname(exe),out);
  const metadata=JSON.parse(await readFile(join(dirname(exe),'resources/host/package.json'),'utf8'));expect(metadata.version).toBe('0.6.5');
  await installedSession(exe,async(page,pid)=>{
   await expect(page.locator('html')).toHaveAttribute('data-theme',(seed.settings as {theme:string}).theme);
   if(seed.layout){try{geometry=compareNativeGeometry(seed.layout,await nativeBounds(pid));}catch(error){geometry={...compareNativeGeometry(seed.layout,undefined),error:String(error)};}checks.push('Native main-window geometry: '+geometry?.status);}
   for(const thread of seed.threads){await page.locator('.thread-item').filter({hasText:thread.title}).click();await expect(page.getByText(thread.message,{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Delivery note',exact:true})).toHaveValue(thread.artifactValue);if(thread.draft)await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(thread.draft);
    const data=await page.evaluate(async id=>{const response=await fetch('/api/threads/'+encodeURIComponent(id)+'/snapshot');if(!response.ok)throw Error('Thread detail unavailable');return response.json();},thread.id);expect(JSON.stringify(data)).toContain(thread.memory);
    const info=await page.evaluate(id=>window.harnessDesktop!.detach({kind:'workspace',threadId:id,tab:'notes'}),thread.id);await expect.poll(()=>page.context().pages().some(child=>child.url().includes(info.id))).toBe(true);const notes=page.context().pages().find(child=>child.url().includes(info.id))!;await expect(notes.getByRole('textbox',{name:'Note rc-note',exact:true})).toHaveValue(thread.memory);await notes.screenshot({path:join(out,thread.id+'-memory.png')});await notes.evaluate(()=>window.harnessDesktop!.reattach());checks.push(thread.id+': thread/message/artifact/draft and notes visible');
   }await page.screenshot({path:join(out,'upgrade-visible.png')});
  });
  expect(await readdir(seed.account.directory)).toContain('RC-SYNTHETIC-NO-TOKENS.txt');const db=new DatabaseSync(join(process.env.LOCALAPPDATA!,'GenerativeHarness/harness.sqlite'),{readOnly:true});try{const get=(kind:string,id:string)=>{const row=db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;if(!row)throw Error('Missing '+kind+':'+id);return JSON.parse(row.body);};expect(get('settings','global').theme).toBe((seed.settings as {theme:string}).theme);expect(get('account',seed.account.id).id).toBe(seed.account.id);for(const thread of seed.threads){expect(get('taskMemory',thread.id+':rc-note').content).toBe(thread.memory);expect(get('memoryVersion',thread.id+':rc-note').revision).toBe(1);}}finally{db.close();}checks.push('settings, account metadata/directory, taskMemory and memoryVersion retained');passed=geometry?.status!=='failed';
 }finally{await json(join(out,'upgrade-check.json'),{passed,checks,geometry,effectiveRuntimeFlags:'No public endpoint: launched with no HARNESS_* overrides; registry defaults checked separately.'});}console.log(JSON.stringify({passed,checks}));if(!passed)process.exitCode=1;
});
