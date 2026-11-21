import {expect,it,vi} from 'vitest';
import {handleDesktopControl} from '../apps/server/desktop-controls.ts';

const token='a'.repeat(64);
it('accepts only launch-token-bound controls and returns correlated acknowledgements',async()=>{
 const host={stopAll:vi.fn(async()=>({stopped:2})),saveNativeLayout:vi.fn(async()=>{}),close:vi.fn()},send=vi.fn();
 expect(await handleDesktopControl({type:'harness.stopAll',token:'b'.repeat(64),requestId:'one'},token,host,send)).toBe(false);
 expect(await handleDesktopControl({type:'harness.stopAll',token:'é'.repeat(64),requestId:'one'},token,host,send)).toBe(false);
 expect(await handleDesktopControl({type:'harness.stopAll',token,requestId:'one',extra:true},token,host,send)).toBe(false);
 expect(host.stopAll).not.toHaveBeenCalled();
 expect(await handleDesktopControl({type:'harness.stopAll',token,requestId:'one'},token,host,send)).toBe(true);
 expect(send).toHaveBeenCalledWith({type:'harness.stoppedAll',token,requestId:'one',stopped:2});
});
it('reports failed layout saves without inventing a successful acknowledgement',async()=>{
 const host={stopAll:vi.fn(),saveNativeLayout:vi.fn(async()=>{throw Error('private path');}),close:vi.fn()},send=vi.fn();
 await handleDesktopControl({type:'harness.layout.save',token,requestId:'two',layout:{}},token,host,send);
 expect(send).toHaveBeenCalledWith({type:'harness.layout.saved',token,requestId:'two',error:'The workspace layout could not be saved.'});
});
it('serves the power read with exact-shape replies and a generic failure',async()=>{
 const host={stopAll:vi.fn(),saveNativeLayout:vi.fn(async()=>{}),close:vi.fn(),powerRead:vi.fn(async()=>({tasks:2,schedules:1,keepAwakeTasks:true,keepAwakeSchedules:false}))},send=vi.fn();
 expect(await handleDesktopControl({type:'harness.power.read',token,requestId:'p1',extra:1},token,host,send)).toBe(false);
 expect(host.powerRead).not.toHaveBeenCalled();
 expect(await handleDesktopControl({type:'harness.power.read',token,requestId:'p1'},token,host,send)).toBe(true);
 expect(send).toHaveBeenCalledWith({type:'harness.power.read.result',token,requestId:'p1',tasks:2,schedules:1,keepAwakeTasks:true,keepAwakeSchedules:false});
});
it('never leaks host errors through the power read',async()=>{
 const host={stopAll:vi.fn(),saveNativeLayout:vi.fn(async()=>{}),close:vi.fn(),powerRead:vi.fn(async()=>{throw Error('private path');})},send=vi.fn();
 expect(await handleDesktopControl({type:'harness.power.read',token,requestId:'p2'},token,host,send)).toBe(true);
 expect(send).toHaveBeenCalledWith({type:'harness.power.read.result',token,requestId:'p2',error:'Power state is unavailable.'});
 const missing={stopAll:vi.fn(),saveNativeLayout:vi.fn(async()=>{}),close:vi.fn()},sendTwo=vi.fn();
 expect(await handleDesktopControl({type:'harness.power.read',token,requestId:'p3'},token,missing,sendTwo)).toBe(true);
 expect(sendTwo).toHaveBeenCalledWith({type:'harness.power.read.result',token,requestId:'p3',error:'Power state is unavailable.'});
});
