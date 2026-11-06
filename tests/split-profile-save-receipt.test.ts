import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store';
import {SplitWorkspaceRepository} from '../packages/core/split-workspace';
import type {HostCommand} from '../packages/contracts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
  const base=await realpath(tmpdir()),root=await mkdtemp(join(base,'gen-profile-receipt-')),store=new Store(root),repo=new SplitWorkspaceRepository(store);
  cleanup.push(async()=>{store.close();if(await realpath(root)!==resolve(root)||!root.startsWith(base+sep)||(await lstat(root)).isSymbolicLink())throw Error('Unsafe receipt fixture cleanup');await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const command=(type:string,payload:Record<string,unknown>={}):HostCommand=>({id:randomUUID(),type:'split-workspace.'+type,payload:{workspaceId:'workspace',baseRevision:repo.read().revision,...payload}});
  return{store,repo,command};
}
function saved(value:unknown){
  expect(value).toMatchObject({version:2,layout:{version:2},profile:{id:expect.any(String),updatedAt:expect.any(String)}});
  return value as {version:2;layout:ReturnType<SplitWorkspaceRepository['read']>;profile:{id:string;updatedAt:string}};
}
it('returns the exact saved identity and version even when other layouts are created concurrently',async()=>{
  const f=await fixture(),first=saved(f.repo.command(f.command('profile.save',{name:'Same name',resultVersion:2})).result);
  f.repo.command(f.command('profile.save',{name:'Same name'}));
  expect(f.repo.readProfiles()).toHaveLength(2);expect(f.repo.readProfiles().find(profile=>profile.id===first.profile.id)).toMatchObject(first.profile);
  expect(first.layout.revision).toBe(1);
});
it('replays the original durable receipt rather than borrowing metadata from a later update',async()=>{
  const f=await fixture(),command=f.command('profile.save',{name:'Original',resultVersion:2}),original=f.repo.command(command),result=saved(original.result);
  f.repo.command(f.command('profile.save',{profileId:result.profile.id,name:'Later'}));
  expect(f.repo.command(command)).toEqual(original);expect(f.repo.readProfiles()[0].name).toBe('Later');
});
it('keeps the existing layout-only save response for callers without the new result contract',async()=>{
  const f=await fixture(),receipt=f.repo.command(f.command('profile.save',{name:'Legacy caller'}));
  expect(receipt.result).toEqual(f.repo.read());expect(receipt.result).not.toHaveProperty('profile');
});
it('rejects unsupported result versions before writing a profile',async()=>{
  const f=await fixture(),before=f.repo.read();expect(()=>f.repo.command(f.command('profile.save',{name:'Invalid',resultVersion:3}))).toThrow();expect(f.repo.readProfiles()).toEqual([]);expect(f.repo.read()).toEqual(before);
});
it('renames metadata without replacing the saved arrangement or current history',async()=>{
  const f=await fixture();f.repo.command(f.command('profile.save',{name:'Desk'}));const id=f.repo.readProfiles()[0].id,before=f.store.get<{layout:unknown;createdAt:string}>('splitWorkspaceProfile',id)!;
  f.repo.command(f.command('pane.split',{paneId:'pane-main',newPaneId:'other',splitId:'columns',axis:'horizontal'}));const current=f.repo.read();
  f.repo.command(f.command('profile.rename',{profileId:id,name:'Renamed'}));const after=f.store.get<{layout:unknown;createdAt:string;name:string}>('splitWorkspaceProfile',id)!;
  expect(after.layout).toEqual(before.layout);expect(after.createdAt).toBe(before.createdAt);expect(after.name).toBe('Renamed');expect({...f.repo.read(),revision:0}).toEqual({...current,revision:0});
  for(const name of ['', 'bad\nname','x'.repeat(101)])expect(()=>f.repo.command(f.command('profile.rename',{profileId:id,name}))).toThrow();
  expect(()=>f.repo.command(f.command('profile.rename',{workspaceId:'foreign',baseRevision:0,profileId:id,name:'Foreign'}))).toThrow();
});

it('changes the saved version when geometry is overwritten or renamed within the same clock tick',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-06T00:00:00.000Z'));
  try{
    const f=await fixture(),first=saved(f.repo.command(f.command('profile.save',{name:'Original',resultVersion:2})).result);
    f.repo.command(f.command('pane.split',{paneId:'pane-main',newPaneId:'other',splitId:'columns',axis:'horizontal'}));
    const second=saved(f.repo.command(f.command('profile.save',{profileId:first.profile.id,name:'Updated',resultVersion:2})).result);
    expect(second.profile.updatedAt).not.toBe(first.profile.updatedAt);
    expect(f.repo.readProfiles().find(profile=>profile.id===first.profile.id)?.updatedAt).toBe(second.profile.updatedAt);
    f.repo.command(f.command('profile.rename',{profileId:first.profile.id,name:'Renamed'}));
    const renamed=f.repo.readProfiles().find(profile=>profile.id===first.profile.id)!;
    expect(renamed.updatedAt).not.toBe(second.profile.updatedAt);
    vi.setSystemTime(new Date('2026-11-05T00:00:00.000Z'));
    const third=saved(f.repo.command(f.command('profile.save',{profileId:first.profile.id,name:'After clock rollback',resultVersion:2})).result);
    expect(third.profile.updatedAt>renamed.updatedAt).toBe(true);
  }finally{vi.useRealTimers();}
});
