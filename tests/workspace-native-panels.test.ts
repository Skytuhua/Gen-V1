import {describe,expect,it,vi} from 'vitest';
import type {PanelPlacement} from '../packages/contracts/workspace.ts';
import type {DesktopBridge,DesktopWindowInfo} from '../packages/desktop-contract/index.ts';
import {desktopSurfaceKey} from '../packages/desktop-contract/index.ts';
import {desktopSurfaceKind,panelDesktopSurface,panelsForDesktopSurface,setPanelVisibility,detachPanelToNative} from '../apps/web/src/workspace-native.ts';

const panel=(id='origin'):PanelPlacement=>({id,kind:'thread',canvasId:'canvas',binding:{authority:{kind:'local'},threadId:'thread'},placement:'native',visible:true,collapsed:false,bounds:{x:24,y:56,width:480,height:600},order:0,alwaysOnTop:false});
const native=(value=panel()):DesktopWindowInfo=>({id:'native',surface:panelDesktopSurface(value),ready:true,minimized:false,visible:true});
describe('native panel ownership and visibility',()=>{
 it('retains the native editor when placement metadata fails after a successful detach',async()=>{
  const value={...panel(),placement:'canvas' as const},opened=native(value),detach=vi.fn(async()=>opened),persist=vi.fn(async()=>{throw Error('revision changed');});
  await expect(detachPanelToNative(value,detach,persist)).rejects.toThrow(/opened.*placement.*saved/i);
  expect(detach).toHaveBeenCalledExactlyOnceWith(panelDesktopSurface(value));
  expect(persist).toHaveBeenCalledExactlyOnceWith(value,{placement:'native',binding:value.binding});
  expect(value.placement).toBe('canvas');
 });
 it('does not publish native placement if the typed native detach fails',async()=>{
  const persist=vi.fn(async()=>{});
  await expect(detachPanelToNative(panel(),async()=>{throw Error('authority unavailable');},persist)).rejects.toThrow('authority unavailable');
  expect(persist).not.toHaveBeenCalled();
 });
 it('never maps a plug-in task into personal editor ownership',()=>{
  const task={kind:'plugin',pluginId:'example-plugin',scopeId:'alpha',surfaceId:'plan',resourceId:'order-alpha'} as const;
  expect(desktopSurfaceKind(task)).toBe('workspace');expect(panelsForDesktopSurface([panel()],task)).toEqual([]);
 });
 it('recovers all placements for one canonical editor without changing native identity',()=>{
  const a={...panel('a'),kind:'artifact' as const,binding:{authority:{kind:'local' as const},threadId:'thread',artifactId:'artifact'}},b={...a,id:'b'};
  expect(desktopSurfaceKey(panelDesktopSurface(a))).toBe(desktopSurfaceKey(panelDesktopSurface(b)));
  expect(panelsForDesktopSurface([a,b,panel()],{kind:'workspace',tab:'artifact',threadId:'thread',artifactId:'artifact'})).toEqual([a,b]);
  expect(panelsForDesktopSurface([{...a,binding:{...a.binding,authority:{kind:'plugin',pluginId:'example-plugin',scopeId:'scope'}}}],panelDesktopSurface(a))).toEqual([]);
 });
 it('updates the actual native owner before persisting visibility and rolls it back if persistence rejects',async()=>{
  const calls:unknown[]=[],control=vi.fn(async value=>{calls.push(value);}),update=vi.fn(async()=>{calls.push('host');throw Error('Host refused');}),value=panel();
  await expect(setPanelVisibility(value,false,update,{bridge:{control} as unknown as DesktopBridge,windows:[native()]})).rejects.toThrow('Host refused');
  expect(calls).toEqual([{type:'visibility',windowId:'native',visible:false},'host',{type:'visibility',windowId:'native',visible:true}]);
  expect(value.visible).toBe(true);
 });
 it('does not falsely persist visibility for missing native owners or native control failures',async()=>{
  const update=vi.fn(async()=>{}),control=vi.fn(async()=>{throw Error('Native refused');}),value=panel();
  await expect(setPanelVisibility(value,false,update,{bridge:{control} as unknown as DesktopBridge,windows:[]})).rejects.toThrow('unavailable');
  expect(control).not.toHaveBeenCalled();
  await expect(setPanelVisibility(value,false,update,{bridge:{control} as unknown as DesktopBridge,windows:[native()]})).rejects.toThrow('rollback also failed');
  expect(update).not.toHaveBeenCalled();expect(control).toHaveBeenCalledTimes(2);
 });
});
