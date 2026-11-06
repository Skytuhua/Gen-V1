import {describe,expect,it} from 'vitest';
import {acquireLinuxCredentialReadBarrier,validateLinuxCredentialPath,validateLinuxDirectoryPaths} from '../packages/core/linux-path-guard.ts';

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

describe('Linux credential read barriers',()=>{
 const root='/private/state',parent=root+'/accounts/provider-auth-'+'a'.repeat(64)+'/pi';
 it.each([20001,300000])('honors pre-acquisition cancellation for a bounded operation hold of %sms',async maxHoldMs=>{
  const cancel=new AbortController(),reason=new Error('Synthetic operation already cancelled');cancel.abort(reason);
  await expect(acquireLinuxCredentialReadBarrier(parent+'/auth.json',{signal:cancel.signal,maxHoldMs})).rejects.toBe(reason);
 });
 it('admits only a named account native Pi credential path',()=>{
  expect(validateLinuxCredentialPath(parent+'/auth.json',root)).toBe(parent);
 });
 it.each([root+'/pi/auth.json',parent+'/other.json',parent+'/../pi/auth.json',root+'/accounts/provider-auth-short/pi/auth.json','/outside/auth.json'])('rejects unsupported credential storage: %s',path=>{
  expect(()=>validateLinuxCredentialPath(path,root)).toThrow();
 });
 it('requires the real inherited Linux guardian before accepting a barrier',async()=>{
  await expect(acquireLinuxCredentialReadBarrier(parent+'/auth.json',{signal:new AbortController().signal,maxHoldMs:1000})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 });
});
