import {expect,it} from 'vitest';
import {nativeBrowserBounds,nativeBrowserPreviewBounds} from '../apps/desktop/browser-bounds';
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

it('centers fitting preview widths inside the rounded slot',()=>{
 const result=nativeBrowserPreviewBounds({x:100,y:96,width:800,height:600},390,[1400,900],1,1);
 expect(result.bounds).toEqual({x:305,y:96,width:390,height:600});
 expect(result.actualWidth).toBe(390);expect(result.availableWidth).toBe(800);
 expect(result.effective).toBe(390);expect(result.availability).toEqual({390:true,768:true});expect(result.hidden).toBe(false);
});
it('falls back to Fit when a preset exceeds available width',()=>{
 const result=nativeBrowserPreviewBounds({x:0,y:96,width:520,height:600},768,[1400,900],1,1);
 expect(result.effective).toBe('fit');expect(result.bounds).toEqual({x:0,y:96,width:520,height:600});
 expect(result.fallbackReason).toBe('768 px needs 768 px; available 520 px');
 expect(result.availability).toEqual({390:true,768:false});
});
it('rejects unknown preview presets without relaxing legacy bounds validation',()=>{
 for(const preset of ['391',391,'full',NaN,Infinity,0,-390,null,{},['fit']])expect(()=>nativeBrowserPreviewBounds({x:0,y:0,width:800,height:600},preset as never,[1000,800],1,1)).toThrow();
 expect(()=>nativeBrowserPreviewBounds({x:-1,y:0,width:800,height:600},390,[1000,800],1,1)).toThrow();
 expect(()=>nativeBrowserPreviewBounds({x:0,y:0,width:1200,height:600},390,[1000,800],1,1)).toThrow();
});
it('keeps narrowed preview inside slot across owner and content zoom',()=>{
 for(const [ownerZoom,contentZoom]of [[1,0.8],[1,1],[1.25,1],[1.5,0.8],[0.8,1.25]]as const){
  const slot={x:150.3,y:96,width:700.4,height:600},result=nativeBrowserPreviewBounds(slot,390,[1400,1200],ownerZoom,contentZoom);
  const outer=nativeBrowserBounds(slot,[1400,1200],ownerZoom);
  expect(result.bounds.x).toBeGreaterThanOrEqual(outer.x);expect(result.bounds.x+result.bounds.width).toBeLessThanOrEqual(outer.x+outer.width);
  expect(result.bounds.y).toBe(outer.y);expect(result.bounds.height).toBe(outer.height);
  expect(result.actualWidth).toBeCloseTo(Math.ceil(390*contentZoom)/contentZoom,5);
 }
 // One DIP short of an exact fit leaves the preset unavailable rather than scaling it down.
 const tight=nativeBrowserPreviewBounds({x:0,y:0,width:311.4,height:600},390,[1000,800],1,0.8);
 expect(tight.availability[390]).toBe(false);expect(tight.effective).toBe('fit');
});
it('preserves hidden bounds and rejects invalid preview geometry',()=>{
 const hidden=nativeBrowserPreviewBounds({x:0,y:0,width:0,height:0},768,[1400,900],1,1);
 expect(hidden.hidden).toBe(true);expect(hidden.bounds).toEqual({x:0,y:0,width:0,height:0});
 expect(hidden.effective).toBe(768);expect(hidden.availability).toEqual({390:false,768:false});
 for(const zoom of [0,-1,NaN,Infinity])expect(()=>nativeBrowserPreviewBounds({x:0,y:0,width:800,height:600},390,[1000,800],1,zoom)).toThrow();
 for(const patch of [{x:NaN},{width:Infinity},{x:950,width:100}])expect(()=>nativeBrowserPreviewBounds({x:0,y:0,width:800,height:600,...patch},390,[1000,800],1,1)).toThrow();
});
it('exposes the applied rectangle in owner CSS coordinates for gutter decoration',()=>{
 const result=nativeBrowserPreviewBounds({x:100,y:96,width:800,height:600},390,[1400,900],1.25,1);
 expect(result.ownerBounds.width).toBeCloseTo(result.bounds.width/1.25,5);
 expect(result.ownerBounds.x).toBeCloseTo(result.bounds.x/1.25,5);
});
