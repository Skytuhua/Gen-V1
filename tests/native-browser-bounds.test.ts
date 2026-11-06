import {expect,it} from 'vitest';
import {nativeBrowserBounds} from '../apps/desktop/browser-bounds';
import {browserSlotRect} from '../apps/web/src/browser-slot-bounds';

it('excludes a full-height sidebar resize target without hiding the rest of the browser',()=>{
 const slot={left:248.533,top:436.825,right:784,bottom:560};
 expect(browserSlotRect(slot,{width:784,height:560},[{left:245.5,right:251.5,top:42,bottom:560}])).toEqual({...slot,left:251.5});
});
it('clips full-span resize targets at each edge while leaving unrelated or partial overlays to occlusion checks',()=>{
 const slot={left:10,top:10,right:200,bottom:100},viewport={width:300,height:200};
 for(const [handle,result]of [
  [{left:198,right:204,top:0,bottom:200},{...slot,right:198}],
  [{left:0,right:300,top:8,bottom:13},{...slot,top:13}],
  [{left:0,right:300,top:97,bottom:103},{...slot,bottom:97}],
  [{left:8,right:13,top:50,bottom:80},slot],
  [{left:220,right:226,top:0,bottom:200},slot],
 ]as const)expect(browserSlotRect(slot,viewport,[handle])).toEqual(result);
});
it('contains slot coordinates in the viewport and collapses completely covered slots',()=>{
 expect(browserSlotRect({left:-20,top:-10,right:900,bottom:700},{width:800,height:600},[])).toEqual({left:0,top:0,right:800,bottom:600});
 const slot={left:10,top:20,right:30,bottom:40};const clipped=browserSlotRect(slot,{width:800,height:600},[{left:0,top:0,right:50,bottom:50}]);expect(clipped.right-clipped.left).toBe(0);
});
it('converts owner CSS pixels into native DIP bounds at real renderer zoom and rounds inward',()=>{
 expect(nativeBrowserBounds({x:251.5,y:436.825,width:532.5,height:123.175},[980,700],1.25)).toEqual({x:315,y:547,width:665,height:153});
 expect(nativeBrowserBounds({x:100,y:80,width:900,height:700},[800,640],.8)).toEqual({x:80,y:64,width:720,height:560});
 expect(nativeBrowserBounds({x:1.1,y:2.1,width:7.5,height:8.5},[100,100],1)).toEqual({x:2,y:3,width:6,height:7});
});
it('preserves a fully hidden native view and rejects malformed or out-of-owner bounds',()=>{
 expect(nativeBrowserBounds({x:0,y:0,width:0,height:0},[800,600],1.5)).toEqual({x:0,y:0,width:0,height:0});
 for(const zoom of [0,-1,NaN,Infinity])expect(()=>nativeBrowserBounds({x:0,y:0,width:100,height:100},[800,600],zoom)).toThrow();
 for(const patch of [{x:-1},{y:-1},{width:-1},{height:-1},{x:NaN},{width:Infinity},{x:750,width:100}])expect(()=>nativeBrowserBounds({x:0,y:0,width:100,height:100,...patch},[800,600],1.25)).toThrow();
 expect(()=>nativeBrowserBounds({x:0,y:0,width:800,height:600},[800,600],1.5)).toThrow();
});
