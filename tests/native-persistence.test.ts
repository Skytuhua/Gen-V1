import {expect,it,vi} from 'vitest';
import {createPersistenceQueue,reconcileSavedWindows} from '../apps/desktop/persistence.ts';
import {pluginDesktopRequiresGrant} from '../apps/desktop/window-policy.ts';
import {type DesktopSurface,desktopSurfaceKey} from '../packages/desktop-contract/index.ts';
it('keeps three closed local references without reopening them when the Store contains only main',()=>{
 const local=[{surface:{kind:'navigation'} as DesktopSurface,open:false,marker:'navigation-bounds'},{surface:{kind:'thread',threadId:'thread-a'} as DesktopSurface,open:false,marker:'thread-bounds'},{surface:{kind:'plan',threadId:'thread-a'} as DesktopSurface,open:false,marker:'plan-bounds'}];
 const active=[{surface:{kind:'main'} as DesktopSurface,open:true,marker:'authoritative-main'}];
 const saved=reconcileSavedWindows(local,active);
 expect(saved).toEqual([...local,...active]);expect(saved.filter(entry=>entry.open)).toEqual(active);
});
it('uses the complete surface identity and demotes stale local opens to closed history',()=>{
 const old={surface:{kind:'plugin',pluginId:'example-plugin',scopeId:'project-a',surfaceId:'plan',resourceId:'order-old'} as DesktopSurface,open:true,marker:'old'};
 const current={surface:{...old.surface,resourceId:'order-current'} as DesktopSurface,open:true,marker:'current'};
 const saved=reconcileSavedWindows([old,{...current,marker:'stale-local'}],[current]);
 expect(saved).toEqual([{...old,open:false},current]);
 expect(saved.map(entry=>desktopSurfaceKey(entry.surface))).toEqual([desktopSurfaceKey(old.surface),desktopSurfaceKey(current.surface)]);
});
it('keeps newest history within the existing limit without displacing active windows',()=>{
 const local=Array.from({length:24},(_,index)=>({surface:{kind:'thread',threadId:'thread-'+index} as DesktopSurface,open:false,marker:index}));
 const active=[{surface:{kind:'main'} as DesktopSurface,open:true,marker:99}];
 const saved=reconcileSavedWindows(local,active);expect(saved).toHaveLength(24);expect(saved).toEqual([...local.slice(1),...active]);
});
it('writes the final close state after every earlier in-flight state save',async()=>{
 const queue=createPersistenceQueue(),writes:string[]=[];let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const earlier=queue.enqueue(async()=>{await gate;writes.push('old');});const final=queue.enqueue(async()=>{writes.push('new');});
 await Promise.resolve();expect(writes).toEqual([]);release();await earlier;await final;await queue.flush();expect(writes).toEqual(['old','new']);
});
it('preserves a failed flush while allowing a later explicit complete state save',async()=>{
 const queue=createPersistenceQueue();await expect(queue.enqueue(async()=>{throw Error('Disk unavailable');})).rejects.toThrow();await expect(queue.flush()).rejects.toThrow();const write=vi.fn(async()=>{});await queue.enqueue(write);await queue.flush();expect(write).toHaveBeenCalledOnce();
});
it('permits a bound close acknowledgement after operational access expires',()=>{
 expect(pluginDesktopRequiresGrant('harness-desktop:close-answer')).toBe(false);expect(pluginDesktopRequiresGrant('harness-desktop:ready')).toBe(true);expect(pluginDesktopRequiresGrant('harness-desktop:detach')).toBe(true);
});
