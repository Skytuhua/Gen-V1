import {describe,expect,it} from 'vitest';
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

describe('QA r1 regressions',()=>{
 it('#1 accepts a frozen root-owner list without invented paths or retention',()=>{expect(readCheckpointList(list(),owner)).toEqual(list());});
 it('#1 accepts a bounded, explicitly truncated frozen unified review',()=>{expect(readReview(review())).toEqual(review());});
 it('#1 rejects checkpoints above the frozen 100-file cap',()=>{expect(()=>readCheckpointList({...list(),items:[{...checkpoint,fileCount:101}]},owner)).toThrow();});
 it('#2 preserves a legal leading space in a file path through detail and review',()=>{
  const value=readCheckpointDetail({...detail(),files:[file(' src/a')]},owner,checkpoint),paths=checkpointReviewPaths(value);
  expect(paths).toEqual([' src/a']);expect(readReview({...review(),files:[reviewFile(' src/a')]},paths).files[0].path).toBe(' src/a');
 });
 it('#2 rejects rather than trims invalid trailing spaces',()=>{expect(()=>readCheckpointDetail({...detail(),files:[file('src/a ')]},owner,checkpoint)).toThrow();});
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
  expect(()=>readCheckpointDetail({...detail(),files:[file(path)]},owner,checkpoint)).toThrow();
  expect(()=>readReview({...review(),files:[reviewFile(path)]},[path])).toThrow();
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
  const value=readCheckpointDetail({...detail(),checkpoint:summary,files},owner,summary),paths=checkpointReviewPaths(value);
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
 it('bounds review request bytes before calling the host',()=>{
  const files=Array.from({length:100},(_,i)=>file(`src/${i}/${'é'.repeat(300)}`)),summary={...checkpoint,fileCount:100};
  const value=readCheckpointDetail({...detail(),checkpoint:summary,files},owner,summary);
  expect(()=>checkpointReviewPaths(value)).toThrow('32 KiB');
  expect(()=>checkpointReviewPaths({...detail(),files:[]})).toThrow('No files');
  expect(()=>checkpointReviewPaths({...detail(),owner:{...owner,threadId:null}})).toThrow('owning conversation');
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
