import {describe,it,expect} from 'vitest';
import {savedDraftOwnerKey,readSavedDraftLibrary,createSavedDraft,insertDraftText,disabledReferenceValidation} from '../apps/web/src/saved-drafts';
const owner={profileId:'profile',accountId:'account',threadId:'thread',projectId:'project',workingCopyId:'copy'};
describe('saved drafts text-only contract',()=>{
 it('isolates every ownership dimension without ambiguous concatenation',()=>{const key=savedDraftOwnerKey(owner);for(const field of Object.keys(owner))expect(savedDraftOwnerKey({...owner,[field]:'other'})).not.toBe(key);});
 it('stores versioned bounded records and rejects extra secret/runtime fields or a foreign owner',()=>{
  const draft=createSavedDraft(owner,'Review release','Prompt');expect(draft).toMatchObject({version:1,owner,name:'Review release',text:'Prompt',resourceRefs:[],skills:[],excerpts:[]});
  expect(()=>readSavedDraftLibrary({version:1,owner,records:[{...draft,token:'private'}]},owner)).toThrow();expect(()=>readSavedDraftLibrary({version:1,owner,records:[draft]},{...owner,accountId:'other'})).toThrow();expect(()=>createSavedDraft(owner,'','text')).toThrow();
 });
 it('inserts at the caret without deleting selected text or changing attachment choices',()=>{expect(insertDraftText('abcd','new',2)).toEqual({text:'abnewcd',caret:5});expect(insertDraftText('😀x','new',1)).toEqual({text:'😀newx',caret:5});});
 it('keeps rich reference restoration disabled and names unavailable metadata explicitly',async()=>{
  expect(disabledReferenceValidation.enabled).toBe(false);const result=await disabledReferenceValidation.validate({owner,resourceRefs:[{resourceId:'r'}],skills:[]});expect(result.available).toBe(false);expect(result.issues[0]).toContain('r');
 });
});
it('caps libraries without silently expiring named prompts or accepting private reference fields',()=>{
 const draft=createSavedDraft(owner,'Prompt','text');const library={version:1,owner,records:Array.from({length:21},()=>({...draft,id:crypto.randomUUID()}))};expect(()=>readSavedDraftLibrary(library,owner)).toThrow();
 expect(()=>createSavedDraft(owner,'Secret','text',{resourceRefs:[{resourceId:'r',token:'must-not-persist'} as never]})).toThrow();
 expect(()=>createSavedDraft(owner,'Oversized','😀'.repeat(20000))).toThrow();
});
