import {describe,expect,it,vi} from 'vitest';
import {createWorkspaceNotifications,visibleNotifications} from '../apps/web/src/workspace-notifications';

const deferred=()=>{let resolve!:()=>void, reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
describe('owned workspace notifications',()=>{
 it('retains independent failures, deduplicates in place, and shows the newest three',()=>{
  const store=createWorkspaceNotifications(),changed=vi.fn(),unsubscribe=store.subscribe(changed);
  const first=store.report('First');store.report('Second');store.report('Third');store.report('Fourth');store.report('Fifth');
  expect(store.report('First')).toBe(first);
  expect(store.getSnapshot().map(item=>item.message)).toEqual(['Fifth','Fourth','Third','Second','First']);
  expect(visibleNotifications(store.getSnapshot(),false).map(item=>item.message)).toEqual(['Fifth','Fourth','Third']);
  expect(visibleNotifications(store.getSnapshot(),true)).toHaveLength(5);
  store.dismiss(first);expect(store.getSnapshot().find(item=>item.id===first)?.leaving).toBe(true);
  store.remove(first);expect(store.getSnapshot()).toHaveLength(4);
  unsubscribe();const count=changed.mock.calls.length;store.report('Another');expect(changed).toHaveBeenCalledTimes(count);
 });
 it('updates the same operation without replacing another failure',()=>{
  const store=createWorkspaceNotifications(),id=store.report('Offline',{key:'snapshot'});store.report('Other');
  expect(store.report('Still offline',{key:'snapshot'})).toBe(id);
  expect(store.getSnapshot().map(item=>item.message)).toEqual(['Other','Still offline']);
 });
 it('retries only the selected operation, guards double clicks, and keeps its position',async()=>{
  const store=createWorkspaceNotifications(),pending=deferred(),retry=vi.fn(()=>pending.promise),other=vi.fn();
  const id=store.report('Snapshot failed',{retry});store.report('Layout failed',{retry:other});
  const action=store.retry(id);await store.retry(id);
  expect(retry).toHaveBeenCalledTimes(1);expect(other).not.toHaveBeenCalled();
  expect(store.getSnapshot().map(item=>item.status)).toEqual(['error','retrying']);
  expect(store.report('Snapshot failed',{retry})).toBe(id);
  pending.resolve();await action;
  expect(store.getSnapshot().map(item=>item.status)).toEqual(['error','success']);
 });
 it('keeps a failed retry actionable and updates its detail',async()=>{
  const store=createWorkspaceNotifications(),retry=vi.fn().mockRejectedValueOnce(Error('Still offline')).mockResolvedValueOnce(undefined);
  const id=store.report('Offline',{retry});await store.retry(id);
  expect(store.getSnapshot()[0]).toMatchObject({id,message:'Still offline',status:'error'});
  await store.retry(id);expect(store.getSnapshot()[0].status).toBe('success');
 });
 it('does not resurrect a dismissed notice or overwrite a new failure after stale completion',async()=>{
  const store=createWorkspaceNotifications(),pending=deferred(),id=store.report('Offline',{retry:()=>pending.promise});
  const action=store.retry(id);store.dismiss(id);store.remove(id);const replacement=store.report('Offline');
  pending.resolve();await action;
  expect(replacement).not.toBe(id);expect(store.getSnapshot()).toEqual([expect.objectContaining({id:replacement,status:'error'})]);
 });
 it('ignores stale failure after disposal and never retries an unsafe action',async()=>{
  const store=createWorkspaceNotifications(),pending=deferred(),id=store.report('Offline',{retry:()=>pending.promise});
  const action=store.retry(id);store.clear();pending.reject(Error('Too late'));await action;expect(store.getSnapshot()).toEqual([]);
  const unsafe=store.report('Confirm this action again');await store.retry(unsafe);expect(store.getSnapshot()[0].status).toBe('error');
 });
 it('captures a scoped operation for recovery and ignores empty reports',async()=>{
  const store=createWorkspaceNotifications(),action=vi.fn().mockRejectedValueOnce(Error('Read failed')).mockResolvedValueOnce(undefined);
  store.report('');expect(store.getSnapshot()).toHaveLength(0);
  await store.run(action,{key:'read',title:'Couldn’t update workspace'});expect(store.getSnapshot()[0].message).toBe('Read failed');
  await store.retry(store.getSnapshot()[0].id);expect(action).toHaveBeenCalledTimes(2);expect(store.getSnapshot()[0].status).toBe('success');
 });
});
