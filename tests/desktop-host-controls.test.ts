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
