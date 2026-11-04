import {expect,it,vi} from 'vitest';
import {createPersistenceQueue} from '../apps/desktop/persistence.ts';
import {pluginDesktopRequiresGrant} from '../apps/desktop/window-policy.ts';
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
