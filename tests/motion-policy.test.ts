import {afterEach,expect,it,vi} from 'vitest';
import {readMotionPolicy,observeMotionPolicy} from '../apps/web/src/motion-policy';
function fixture(app?:string,reduce=false){
 const root={dataset:{motion:app}},media=Object.assign(new EventTarget(),{matches:reduce}),callbacks=new Set<()=>void>();
 const observe=vi.fn(),disconnect=vi.fn();
 vi.stubGlobal('document',{documentElement:root});vi.stubGlobal('matchMedia',()=>media);
 vi.stubGlobal('MutationObserver',class{constructor(private callback:()=>void){}observe(target:unknown,options:unknown){observe(target,options);callbacks.add(this.callback);}disconnect(){disconnect();callbacks.delete(this.callback);}});
 return {root,media,observe,disconnect,callbacks,app(value?:string){root.dataset.motion=value;for(const callback of callbacks)callback();},os(value:boolean){media.matches=value;media.dispatchEvent(new Event('change'));}};
}
afterEach(()=>vi.unstubAllGlobals());
for(const app of ['system','reduced','off',undefined,'unknown'])for(const os of [false,true])it(`resolves ${app??'missing'} with OS reduce ${os}`,()=>{
 fixture(app,os);expect(readMotionPolicy()).toBe(app==='off'?'off':app==='reduced'||os?'reduced':'full');
});
it('owns filtered root and media listeners, deduplicates effective changes and disposes idempotently',()=>{
 const f=fixture('system'),listener=vi.fn(),add=vi.spyOn(f.media,'addEventListener'),remove=vi.spyOn(f.media,'removeEventListener');
 const dispose=observeMotionPolicy(listener);expect(listener).not.toHaveBeenCalled();expect(add).toHaveBeenCalledTimes(1);
 expect(f.observe).toHaveBeenCalledWith(f.root,{attributes:true,attributeFilter:['data-motion']});
 f.app('reduced');f.os(true);f.app('system');expect(listener.mock.calls).toEqual([['reduced']]);
 f.app('off');f.os(false);f.app('off');f.app('unknown');expect(listener.mock.calls).toEqual([['reduced'],['off'],['full']]);
 dispose();dispose();expect(remove).toHaveBeenCalledTimes(1);expect(f.disconnect).toHaveBeenCalledTimes(1);expect(f.callbacks.size).toBe(0);
 f.app('off');f.os(true);expect(listener).toHaveBeenCalledTimes(3);
});
