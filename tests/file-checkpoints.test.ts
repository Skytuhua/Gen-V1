import {describe,expect,it} from 'vitest';
import {disabledCheckpointAdapter,readCheckpointList,readCheckpointReview,type CheckpointOwner,type FileCheckpoint} from '../apps/web/src/file-checkpoint-api';

const owner:CheckpointOwner={projectId:'project',threadId:'thread',workingCopyId:'work'};
const checkpoint:FileCheckpoint={id:'one',label:'Before editing',createdAt:'2026-11-10T18:42:00Z',provenance:'Guarded write',revision:'r1',paths:['src/file.ts'],fileCount:1};
const list=()=>({owner,items:[checkpoint],nextCursor:null,retention:{}});
const review=()=>({owner,checkpointId:checkpoint.id,checkpointRevision:'r1',workingCopyRevision:'w2',reviewId:'review',expiresAt:'2099-01-01T00:00:00Z',files:[{path:'src/file.ts',currentHash:'a',targetHash:'b',diff:{before:'a',after:'b'},status:'available',restoreSupported:true}]});
describe('checkpoint read adapter',()=>{
 it('keeps checkpoint time, paths, provenance and revision',()=>{expect(readCheckpointList(list(),owner).items).toEqual([checkpoint]);});
 it.each(['projectId','threadId','workingCopyId'] as const)('rejects a foreign %s in list and review',key=>{
  expect(()=>readCheckpointList({...list(),owner:{...owner,[key]:'other'}},owner)).toThrow('owner changed');
  expect(()=>readCheckpointReview({...review(),owner:{...owner,[key]:'other'}},owner,checkpoint)).toThrow('revision changed');
 });
 it.each(['/etc/passwd','../secret','src/../secret','C:/secret','src\\file.ts','a//b','a/./b','a\u0000b'])('rejects unsafe path %s',path=>{
  expect(()=>readCheckpointList({...list(),items:[{...checkpoint,paths:[path]}]},owner)).toThrow();
  expect(()=>readCheckpointReview({...review(),files:[{...review().files[0],path}]},owner,checkpoint)).toThrow();
 });
 it('rejects duplicate IDs, paths and invalid file counts',()=>{
  expect(()=>readCheckpointList({...list(),items:[checkpoint,checkpoint]},owner)).toThrow('Duplicate');
  expect(()=>readCheckpointList({...list(),items:[{...checkpoint,paths:['a','a']}]},owner)).toThrow();
  expect(()=>readCheckpointList({...list(),items:[{...checkpoint,fileCount:0}]},owner)).toThrow();
 });
 it('keeps an empty list distinct from service unavailability',async()=>{
  expect(readCheckpointList({...list(),items:[]},owner).items).toEqual([]);
  expect(disabledCheckpointAdapter.available).toBe(false);
  expect(disabledCheckpointAdapter.restore.enabled).toBe(false);
  expect(Object.keys(disabledCheckpointAdapter.restore)).not.toContain('write');
  await expect(disabledCheckpointAdapter.list(owner,{signal:new AbortController().signal})).rejects.toThrow('No checkpoint service');
 });
 it('validates bounded reviews without granting restore authority',()=>{
  expect(readCheckpointReview(review(),owner,checkpoint).files[0].diff).toEqual({before:'a',after:'b'});
  expect(disabledCheckpointAdapter.restore.enabled).toBe(false);
 });
 it('rejects changed checkpoints, expired reviews, duplicates and unrelated files',()=>{
  expect(()=>readCheckpointReview({...review(),checkpointRevision:'r2'},owner,checkpoint)).toThrow('revision changed');
  expect(()=>readCheckpointReview({...review(),expiresAt:'2000-01-01T00:00:00Z'},owner,checkpoint)).toThrow('expired');
  expect(()=>readCheckpointReview({...review(),files:[review().files[0],review().files[0]]},owner,checkpoint)).toThrow('Duplicate');
  expect(()=>readCheckpointReview({...review(),files:[{...review().files[0],path:'unrelated.ts'}]},owner,checkpoint)).toThrow('unexpected file');
 });
 it.each(['binary','missing','expired','denied'])('preserves %s and rename metadata without inventing a diff',status=>{
  const result=readCheckpointReview({...review(),files:[{...review().files[0],status,diff:null,oldPath:'src/old.ts',restoreSupported:false}]},owner,checkpoint);
  expect(result.files[0]).toMatchObject({status,diff:null,oldPath:'src/old.ts',restoreSupported:false});
 });
});
