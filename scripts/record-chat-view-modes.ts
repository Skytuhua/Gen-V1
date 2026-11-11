import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveChatFixture} from '../tests/e2e/chat-view-modes-fixture';
import {CHAT_LAYOUT_KEY,type ChatMode} from '../packages/ui-shell/chat-layout';

// Start Vite on 5490 first. --before is for the untouched base checkout only.
const before=process.argv.includes('--before');
const directory=process.env.WO6_CAPTURE_DIR??'/home/box/gen-company/ledger/WO-6/before-after';
const names={full:'Full page',drawer:'Side drawer',popup:'Pop-up'};
const scratch=await mkdtemp(join(tmpdir(),'wo6-frames-')),browser=await chromium.launch({headless:true});
const metrics:Record<string,unknown>={};
try{
 await mkdir(directory,{recursive:true});
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await serveChatFixture(page);
 await page.addInitScript(()=>{
  Object.assign(window,{wo6Pause:false});const animate=Element.prototype.animate;
  Element.prototype.animate=function(...args){
   const effect=animate.apply(this,args);
   if(this.matches('.chat-view-surface')&&(window as unknown as {wo6Pause:boolean}).wo6Pause){effect.pause();effect.currentTime=0;}
   return effect;
  };
 });
 const ready=async()=>{await page.getByRole('textbox',{name:'Message',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);};
 const setMode=async(mode:ChatMode)=>{
  await page.getByRole('button',{name:'Switch layout',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:names[mode],exact:true}).click();
 };
 const reset=async(mode:ChatMode)=>{
  await page.evaluate(key=>localStorage.removeItem(key),CHAT_LAYOUT_KEY);await page.reload();await ready();if(mode!=='full'){await setMode(mode);await page.waitForTimeout(400);}
 };
 await page.goto(process.env.WO6_CAPTURE_URL??'http://127.0.0.1:5490');await ready();
 if(before){
  for(const width of [1440,1024]){await page.setViewportSize({width,height:900});await page.waitForTimeout(400);await page.screenshot({path:`${directory}/before-${width}.png`});}
 }else{
  for(const width of [1440,1024,768]){
   await page.setViewportSize({width,height:900});
   for(const mode of ['full','drawer','popup'] as const){await reset(mode);await page.screenshot({path:`${directory}/after-${mode}-${width}.png`});}
  }
  await page.setViewportSize({width:1440,height:900});
  const encode=async(name:string,frames:string[])=>{
   const folder=join(scratch,name);await mkdir(folder,{recursive:true});
   for(const [index,file] of frames.entries())await copyFile(file,join(folder,`${String(index).padStart(3,'0')}.png`));
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','20','-i',join(folder,'%03d.png'),'-filter_complex','[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer','-loop','0',`${directory}/${name}.gif`]);
   const selected=Array.from({length:8},(_,i)=>Math.round(i*(frames.length-1)/7));
   const strip=join(folder,'strip');await mkdir(strip,{recursive:true});
   for(const [index,frame] of selected.entries())await copyFile(frames[frame],join(strip,`${index}.png`));
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','1','-i',join(strip,'%d.png'),'-vf','scale=360:-1,tile=4x2','-frames:v','1',`${directory}/${name}-strip.png`]);
   console.log(`Captured ${name}`);
  };
  const frame=async(name:string,index:number)=>{const file=join(scratch,`${name}-${index}.png`);await page.screenshot({path:file});return file;};
  const transition=async(name:string,action:()=>Promise<unknown>)=>{
   const first=await frame(name,0),frames=[first,first,first,first];
   await page.evaluate(()=>{(window as unknown as {wo6Pause:boolean}).wo6Pause=true;});await action();
   const samples=[];
   for(const time of [0,50,100,150,200,250,300,350,360]){
    const rect=await page.locator('.chat-view-surface').evaluate((element,ms)=>{for(const effect of element.getAnimations()){effect.pause();effect.currentTime=ms;}return element.getBoundingClientRect().toJSON();},time);
    samples.push({time,rect});frames.push(await frame(name,frames.length));
   }
   await page.locator('.chat-view-surface').evaluate(element=>{for(const effect of element.getAnimations())effect.finish();});
   await page.evaluate(()=>{(window as unknown as {wo6Pause:boolean}).wo6Pause=false;});
   const last=await frame(name,99);frames.push(last,last,last,last,last,last);metrics[name]=samples;await encode(name,frames);
  };
  for(const from of ['full','drawer','popup'] as const)for(const to of ['full','drawer','popup'] as const){if(from===to)continue;await reset(from);await transition(`${from}-to-${to}`,()=>setMode(to));}
  const gesture=async(name:string,label:string,dx:number,dy:number,dock=false)=>{
   const first=await frame(name,0),frames=[first,first,first,first],handle=await page.getByRole('button',{name:label,exact:true}).boundingBox();if(!handle)throw Error(`Missing ${label}`);
   const x=handle.x+handle.width/2,y=handle.y+handle.height/2;await page.mouse.move(x,y);await page.mouse.down();
   for(let index=1;index<=12;index++){
    await page.mouse.move(dock?x+(1420-x)*index/12:x+dx*index/12,dock?y+(160-y)*index/12:y+dy*index/12);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));frames.push(await frame(name,index));
   }
   await page.mouse.up();await page.waitForTimeout(400);const last=await frame(name,99);frames.push(last,last,last,last,last,last);await encode(name,frames);
  };
  for(const mode of ['drawer','popup'] as const){
   await reset(mode);await gesture(`resize-${mode}-edge`,'Resize chat left',-160,0);
   await reset(mode);await gesture(`resize-${mode}-corner`,'Resize chat top left',-120,mode==='drawer'?120:-100);
  }
  await reset('drawer');await transition('detach-button',()=>page.getByRole('button',{name:'Detach chat',exact:true}).click());
  await transition('dock-button',()=>page.getByRole('button',{name:'Dock chat to side drawer',exact:true}).click());
  await reset('drawer');await gesture('detach-header','Move chat panel',-220,0);
  await gesture('dock-drag','Move chat panel',0,0,true);
  await writeFile(`${directory}/motion-samples.json`,JSON.stringify(metrics,null,2)+'\n');
 }
}finally{await browser.close();await rm(scratch,{recursive:true,force:true});}
