import {beforeEach,describe,expect,it,vi} from 'vitest';
const journal=vi.hoisted(()=>({rows:new Map<string,{value:unknown;generation:string;updatedAt:number}>(),serial:0,fail:false}));
vi.mock('../apps/web/src/journal',()=>({
 journalReadRecord:vi.fn(async(key:string)=>journal.rows.get(key)),
 journalEntries:vi.fn(async()=>[...journal.rows].map(([key,record])=>({key,record}))),
 journalCompareAndSwap:vi.fn(async(key:string,generation:string|undefined,value:unknown)=>{if(journal.fail)throw Error('Journal unavailable');if(journal.rows.get(key)?.generation!==generation)return false;journal.rows.set(key,{value,generation:String(++journal.serial),updatedAt:journal.serial});return true;}),
 journalFlush:vi.fn(async()=>{if(journal.fail)throw Error('Journal unavailable');}),
}));
import {recoverWorkbenchInput,recoveryCommandKey} from '../apps/web/src/workbench-input-recovery';
const owner={threadId:'thread',projectId:'project',workspaceId:'workspace'};
const accepted=(request:{commandId:string;inputId:string;action:'KEEP_CAPTURED'|'CANCEL'})=>({commandId:request.commandId,eventSeq:1,result:{inputId:request.inputId,action:request.action,resumeRequired:request.action==='KEEP_CAPTURED'}});
beforeEach(()=>{journal.rows.clear();journal.serial=0;journal.fail=false;});
describe('accepted source input recovery custody',()=>{
 it('persists the exact action before transport and retires it only after matching receipt',async()=>{
  const send=vi.fn(async request=>{expect(journal.rows.get(recoveryCommandKey(owner,'input'))?.value).toEqual(request);return accepted(request);});
  await expect(recoverWorkbenchInput(owner,'input','KEEP_CAPTURED',send)).resolves.toMatchObject({result:{resumeRequired:true}});
  expect(journal.rows.get(recoveryCommandKey(owner,'input'))?.value).toBeNull();expect(send).toHaveBeenCalledTimes(1);
 });
 it('reuses the identical command after lost acknowledgment and refuses a different action',async()=>{
  const send=vi.fn().mockRejectedValueOnce(Error('Disconnected')).mockImplementation(async request=>accepted(request));
  await expect(recoverWorkbenchInput(owner,'input','KEEP_CAPTURED',send)).rejects.toThrow('Disconnected');
  await expect(recoverWorkbenchInput(owner,'input','CANCEL',send)).rejects.toThrow(/retry.*KEEP_CAPTURED/i);
  await recoverWorkbenchInput(owner,'input','KEEP_CAPTURED',send);
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
 });
 it('does not dispatch when the journal cannot persist the choice',async()=>{
  journal.fail=true;const send=vi.fn();await expect(recoverWorkbenchInput(owner,'input','CANCEL',send)).rejects.toThrow('Journal unavailable');expect(send).not.toHaveBeenCalled();
 });
 it('permits a different choice after a definitive host rejection',async()=>{
  const denied=Object.assign(Error('Keep is disabled'),{details:{recoveryAccepted:false}});
  await expect(recoverWorkbenchInput(owner,'input','KEEP_CAPTURED',async()=>{throw denied;})).rejects.toThrow('Keep is disabled');
  const send=vi.fn(async request=>accepted(request));await recoverWorkbenchInput(owner,'input','CANCEL',send);expect(send.mock.calls[0][0].action).toBe('CANCEL');
 });
 it('rejects an unrelated receipt without clearing the frozen action',async()=>{
  await expect(recoverWorkbenchInput(owner,'input','CANCEL',async request=>({...accepted(request),commandId:'other'}))).rejects.toThrow(/receipt/i);
  expect(journal.rows.get(recoveryCommandKey(owner,'input'))?.value).toMatchObject({inputId:'input',action:'CANCEL'});
 });
 it('cannot clear a newer generation when an old acknowledgment arrives',async()=>{
  const key=recoveryCommandKey(owner,'input');const newer={value:{newer:true},generation:'newer',updatedAt:99};
  await recoverWorkbenchInput(owner,'input','CANCEL',async request=>{journal.rows.set(key,newer);return accepted(request);});
  expect(journal.rows.get(key)).toBe(newer);
 });
 it('uses full logical ownership in the key',()=>{
  expect(recoveryCommandKey(owner,'input')).not.toBe(recoveryCommandKey({...owner,workspaceId:'replacement'},'input'));
 });
});
