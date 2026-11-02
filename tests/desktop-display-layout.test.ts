import {describe,it,expect} from 'vitest';
import {clampDesktopBounds} from '../apps/desktop/window-policy.ts';
import {captureDesktopPlacement,restoreDesktopPlacement,placeOnDesktopDisplay,parseDesktopPlacement,retainDesktopPlacement,type DesktopDisplay} from '../apps/desktop/display-layout.ts';

const displays:DesktopDisplay[]=[{id:'primary',primary:true,workArea:{x:0,y:0,width:1920,height:1040},scaleFactor:1},{id:'left',workArea:{x:-1280,y:-100,width:1280,height:960},scaleFactor:1.5}];

describe('multi-display window placement',()=>{
 it('keeps a spanning window on the display containing most of it',()=>{
  const areas=[{x:0,y:0,width:1920,height:1040},{x:-1280,y:-100,width:1280,height:960}];
  expect(clampDesktopBounds({x:-150,y:100,width:1000,height:700},areas)).toEqual({x:0,y:100,width:1000,height:700});
 });
 it('opens a new detached view on the source monitor using DIP bounds at mixed scales',()=>{
  expect(restoreDesktopPlacement(undefined,displays,{width:430,height:720},{x:-1100,y:40,width:900,height:700})).toEqual({x:-855,y:20,width:430,height:720});
 });
 it('maps a saved relative position when a connected monitor changes its DIP work area',()=>{
  const preferred=captureDesktopPlacement({x:-1080,y:0,width:430,height:600},displays);
  const next=[displays[0],{id:'left',scaleFactor:2,workArea:{x:-1024,y:-50,width:1024,height:768}}];
  expect(restoreDesktopPlacement(preferred,next,{width:430,height:600})).toEqual({x:-884,y:-3,width:430,height:600});
 });
 it('rescues an unplugged monitor without overwriting its placement and restores on reconnect',()=>{
  const bounds={x:-1100,y:20,width:430,height:700},preferred=captureDesktopPlacement(bounds,displays),rescued=restoreDesktopPlacement(preferred,[displays[0]],{width:430,height:700});
  expect(rescued).toEqual({x:745,y:170,width:430,height:700});
  expect(retainDesktopPlacement(rescued,preferred,rescued,[displays[0]])).toEqual(preferred);
  expect(restoreDesktopPlacement(preferred,displays,{width:430,height:700})).toEqual(bounds);
 });
 it('respects a deliberate move after a monitor rescue instead of jumping back later',()=>{
  const preferred=captureDesktopPlacement({x:-1100,y:20,width:430,height:700},displays),rescued=restoreDesktopPlacement(preferred,[displays[0]],{width:430,height:700}),moved={...rescued,x:100};
  const next=retainDesktopPlacement(moved,preferred,rescued,[displays[0]]);
  expect(next.displayId).toBe('primary');expect(restoreDesktopPlacement(next,displays,{width:430,height:700})).toEqual(moved);
 });
 it('moves independently sized windows into a small target work area without physical pixel scaling',()=>{
  expect(placeOnDesktopDisplay({width:1000,height:740},{id:'small',scaleFactor:2,workArea:{x:1920,y:-400,width:800,height:600}})).toEqual({x:1920,y:-400,width:800,height:600});
 });
 it('accepts old records without display metadata and rejects malformed persisted geometry',()=>{
  expect(parseDesktopPlacement(undefined)).toBeUndefined();expect(parseDesktopPlacement({displayId:'left',bounds:{x:-1000,y:0,width:430,height:700},workArea:displays[1].workArea})).toMatchObject({displayId:'left'});
  for(const value of [{displayId:'left',bounds:{x:NaN,y:0,width:430,height:700},workArea:displays[1].workArea},{displayId:'left',bounds:{x:0,y:0,width:-1,height:700},workArea:displays[1].workArea},{displayId:[],bounds:{x:0,y:0,width:430,height:700},workArea:displays[1].workArea}])expect(parseDesktopPlacement(value)).toBeUndefined();
 });
});
