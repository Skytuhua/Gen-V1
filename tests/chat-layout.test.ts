import {describe,expect,it} from 'vitest';
import {chatBounds,clampChatRect} from '../packages/ui-shell/chat-layout';

const viewport={width:1440,height:900};
describe('floating rect geometry',()=>{
 it('clamps stale restored positions, sizes, and short viewports including the native titlebar',()=>{
  const view={width:768,height:420,top:62},area=chatBounds(view),rect=clampChatRect({x:5000,y:-80,width:2000,height:2000},view);
  expect(rect).toEqual({x:20,y:62,width:728,height:338});expect(rect.y+rect.height).toBe(area.bottom);
  expect(clampChatRect({x:700,y:200,width:400,height:500},{width:200,height:180})).toEqual({x:20,y:20,width:160,height:140});
 });
 it('keeps the margin at 20px but never exceeds an eighth of the viewport',()=>{
  expect(chatBounds({width:1440,height:900})).toEqual({left:20,top:20,right:1420,bottom:880});
  expect(chatBounds({width:120,height:900})).toEqual({left:15,top:15,right:105,bottom:885});
 });
 it('shrinks oversized rects to the viewport while preserving position clamps',()=>{
  const rect=clampChatRect({x:100,y:100,width:5000,height:5000},viewport);
  expect(rect.width).toBeLessThanOrEqual(1400);expect(rect.height).toBeLessThanOrEqual(860);
  expect(rect.x+rect.width).toBeLessThanOrEqual(1420);expect(rect.y+rect.height).toBeLessThanOrEqual(880);
 });
 it('enforces the 320x300 minimum unless the viewport itself is smaller',()=>{
  const rect=clampChatRect({x:20,y:20,width:40,height:40},viewport);
  expect(rect.width).toBe(320);expect(rect.height).toBe(300);
  const tiny=clampChatRect({x:0,y:0,width:40,height:40},{width:120,height:120});
  expect(tiny.width).toBe(90);expect(tiny.height).toBe(90);
 });
});
