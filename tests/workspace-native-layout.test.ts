import {describe,expect,it} from 'vitest';
import * as contract from '../packages/desktop-contract/index.ts';

const main={surface:{kind:'main'},bounds:{x:-900,y:40,width:800,height:700},visible:true,alwaysOnTop:false};
const parse=(value:unknown)=>(contract as unknown as {parseDesktopLayout:(input:unknown)=>unknown}).parseDesktopLayout(value);
describe('saved native workspace layouts',()=>{
 it('strictly preserves native monitor coordinates, visibility and pinned state',()=>{
  const layout={version:1,windows:[main,{...main,surface:{kind:'workspace',threadId:'task-a',panelId:'files-a',tab:'files'},visible:false,alwaysOnTop:true,displayId:'secondary'}]};
  expect(parse(layout)).toEqual(layout);
 });
 it('rejects unknown keys, duplicate editor custody, missing main and over-capacity layouts',()=>{
  for(const value of [{version:1,windows:[]},{version:1,windows:[main,main]},{version:1,windows:[{...main,token:'secret'}]},{version:1,windows:[{...main,bounds:{...main.bounds,x:Infinity}}]},{version:1,windows:[main],credentials:{}},{version:1,windows:[{...main,surface:{kind:'thread',threadId:'t'}}]},{version:1,windows:[main,...Array.from({length:24},(_,index)=>({...main,surface:{kind:'plan',threadId:'t'+index}}))]}])expect(()=>parse(value)).toThrow();
  expect(()=>parse({version:1,windows:[main,{...main,surface:{kind:'artifact',threadId:'t',artifactId:'a'}},{...main,surface:{kind:'workspace',threadId:'t',tab:'artifact',artifactId:'a'}}]})).toThrow();
 });
 it('distinguishes tool instances while retaining canonical artifact identity',()=>{
  expect(contract.desktopSurfaceKey({kind:'workspace',threadId:'t',tab:'files',panelId:'one'} as never)).not.toBe(contract.desktopSurfaceKey({kind:'workspace',threadId:'t',tab:'files',panelId:'two'} as never));
  expect(contract.desktopSurfaceKey({kind:'workspace',threadId:'t',tab:'artifact',artifactId:'a',panelId:'one'} as never)).toBe(contract.desktopSurfaceKey({kind:'artifact',threadId:'t',artifactId:'a'}));
 });
 it('retains one actual docked browser owner and rejects duplicate browser custody',()=>{
  const layout={version:1,windows:[{...main,dockedBrowserId:'browser-one'}]};expect(parse(layout)).toEqual(layout);
  expect(()=>parse({version:1,windows:[{...main,dockedBrowserId:'browser-one'},{...main,surface:{kind:'browser',browserId:'browser-one'}}]})).toThrow();
  expect(()=>parse({version:1,windows:[main,{...main,surface:{kind:'plan',threadId:'task'},dockedBrowserId:'browser-one'}]})).toThrow();
 });
 it('admits only exact visibility and pin commands for a named native window',()=>{
  expect(contract.parseDesktopWindowControl({windowId:'main',type:'visibility',visible:false})).toEqual({windowId:'main',type:'visibility',visible:false});
  expect(contract.parseDesktopWindowControl({windowId:'main',type:'always-on-top',enabled:true})).toEqual({windowId:'main',type:'always-on-top',enabled:true});
  for(const value of [{windowId:'main',type:'visibility',visible:'false'},{windowId:'main',type:'visibility',visible:false,enabled:true},{windowId:'main',type:'always-on-top',enabled:true,stop:true},{windowId:'',type:'visibility',visible:false},{windowId:'main',type:'stop'}])expect(()=>contract.parseDesktopWindowControl(value)).toThrow();
 });
});
