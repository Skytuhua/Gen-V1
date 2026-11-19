import {expect} from '@playwright/test';
import {readFile,readdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {args,json,main,output,required,windows} from './common.ts';
import {flagsOff} from './flags-off.ts';
import {installedSession,nativeBounds} from './installed-session.ts';
import type {Seed} from './seed-v061-profile.ts';

main(import.meta.url,async()=>{
 windows();const {options}=args(),seed=JSON.parse(await readFile(required(options,'seed'),'utf8')) as Seed,out=output(options),exe=required(options,'exe'),checks:string[]=[];let passed=false;
 if(!seed.passed||seed.version!==1||seed.synthetic!==true)throw Error('Need completed historical seed receipt.');
 try{
  await flagsOff(dirname(exe),out);
  const metadata=JSON.parse(await readFile(join(dirname(exe),'resources/host/package.json'),'utf8'));expect(metadata.version).toBe('0.6.5');
  await installedSession(exe,async(page,pid)=>{
   await expect(page.locator('html')).toHaveAttribute('data-theme',(seed.settings as {theme:string}).theme);
   if(seed.layout){expect(await nativeBounds(pid)).toEqual(seed.layout);checks.push('Native main-window geometry restored');}
   for(const thread of seed.threads){await page.locator('.thread-item').filter({hasText:thread.title}).click();await expect(page.getByText(thread.message,{exact:true})).toBeVisible();await expect(page.getByRole('textbox',{name:'Delivery note',exact:true})).toHaveValue(thread.artifactValue);if(thread.draft)await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue(thread.draft);
    const data=await page.evaluate(async id=>{const response=await fetch('/api/threads/'+encodeURIComponent(id)+'/snapshot');if(!response.ok)throw Error('Thread detail unavailable');return response.json();},thread.id);expect(JSON.stringify(data)).toContain(thread.memory);
    const info=await page.evaluate(id=>window.harnessDesktop!.detach({kind:'workspace',threadId:id,tab:'notes'}),thread.id);await expect.poll(()=>page.context().pages().some(child=>child.url().includes(info.id))).toBe(true);const notes=page.context().pages().find(child=>child.url().includes(info.id))!;await expect(notes.getByRole('textbox',{name:'Note rc-note',exact:true})).toHaveValue(thread.memory);await notes.screenshot({path:join(out,thread.id+'-memory.png')});await notes.evaluate(()=>window.harnessDesktop!.reattach());checks.push(thread.id+': thread/message/artifact/draft and notes visible');
   }await page.screenshot({path:join(out,'upgrade-visible.png')});
  });
  expect(await readdir(seed.account.directory)).toContain('RC-SYNTHETIC-NO-TOKENS.txt');const db=new DatabaseSync(join(process.env.LOCALAPPDATA!,'GenerativeHarness/harness.sqlite'),{readOnly:true});try{const get=(kind:string,id:string)=>{const row=db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;if(!row)throw Error('Missing '+kind+':'+id);return JSON.parse(row.body);};expect(get('settings','global').theme).toBe((seed.settings as {theme:string}).theme);expect(get('account',seed.account.id).id).toBe(seed.account.id);for(const thread of seed.threads){expect(get('taskMemory',thread.id+':rc-note').content).toBe(thread.memory);expect(get('memoryVersion',thread.id+':rc-note').revision).toBe(1);}}finally{db.close();}checks.push('settings, account metadata/directory, taskMemory and memoryVersion retained');passed=true;
 }finally{await json(join(out,'upgrade-check.json'),{passed,checks,effectiveRuntimeFlags:'No public endpoint: launched with no HARNESS_* overrides; registry defaults checked separately.'});}console.log(JSON.stringify({passed,checks}));
});
