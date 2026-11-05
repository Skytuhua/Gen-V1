import {afterEach,describe,expect,it,vi} from 'vitest';
import {clampFloatingLayout,floatingLayoutKey,readFloatingLayout,writeFloatingLayout} from '../apps/web/src/floating-layout';

const minimum={width:280,height:180};
const layout={x:480,y:140,width:360,height:300,collapsed:false,floating:true};
afterEach(()=>vi.unstubAllGlobals());

describe('free floating window geometry',()=>{
 it('keeps free windows inside their workspace rather than covering navigation',()=>{
  const area={width:1440,height:1000,left:260,right:1420,top:72,bottom:980};
  const left=clampFloatingLayout({...layout,x:24},area,minimum);
  const right=clampFloatingLayout({...layout,x:1400},area,minimum);
  expect(left.x).toBe(260);expect(right.x+right.width).toBe(1420);
  expect(left.floating).toBe(true);
 });
 it('clamps both dimensions when the workspace becomes narrower than minimum size',()=>{
  const result=clampFloatingLayout({...layout,x:1000,y:900,width:900,height:800},{width:390,height:844,left:16,right:374,top:80,bottom:620},minimum);
  expect(result.x).toBe(16);expect(result.width).toBe(358);
  expect(result.y).toBe(80);expect(result.height).toBe(540);
 });
 it('preserves the floating choice and recovered position in the existing preference key',()=>{
  const values=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)});
  writeFloatingLayout('plan',layout);
  expect(values.has(floatingLayoutKey('plan'))).toBe(true);
  expect(readFloatingLayout('plan',{...layout,x:800,floating:false},{width:1440,height:1000,top:72},minimum)).toEqual(layout);
 });
 it('retains legacy anchored preferences without inventing a floating placement',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({x:0,y:64,width:352,height:300,collapsed:false})});
  const result=readFloatingLayout('plan',{...layout,floating:false},{width:352,height:800,gutter:0,pinned:'left'},minimum);
  expect(result.x).toBe(0);expect(result.y).toBe(64);expect(result.floating).toBe(false);
 });
});
