import {describe,expect,it} from 'vitest';
import {ZodError} from 'zod';
import {globSync,readFileSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import browserConfig from './e2e/file-checkpoints.playwright.config';
import viteConfig from './e2e/file-checkpoints.vite.config';
import {checkpointOwnerKey,checkpointReviewPaths,disabledCheckpointAdapter,readCheckpointDetail,readCheckpointList,readCheckpointReview,type CheckpointOwner,type FileCheckpoint} from '../apps/web/src/file-checkpoint-api';

const hash='a'.repeat(64),otherHash='b'.repeat(64);
const owner:CheckpointOwner={projectId:'project',threadId:'thread',workingCopyId:null,binding:hash};
const checkpoint:FileCheckpoint={id:'one',label:'Before editing',createdAt:'2026-11-10T18:42:00Z',provenance:{kind:'guarded_write',operationId:'operation'},revision:hash,fileCount:1,expiresAt:null};
const list=()=>({owner,items:[checkpoint],nextCursor:null});
const file=(path='src/file.ts')=>({path,targetHash:hash,bytes:20,restorable:true,reason:null});
const detail=()=>({owner,checkpoint,files:[file()]});
const reviewFile=(path='src/file.ts')=>({path,currentHash:otherHash,targetHash:hash,diff:'@@ -1 +1 @@\n-before\n+after',diffTruncated:true,status:'ready'});
const review=()=>({owner,reviewId:'review',checkpointRevision:hash,expiresAt:'2099-01-01T00:00:00Z',files:[reviewFile()]});
const readReview=(value:unknown,paths=['src/file.ts'])=>readCheckpointReview(value,owner,checkpoint,paths);
function expectValidation(action:()=>unknown,path:(string|number)[],code?:string){
 let error:unknown;try{action();}catch(cause){error=cause;}
 expect(error).toBeInstanceOf(ZodError);
 expect((error as ZodError).issues).toEqual(expect.arrayContaining([expect.objectContaining({path,...(code?{code}:{})})]));
}

describe('QA r1 regressions',()=>{
 it('#1 accepts a frozen root-owner list without invented paths or retention',()=>{expect(readCheckpointList(list(),owner)).toEqual(list());});
 it('#1 accepts a bounded, explicitly truncated frozen unified review',()=>{expect(readReview(review())).toEqual(review());});
 it('#1 rejects checkpoints above the frozen 100-file cap',()=>{
  expect(readCheckpointList(list(),owner)).toEqual(list());
  expectValidation(()=>readCheckpointList({...list(),items:[{...checkpoint,fileCount:101}]},owner),['items',0,'fileCount'],'too_big');
 });
 it('#2 preserves a legal leading space in a file path through detail and review',()=>{
  const value=readCheckpointDetail({...detail(),files:[file(' src/a')]},owner,checkpoint),paths=checkpointReviewPaths(value)[0];
  expect(paths).toEqual([' src/a']);expect(readReview({...review(),files:[reviewFile(' src/a')]},paths).files[0].path).toBe(' src/a');
 });
 it('#2 rejects rather than trims invalid trailing spaces',()=>{
  expect(readCheckpointDetail({...detail(),files:[file('src/a')]},owner,checkpoint).files[0].path).toBe('src/a');
  expectValidation(()=>readCheckpointDetail({...detail(),files:[file('src/a ')]},owner,checkpoint),['files',0,'path'],'custom');
 });
 it('#3 rejects an empty review for a known nonempty checkpoint',()=>{expect(()=>readReview({...review(),files:[]})).toThrow('incomplete');});
});
describe('frozen checkpoint read seam',()=>{
 it('keeps summary provenance, expiry and owner binding without normalizing bytes',()=>{
  expect(readCheckpointList(list(),owner).items).toEqual([checkpoint]);
  expect(checkpointOwnerKey(owner)).not.toBe(checkpointOwnerKey({...owner,binding:otherHash}));
  expect(readCheckpointList({...list(),owner:{...owner,threadId:null}}, {...owner,threadId:null}).owner.threadId).toBeNull();
 });
 it.each(['projectId','threadId','workingCopyId','binding'] as const)('rejects a foreign %s in every response',key=>{
  const foreign={...owner,[key]:key==='binding'?otherHash:'other'};
  expect(()=>readCheckpointList({...list(),owner:foreign},owner)).toThrow('owner changed');
  expect(()=>readCheckpointDetail({...detail(),owner:foreign},owner,checkpoint)).toThrow('revision changed');
  expect(()=>readReview({...review(),owner:foreign})).toThrow('revision changed');
 });
 it.each(['/etc/passwd','../secret','src/../secret','C:/secret','src\\file.ts','a//b','a/./b','a\0b','src/a ','src. /a','src/a.','NUL.txt','a/COM1','a/LPT³.md','con .txt','a/CONIN$','a/.GIT/config','accounts/token','nested/hermes/state','checkpoints/file','harness.sqlite','x'.repeat(1025),'é'.repeat(513),'a\ud800'])('rejects unsafe or oversized path %j',path=>{
  expect(readCheckpointDetail(detail(),owner,checkpoint)).toEqual(detail());expect(readReview(review())).toEqual(review());
  const code=path.length>1024?'too_big':'custom';
  expectValidation(()=>readCheckpointDetail({...detail(),files:[file(path)]},owner,checkpoint),['files',0,'path'],code);
  expectValidation(()=>readReview({...review(),files:[reviewFile(path)]},[path]),['files',0,'path'],code);
 });
 it('rejects duplicate IDs and case-insensitive duplicate paths',()=>{
  expect(()=>readCheckpointList({...list(),items:[checkpoint,checkpoint]},owner)).toThrow('Duplicate');
  const two={...checkpoint,fileCount:2};expect(()=>readCheckpointDetail({...detail(),checkpoint:two,files:[file('a'),file('A')]},owner,two)).toThrow('Duplicate');
  expect(()=>readReview({...review(),files:[reviewFile('a'),reviewFile('A')]},['a','A'])).toThrow('Duplicate');
 });
 it('requires a complete detail and exactly one result per requested path',()=>{
  const two={...checkpoint,fileCount:2};
  expect(()=>readCheckpointDetail({...detail(),checkpoint:two},owner,two)).toThrow('incomplete');
  expect(()=>readReview(review(),['src/file.ts','second.ts'])).toThrow('incomplete');
  expect(()=>readReview({...review(),files:[reviewFile(),reviewFile()]})).toThrow('Duplicate');
  expect(()=>readReview({...review(),files:[reviewFile('unrelated.ts')]})).toThrow('unexpected file');
  expect(()=>readReview({...review(),files:[reviewFile('SRC/file.ts')]})).toThrow('unexpected file');
 });
 it('accepts the full 100-file detail and review without summary paths',()=>{
  const summary={...checkpoint,fileCount:100},files=Array.from({length:100},(_,i)=>file(`src/${i}.ts`));
  const value=readCheckpointDetail({...detail(),checkpoint:summary,files},owner,summary),paths=checkpointReviewPaths(value)[0];
  expect(paths).toHaveLength(100);expect(readReview({...review(),files:paths.map(reviewFile)},paths).files).toHaveLength(100);
 });
 it('rejects list/detail/review count overflow and non-v1 fields',()=>{
  expect(()=>readCheckpointList({...list(),items:Array.from({length:51},(_,i)=>({...checkpoint,id:'id-'+i}))},owner)).toThrow();
  expect(()=>readCheckpointDetail({...detail(),files:Array.from({length:101},(_,i)=>file('f'+i))},owner,checkpoint)).toThrow();
  expect(()=>readReview({...review(),files:Array.from({length:101},(_,i)=>reviewFile('f'+i))})).toThrow();
  for(const value of [{...list(),retention:{}},{...list(),items:[{...checkpoint,paths:[]}]}])expect(()=>readCheckpointList(value,owner)).toThrow();
  expect(()=>readReview({...review(),checkpointId:'invented'})).toThrow();
  expect(()=>readReview({...review(),files:[{...reviewFile(),diff:{before:'a',after:'b'}}]})).toThrow();
 });
 it('bounds UTF-8 diff bytes per file and the whole JSON response',()=>{
  expect(readReview({...review(),files:[{...reviewFile(),diff:'é'.repeat(65536)}]}).files[0].diff).toHaveLength(65536);
  expect(()=>readReview({...review(),files:[{...reviewFile(),diff:'é'.repeat(65537)}]})).toThrow();
  const files=Array.from({length:4},(_,i)=>({...reviewFile('f'+i),diff:'x'.repeat(128*1024)}));
  expect(()=>readReview({...review(),files},files.map(file=>file.path))).toThrow('512 KiB');
 });
 it('QA r2: reviews all 100 valid long paths in bounded exact subsets',()=>{
  const files=Array.from({length:100},(_,i)=>file(`src/${i}/${'a'.repeat(200)}/${'b'.repeat(200)}/file.ts`)),summary={...checkpoint,fileCount:100};
  const value=readCheckpointDetail({...detail(),checkpoint:summary,files},owner,summary);
  const batches=checkpointReviewPaths(value);
  expect(batches.length).toBeGreaterThan(1);expect(batches.flat()).toEqual(files.map(file=>file.path));
  for(const paths of batches){
   expect(Array.isArray(paths)).toBe(true);expect(paths.length).toBeGreaterThan(0);expect(paths.length).toBeLessThanOrEqual(100);
   expect(new TextEncoder().encode(JSON.stringify({threadId:owner.threadId,paths})).byteLength).toBeLessThanOrEqual(32*1024);
   expect(readCheckpointReview({...review(),files:paths.map(reviewFile)},owner,summary,paths).files).toHaveLength(paths.length);
  }
 });
 it('requires files and a thread for any review request',()=>{
  expect(()=>checkpointReviewPaths({...detail(),files:[]})).toThrow('No files');
  expect(()=>checkpointReviewPaths({...detail(),owner:{...owner,threadId:null}})).toThrow('owning conversation');
 });
 it('keeps every long Unicode path while bounding each request by UTF-8 JSON bytes',()=>{
  const files=Array.from({length:100},(_,i)=>file(`src/${i}/${'é'.repeat(200)}/${'漢'.repeat(100)}/file.ts`)),summary={...checkpoint,fileCount:100};
  const value=readCheckpointDetail({...detail(),checkpoint:summary,files},owner,summary),batches=checkpointReviewPaths(value);
  expect(batches.length).toBeGreaterThan(1);expect(batches.flat()).toEqual(files.map(file=>file.path));
  for(const paths of batches)expect(new TextEncoder().encode(JSON.stringify({threadId:owner.threadId,paths})).byteLength).toBeLessThanOrEqual(32*1024);
 });
 it('rejects malformed identifiers, hashes, Unicode, expired or changed reviews',()=>{
  expect(()=>readCheckpointList({...list(),owner:{...owner,projectId:' project'}},owner)).toThrow();
  expect(()=>readCheckpointList({...list(),owner:{...owner,binding:hash.toUpperCase()}},owner)).toThrow();
  expect(()=>readCheckpointList({...list(),items:[{...checkpoint,label:'\ud800'}]},owner)).toThrow();
  expect(()=>readCheckpointDetail({...detail(),checkpoint:{...checkpoint,id:'other'}},owner,checkpoint)).toThrow('revision changed');
  expect(()=>readReview({...review(),checkpointRevision:otherHash})).toThrow('revision changed');
  expect(()=>readReview({...review(),expiresAt:'2000-01-01T00:00:00Z'})).toThrow('expired');
  expect(()=>readReview({...review(),files:[{...reviewFile(),currentHash:null}]})).toThrow('missing hashes');
  expect(()=>readReview({...review(),files:[{...reviewFile(),diff:'\ud800'}]})).toThrow();
 });
 it.each(['missing','binary','too_large','unreadable','unsupported'])('keeps unsupported %s metadata without inventing file content',status=>{
  expect(readReview({...review(),files:[{...reviewFile(),status,diff:null,diffTruncated:false,currentHash:null,targetHash:null}]}).files[0]).toMatchObject({status,diff:null,currentHash:null,targetHash:null});
 });
 it('keeps empty history distinct from service unavailability and never grants restore',async()=>{
  expect(readCheckpointList({...list(),items:[]},owner).items).toEqual([]);
  expect(disabledCheckpointAdapter.available).toBe(false);expect(disabledCheckpointAdapter.restore.enabled).toBe(false);
  const options={signal:new AbortController().signal};
  await expect(disabledCheckpointAdapter.list(owner,options)).rejects.toThrow('No checkpoint service');
  await expect(disabledCheckpointAdapter.detail(owner,checkpoint,options)).rejects.toThrow('No checkpoint service');
  await expect(disabledCheckpointAdapter.review(owner,checkpoint,{...options,paths:['src/file.ts']})).rejects.toThrow('No checkpoint service');
 });
});

const forbiddenOutput=['','home','box','gen-company','ledger'].join('/');
const forbiddenReferences=(sources:[string,string][])=>sources.filter(([,source])=>source.replaceAll('\\','/').includes(forbiddenOutput)).map(([path])=>path);
describe('test and capture output boundary',()=>{
 it('detects prohibited references in specs and capture scripts',()=>{
  expect(forbiddenReferences([['probe.spec.ts',`screenshot({path:'${forbiddenOutput}/evidence.png'})`],['scripts/capture/probe.ts',forbiddenOutput],['safe.spec.ts','testInfo.outputPath("image.png")']])).toEqual(['probe.spec.ts','scripts/capture/probe.ts']);
 });
 it('specs, e2e fixtures and capture scripts never reference the protected output path',()=>{
  const files=[...new Set(globSync(['**/*.spec.{ts,tsx,js,jsx,mjs,cjs,mts,cts}','tests/e2e/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}','scripts/**/*capture*.{ts,tsx,js,mjs,cjs,py,sh,ps1}','scripts/**/capture*/**/*.{ts,tsx,js,mjs,cjs,py,sh,ps1}'],{cwd:resolve('.'),exclude:['node_modules/**','third-party/**','.git/**','test-results/**','dist/**']}))];
  expect(files.length).toBeGreaterThan(100);
  expect(forbiddenReferences(files.map(path=>[path,readFileSync(path,'utf8')]))).toEqual([]);
 });
 it('QA r2: keeps the Vite cache beneath the configured Playwright output directory',()=>{
  const output=resolve(browserConfig.outputDir!),cache=resolve(viteConfig.cacheDir!);
  const location=relative(output,cache);expect(location).not.toBe('');expect(location.startsWith('..')).toBe(false);expect(isAbsolute(location)).toBe(false);
 });
 it('captures use Playwright output paths rather than an arbitrary environment destination',()=>{
  const source=readFileSync('tests/e2e/file-checkpoints.spec.ts','utf8');
  expect(source).not.toContain('WO5_SCREENSHOTS');
  const paths=[...source.matchAll(/page\.screenshot\(\{\s*path:([^,]+)/g)].map(match=>match[1]);
  expect(paths.length).toBeGreaterThan(0);expect(paths.every(path=>path.startsWith('testInfo.outputPath('))).toBe(true);
 });
});
