import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HookSettings,hookSettingsFor} from '../packages/core/hook-settings.ts';
import {assertNotStorage} from '../packages/core/security.ts';
import {HarnessError} from '../packages/contracts/index.ts';

let dir:string;
const settings=()=>new HookSettings(dir);
const hook=(over:Record<string,unknown>={})=>({event:'PreToolUse',command:'echo hi',...over});


beforeEach(()=>{dir=realpathSync(mkdtempSync(join(tmpdir(),'hooks-')));});
afterEach(()=>{rmSync(dir,{recursive:true,force:true});});

describe('HookSettings',()=>{
 it('returns the default document when no file exists',async()=>{
  const doc=await settings().read();
  expect(doc).toEqual({version:1,revision:0,enabled:true,hooks:[]});
 });
 it('save/remove/setEnabled bump the revision',async()=>{
  const s=settings();
  const saved=await s.save({hook:hook(),baseRevision:0});
  expect(saved.revision).toBe(1);
  expect(saved.hooks).toHaveLength(1);
  expect(saved.hooks[0].id).toMatch(/^hook_[A-Za-z0-9]{8,32}$/);
  expect(saved.hooks[0].timeoutSeconds).toBe(30);
  expect(saved.hooks[0].onError).toBe('continue');
  const toggled=await s.setEnabled({enabled:false,baseRevision:1});
  expect(toggled).toMatchObject({revision:2,enabled:false});
  const removed=await s.remove({id:saved.hooks[0].id,baseRevision:2});
  expect(removed).toMatchObject({revision:3,hooks:[]});
 });
 it('replaces a hook by id and accepts a regex matcher',async()=>{
  const s=settings();
  const saved=await s.save({hook:hook({matcher:'operation_execute|repository_test_prepare'}),baseRevision:0});
  const id=saved.hooks[0].id;
  const edited=await s.save({hook:hook({id,name:'guard',timeoutSeconds:60}),baseRevision:1});
  expect(edited.hooks).toHaveLength(1);
  expect(edited.hooks[0]).toMatchObject({id,name:'guard',timeoutSeconds:60});
 });
 it('snapshot caches the parsed document and updates on mutation',async()=>{
  const s=settings();
  await s.save({hook:hook(),baseRevision:0});
  expect(s.snapshot().revision).toBe(1);
  expect(s.snapshot().hooks).toHaveLength(1);
  // A fresh instance reads the file and sees the persisted document.
  expect((await settings().read()).revision).toBe(1);
 });
 it('rejects a stale baseRevision on save, remove and setEnabled',async()=>{
  const s=settings();
  await s.save({hook:hook(),baseRevision:0});
  await expect(s.save({hook:hook(),baseRevision:0})).rejects.toMatchObject({code:'HOOKS_CHANGED'});
  await expect(s.remove({id:'hook_00000000',baseRevision:0})).rejects.toMatchObject({code:'HOOKS_CHANGED'});
  await expect(s.setEnabled({enabled:false,baseRevision:0})).rejects.toMatchObject({code:'HOOKS_CHANGED'});
  // The revision is still current afterwards.
  expect((await s.read()).revision).toBe(1);
 });
 it('rejects an invalid regex matcher',async()=>{
  await expect(settings().save({hook:hook({matcher:'([unclosed'}),baseRevision:0})).rejects.toMatchObject({code:'HOOKS_INVALID'});
 });
 for(const bad of [{timeoutSeconds:0},{timeoutSeconds:121}])
  it('rejects timeoutSeconds='+bad.timeoutSeconds,async()=>{
   await expect(settings().save({hook:hook(bad),baseRevision:0})).rejects.toThrow();
  });
 it('rejects a command containing NUL',async()=>{
  await expect(settings().save({hook:hook({command:'echo \0hi'}),baseRevision:0})).rejects.toThrow();
 });
 it('rejects a 51st hook',async()=>{
  const s=settings();let rev=0;
  for(let i=0;i<50;i++){rev=(await s.save({hook:hook(),baseRevision:rev})).revision;}
  await expect(s.save({hook:hook(),baseRevision:rev})).rejects.toThrow();
 });
 it('rejects unknown keys in the input',async()=>{
  await expect(settings().save({hook:hook({bogus:1}),baseRevision:0})).rejects.toThrow();
 });
 it('returns HOOKS_UNAVAILABLE for a symlinked or oversized file',async()=>{
  const s=settings(),file=join(dir,'hooks','hooks.json');
  await s.save({hook:hook(),baseRevision:0});
  rmSync(file);symlinkSync(join(dir,'outside.json'),file);
  await expect(s.read()).rejects.toMatchObject({code:'HOOKS_UNAVAILABLE'});
  rmSync(file);writeFileSync(file,' '.repeat(2*1024*1024+1));
  await expect(s.read()).rejects.toMatchObject({code:'HOOKS_UNAVAILABLE'});
 });
 it('protects the hooks storage directory from agent file tools',()=>{
  expect(()=>assertNotStorage(join(dir,'hooks','hooks.json'),dir)).toThrowError(HarnessError);
 });
 it('hookSettingsFor returns one instance per data dir',()=>{
  expect(hookSettingsFor(dir)).toBe(hookSettingsFor(dir));
  expect(hookSettingsFor(join(dir,'other'))).not.toBe(hookSettingsFor(dir));
 });
});
