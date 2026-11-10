import {describe,expect,it} from 'vitest';
import {CHAT_EDGES,CHAT_LAYOUT_KEY,CHAT_TRANSITION_MS,chatBounds,chatPanelRect,clampChatRect,isChatDockTarget,readChatLayout,resizeChatRect,writeChatLayout,type ChatLayout} from '../packages/ui-shell/chat-layout';

const viewport={width:1440,height:900},start={x:700,y:200,width:400,height:500};
describe('chat layout geometry',()=>{
 it('uses the measured no-bounce 300–400ms reference budget',()=>expect(CHAT_TRANSITION_MS).toBe(360));
 for(const width of [768,1024,1440,1920])it(`keeps default drawer and pop-up inside ${width}px`,()=>{
  const view={width,height:900};
  for(const mode of ['drawer','popup'] as const){
   const rect=chatPanelRect({mode,detached:mode==='popup'},view);
   expect(rect.x+rect.width).toBe(width-20);expect(rect.width).toBeGreaterThanOrEqual(320);expect(rect.y).toBeGreaterThanOrEqual(20);expect(rect.y+rect.height).toBeLessThanOrEqual(880);
  }
 });
 it('defaults to a third-width drawer and a bottom-right 350×500 pop-up',()=>{
  expect(chatPanelRect({mode:'drawer',detached:false},viewport)).toEqual({x:940,y:20,width:480,height:860});
  expect(chatPanelRect({mode:'popup',detached:true},viewport)).toEqual({x:1070,y:380,width:350,height:500});
 });
 for(const edge of CHAT_EDGES)it(`resizes ${edge} without moving the opposite edges, clamped at min and viewport`,()=>{
  for(const delta of [-10000,-40,40,10000]){
   const rect=resizeChatRect(start,edge,delta,delta,viewport);
   expect(rect.width).toBeGreaterThanOrEqual(320);expect(rect.height).toBeGreaterThanOrEqual(300);
   expect(rect.x).toBeGreaterThanOrEqual(20);expect(rect.y).toBeGreaterThanOrEqual(20);expect(rect.x+rect.width).toBeLessThanOrEqual(1420);expect(rect.y+rect.height).toBeLessThanOrEqual(880);
   if(edge.includes('w'))expect(rect.x+rect.width).toBe(start.x+start.width);else expect(rect.x).toBe(start.x);
   if(edge.includes('n'))expect(rect.y+rect.height).toBe(start.y+start.height);else expect(rect.y).toBe(start.y);
  }
 });
 it('clamps stale restored positions, sizes, and short viewports including the native titlebar',()=>{
  const view={width:768,height:420,top:62},area=chatBounds(view),rect=clampChatRect({x:5000,y:-80,width:2000,height:2000},view);
  expect(rect).toEqual({x:20,y:62,width:728,height:338});expect(rect.y+rect.height).toBe(area.bottom);
  expect(clampChatRect(start,{width:200,height:180})).toEqual({x:20,y:20,width:160,height:140});
 });
 it('accepts the right snap zone only within vertical viewport bounds',()=>{
  expect(isChatDockTarget(1400,450,viewport)).toBe(true);
  for(const [x,y] of [[1200,400],[1400,0],[1400,899],[1500,400]])expect(isChatDockTarget(x,y,viewport)).toBe(false);
 });
});
describe('chat preferences',()=>{
 it('remembers independent sizes, pop-up position, mode and detachment across reloads',()=>{
  const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const layout:ChatLayout={mode:'popup',detached:true,drawer:{...start,width:540},popup:{...start,width:360,height:460}};
  writeChatLayout(layout,storage);expect(values.has(CHAT_LAYOUT_KEY)).toBe(true);expect(readChatLayout(storage)).toEqual(layout);
  expect(chatPanelRect({...readChatLayout(storage),mode:'drawer'},viewport).width).toBe(540);
 });
 for(const raw of ['null','[]','{','{"mode":"other"}','x'.repeat(2049)])it(`recovers invalid preference ${raw.slice(0,20)}`,()=>expect(readChatLayout({getItem:()=>raw})).toEqual({mode:'full',detached:false}));
 it('rejects malformed geometry without throwing away a valid mode',()=>{
  expect(readChatLayout({getItem:()=>JSON.stringify({mode:'popup',popup:{x:10,y:20,width:-1,height:300},drawer:{x:10,y:'bad',width:400,height:500}})})).toEqual({mode:'popup',detached:true});
 });
 it('works with blocked or absent local storage',()=>{
  expect(readChatLayout()).toEqual({mode:'full',detached:false});
  expect(readChatLayout({getItem(){throw Error('blocked');}})).toEqual({mode:'full',detached:false});
  expect(()=>writeChatLayout({mode:'full',detached:false},{setItem(){throw Error('quota');}})).not.toThrow();
 });
});
