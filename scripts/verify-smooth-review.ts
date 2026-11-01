import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
const site=resolve('sites/harness-video-review-20261030/dist'),folder=resolve(process.argv[2]??'docs/evidence/frontend-review/smooth-expanded-20261030');
const manifest=JSON.parse(await readFile(join(site,'latest-review-manifest.json'),'utf8'));
const captures=[...manifest.newCaptures,...manifest.referenceCaptures,...manifest.genuineCaptures];
const run=(command:string,args:string[])=>new Promise<string>((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(output):reject(Error(error.slice(-2000))));});
const verification:{media:unknown[];browser:unknown;inspectedAt:string}={media:[],browser:null,inspectedAt:new Date().toISOString()};
for(const capture of captures){const file=join(site,capture.file),probe=JSON.parse(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate:format=duration','-of','json',file]));const stream=probe.streams[0];if(stream.codec_name!=='h264'||stream.width!==1920||stream.height!==1080||stream.r_frame_rate!=='30/1')throw Error('Wrong video export '+capture.file);await run('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-map','0:v:0','-f','null','-']);verification.media.push({file:capture.file,probe,fullDecode:true});}
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(pathToFileURL(join(site,'index.html')).href);
 await expect(page.locator('video')).toHaveCount(captures.length);
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Review index overflows');}
 await page.setViewportSize({width:1440,height:1000});const playback=[];
 for(let index=0;index<captures.length;index++){
  const video=page.locator('video').nth(index),id=await video.getAttribute('id');
  const chapter=page.locator(`[data-video="${id}"]`).first();
  if(await chapter.count())await chapter.click();else await video.evaluate(node=>(node as HTMLVideoElement).play());
  await expect.poll(()=>video.evaluate(node=>(node as HTMLVideoElement).readyState),{timeout:15000}).toBeGreaterThanOrEqual(2);
  const initial=await video.evaluate(node=>(node as HTMLVideoElement).currentTime);
  await expect.poll(()=>video.evaluate(node=>(node as HTMLVideoElement).currentTime),{timeout:10000}).toBeGreaterThan(initial+.08);
  const error=await video.evaluate(node=>{const video=node as HTMLVideoElement;video.pause();return video.error?.message??null;});if(error)throw Error(error);
  playback.push({file:captures[index].file,chapterPlayback:true});
 }
 verification.browser={videoElements:captures.length,chapterButtons:await page.locator('[data-video]').count(),mobileOverflow:false,playback};
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(folder,'review-index.png')});
}finally{await browser.close();}
await writeFile(join(folder,'media-verification.json'),JSON.stringify(verification,null,2));console.log(JSON.stringify({videos:verification.media.length,browser:verification.browser}));
