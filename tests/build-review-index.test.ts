import {afterEach,describe,expect,it} from 'vitest';
import {mkdirSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {cleanTempDirs,tempDir} from './fixtures/temp-dir.ts';
import {buildReviewIndex} from '../scripts/build-review-index.ts';
import {CAPABILITIES,CATALOG_VERSION} from '../packages/ui-catalog/index.ts';

afterEach(()=>{cleanTempDirs();});

const mp4=new Uint8Array([0,0,0,24,102,116,121,112,109,112,52,50]);
const png=new Uint8Array([137,80,78,71,13,10,26,10]);

function recording(manifest:object,files:Record<string,string|Uint8Array>={}){
 const folder=tempDir('review-index-');
 for(const [name,data] of Object.entries(files)){
  const parts=name.split('/');
  if(parts.length>1)mkdirSync(join(folder,...parts.slice(0,-1)),{recursive:true});
  writeFileSync(join(folder,name),data);
 }
 writeFileSync(join(folder,'manifest.json'),JSON.stringify(manifest));
 return folder;
}
const json=(folder:string,name:string)=>JSON.parse(readFileSync(join(folder,name),'utf8'));
const page=(folder:string)=>readFileSync(join(folder,'index.html'),'utf8');

describe('buildReviewIndex',()=>{
 it('rejects a missing or invalid manifest before writing outputs',async()=>{
  await expect(buildReviewIndex(tempDir('review-index-'))).rejects.toThrow();
  const folder=tempDir('review-index-');writeFileSync(join(folder,'manifest.json'),'not json');
  await expect(buildReviewIndex(folder)).rejects.toThrow();
 });

 it('builds cards, chapter navigation and records from a declared capture',async()=>{
  const folder=recording({captures:[{scenario:'signing',file:'a.mp4',evidence:['notes.txt'],
   chapters:[
    {title:'Later',startSeconds:20},
    {title:'First',startSeconds:5,endSeconds:9},
    {title:'Negative',startSeconds:-1},
    {title:'Not a number',startSeconds:'x'},
    {title:'Reversed',startSeconds:10,endSeconds:3},
   ],
   probe:{streams:[{width:1920,height:1080,codec_name:'h264',avg_frame_rate:'30/1'}],format:{duration:'12.34'}}}]},
   {'a.mp4':mp4,'signing-settled.png':png,'notes.txt':'note'});
  const result=await buildReviewIndex(folder);
  expect(result).toMatchObject({recordings:1,availableRecordings:1,genuinePiEntries:0,warnings:[]});
  const record=json(folder,'review-index.json').captures[0];
  expect(record).toMatchObject({scenario:'signing',file:'a.mp4',available:true,provenance:'Unclassified provenance',evidence:['notes.txt']});
  expect(record.chapters).toEqual([
   {title:'First',startSeconds:5,endSeconds:9},
   {title:'Reversed',startSeconds:10},
   {title:'Later',startSeconds:20},
  ]);
  const out=page(folder);
  expect(out).toContain('<video');expect(out).toContain('src="a.mp4"');expect(out).toContain('poster="signing-settled.png"');
  expect(out).toContain('data-start="5">0:05 · First');expect(out).toContain('1920 × 1080 · h264 · encoded fps 30/1 · 12.3 s');
  expect(out).toContain('href="notes.txt"');
 });

 it('renders chapter timestamps as spans when the recording file is unavailable',async()=>{
  const folder=recording({captures:[{scenario:'migration',file:'gone.mp4',chapters:[{title:'Intro',startSeconds:0}]}]});
  const result=await buildReviewIndex(folder);
  expect(result.warnings).toEqual(['Missing or unsupported recording: gone.mp4']);
  expect(json(folder,'review-index.json').captures[0].available).toBe(false);
  const out=page(folder);
  expect(out).toContain('Recording file unavailable. This entry is pending.');
  expect(out).toContain('<span>0:00 · Intro</span>');expect(out).not.toContain('data-start');
 });

 it.each([
  ['../escape.mp4',{files:{'escape.mp4':mp4},make:(f:string)=>writeFileSync(join(f,'../escape.mp4'),mp4)}],
  ['/etc/passwd',{}],
  ['https://invalid.example/x.mp4',{}],
  ['bad\x01name.mp4',{}],
  ['a.txt',{'a.txt':'text'}],
 ])('rejects unsafe or unsupported recording path %s',async(file,extra)=>{
  const folder=recording({captures:[{scenario:'context',file}]});
  if('make' in extra)(extra.make as (f:string)=>void)(folder);
  const result=await buildReviewIndex(folder);
  expect(result.warnings).toEqual([`Missing or unsupported recording: ${file}`]);
  expect(json(folder,'review-index.json').captures[0].available).toBe(false);
 });

 it('flags unsafe evidence links while keeping safe ones',async()=>{
  const folder=recording({captures:[{scenario:'faq',file:'a.mp4',evidence:['../outside.md','ok.md','missing.md']}]},
   {'a.mp4':mp4,'ok.md':'fine'});
  const result=await buildReviewIndex(folder);
  expect(result.warnings).toEqual([
   'Missing or unsafe evidence link for faq: ../outside.md',
   'Missing or unsafe evidence link for faq: missing.md',
  ]);
  expect(json(folder,'review-index.json').captures[0].evidence).toEqual(['ok.md']);
 });

 it('classifies provenance for fixtures, manifest-declared genuine Pi and unknown captures',async()=>{
  const folder=recording({captures:[
   {scenario:'catalog',file:'fixture.mp4',fixture:true},
   {scenario:'shell',file:'genuine.mp4',fixture:false,provenance:'genuine-pi'},
   {scenario:'map',file:'unknown.mp4'},
  ]},{'fixture.mp4':mp4,'genuine.mp4':mp4,'unknown.mp4':mp4});
  const result=await buildReviewIndex(folder);
  expect(result.genuinePiEntries).toBe(1);
  expect(json(folder,'review-index.json').captures.map((c:{provenance:string})=>c.provenance)).toEqual([
   'Deterministic fixture · actual local app',
   'Genuine Pi · declared by manifest',
   'Unclassified provenance',
  ]);
  expect(page(folder)).toContain('1 manifest-declared genuine Pi entry/entries.');
 });

 it.each([
  ['array',{genuinePi:[{scenario:'signing',file:'g.mp4',fixture:false},{scenario:'shell',file:'u.mp4'}]}],
  ['object',{genuinePi:{captures:[{scenario:'signing',file:'g.mp4',fixture:false}],status:'verified',notes:'rerun'}}],
 ])('accepts a genuinePi manifest declared as an %s',async(_kind,manifest)=>{
  const folder=recording(manifest,{'g.mp4':mp4,'u.mp4':mp4});
  const result=await buildReviewIndex(folder);
  const records=json(folder,'review-index.json').captures;
  // A manifest genuinePi entry counts only when it also opts out of fixture provenance.
  expect(result.genuinePiEntries).toBe(1);
  expect(records[0].provenance).toBe('Genuine Pi · declared by manifest');
  const out=page(folder);
  expect(out).toContain('1 manifest-declared genuine Pi entry/entries.');
  if(_kind==='array') expect(records[1].provenance).toBe('Unclassified provenance');
  else {expect(out).toContain('verified');expect(out).toContain('rerun');}
 });

 it('appends undeclared top-level MP4s as unclassified and ignores nested files',async()=>{
  const folder=recording({captures:[]},{'loose.mp4':mp4,'nested/other.mp4':mp4});
  const result=await buildReviewIndex(folder);
  expect(result.recordings).toBe(1);expect(result.warnings).toEqual(['Unclassified MP4: loose.mp4. No model-generation or fixture claim is inferred from its filename.']);
  expect(json(folder,'review-index.json').captures[0]).toMatchObject({scenario:'additional',file:'loose.mp4',available:true});
 });

 it('reports manifest-declared coverage against the advertised catalog',async()=>{
  const folder=recording({captures:[],catalogCoverage:[CAPABILITIES[0].name,'bogus-entry',CAPABILITIES[0].name]});
  await buildReviewIndex(folder);
  const coverage=json(folder,'component-coverage.json');
  expect(coverage.catalogVersion).toBe(CATALOG_VERSION);
  expect(coverage.advertised).toEqual(CAPABILITIES.map(c=>c.name).sort());
  expect(coverage.declared).toEqual([CAPABILITIES[0].name,'bogus-entry'].sort());
  expect(coverage.unexpected).toEqual(['bogus-entry']);
  expect(coverage.missing).toEqual(coverage.advertised.filter((n:string)=>n!==CAPABILITIES[0].name));
 });

 it('escapes markup in titles, summaries and failure notices',async()=>{
  const folder=recording({captures:[{scenario:'shell',file:'a.mp4',title:'<img src=x onerror=alert(1)>',summary:'"quoted" & <tagged>\'single\'',failed:true,error:'<script>bad()</script>'}]},{'a.mp4':mp4});
  await buildReviewIndex(folder);
  const out=page(folder);
  expect(out).not.toContain('<img src=x');expect(out).not.toContain('<script>bad');
  expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(out).toContain('Recording action failed: &lt;script&gt;bad()&lt;/script&gt;');
  expect(out).toContain('&quot;quoted&quot; &amp; &lt;tagged&gt;&#39;single&#39;');
 });

 it('copies only authorized reference extracts and pairs them with result frames',async()=>{
  const folder=recording({captures:[{scenario:'signing',file:'a.mp4'}]},{'a.mp4':mp4,'signing-settled.png':png});
  const result=await buildReviewIndex(folder);
  expect(result.warnings).toEqual([]);
  const records=json(folder,'review-index.json').frameComparisons;
  const signing=records.find((r:{scenario:string})=>r.scenario==='signing');
  expect(signing).toMatchObject({reference:'references/signing-18.png',result:'signing-settled.png'});
  const out=page(folder);
  expect(out).toContain('recording 15:47:28 · extract 18 s');
  expect(readFileSync(join(folder,'references/signing-18.png'))).toHaveLength(readFileSync(join(__dirname,'../docs/reference/signing-18.png')).length);
  const pending=records.find((r:{scenario:string})=>r.scenario==='context');
  expect(pending.result).toBeNull();
  expect(out).toContain('Result frame pending.');
 });

 it('honours explicit frameComparisons and rejects unauthorized reference names',async()=>{
  const folder=recording({captures:[],frameComparisons:[
   {scenario:'shell',reference:'../../etc/secret.png',result:'../out.png',label:'Custom',note:'n'},
   {scenario:'signing',reference:'signing-18.png',result:'signing-settled.png'},
  ]},{'signing-settled.png':png});
  await buildReviewIndex(folder);
  const records=json(folder,'review-index.json').frameComparisons;
  expect(records[0]).toMatchObject({reference:null,result:null});
  expect(records[1]).toMatchObject({reference:'references/signing-18.png',result:'signing-settled.png'});
  const out=page(folder);
  expect(out).toContain('No authorized reference extract available.');
  expect(out).toContain('<h3>Custom</h3>');
 });

 it('lists leftover PNGs as additional frames outside the comparison set',async()=>{
  const folder=recording({captures:[{scenario:'signing',file:'a.mp4'}]},{'a.mp4':mp4,'signing-settled.png':png,'extra-frame.png':png});
  await buildReviewIndex(folder);
  expect(json(folder,'review-index.json').additionalFrames).toEqual(['extra-frame.png']);
  const out=page(folder);
  expect(out).toContain('Additional captured frames');expect(out).toContain('href="extra-frame.png"');
 });

 it('refuses to overwrite a non-regular output file',async()=>{
  const folder=recording({captures:[]});
  mkdirSync(join(folder,'index.html'));
  await expect(buildReviewIndex(folder)).rejects.toThrow('Refusing to overwrite a nonregular output');
 });

 it('resolves the recording folder through symlinked input paths',async()=>{
  const parent=tempDir('review-index-parent-');
  const folder=join(parent,'real');mkdirSync(folder);
  writeFileSync(join(folder,'manifest.json'),JSON.stringify({captures:[{scenario:'signing',file:'a.mp4'}]}));
  writeFileSync(join(folder,'a.mp4'),mp4);
  const alias=join(parent,'alias');symlinkSync(folder,alias,'dir');
  const result=await buildReviewIndex(alias);
  expect(result.folder).toBe(folder);
  expect(result.availableRecordings).toBe(1);
 });
});
