import {describe,expect,it} from 'vitest';
import {validateLinuxDirectoryPaths} from '../packages/core/linux-path-guard.ts';

describe('Linux private directory guards',()=>{
 it('accepts the original Hermes/account directory form inside the kernel-owned profile',()=>{
  const paths=[{path:'/private/state/home',leaf:false,allowChildWrites:true,childWriteRoot:'/private/state'}];
  expect(validateLinuxDirectoryPaths(paths,'/private/state')).toEqual(paths);
 });
 it.each([
  {path:'/outside',leaf:false},
  {path:'/private/state/../outside',leaf:false},
  {path:'/private/state/file',leaf:true},
  {path:'/private/state/home',leaf:false,tree:true},
  {path:'/private/state/home',leaf:false,readOnly:true},
  {path:'/private/state/home',leaf:false,allowChildWrites:true,childWriteRoot:'/outside'},
  {path:'/private/state/home',leaf:false,dev:'not-an-identity'},
 ])('denies unsupported or out-of-custody requests before touching the broker: %j',path=>{
  expect(()=>validateLinuxDirectoryPaths([path],'/private/state')).toThrow();
 });
});
