import {mkdtemp,rm,symlink,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,expect,it} from 'vitest';
import {hookSettingsFor,newHookId,HookSettings} from '../packages/core/hook-settings.ts';
import {assertNotStorage} from '../packages/core/security.ts';

const hook=(overrides:Record<string,unknown>={})=>({id:newHookId(),event:'PreToolUse',matcher:'',command:'echo hi',timeoutSeconds:30,onError:'continue',enabled:true,name:'',...overrides});
const setup=async()=>{const dir=await mkdtemp(join(tmpdir(),'gen-hooks-'));return{dir,settings:new HookSettings(dir),cleanup:()=>rm(dir,{recursive:true,force:true,maxRetries:3})};};

describe('HookSettings',()=>{
 it('returns an empty default document when no file exists',async()=>{
  const {settings,cleanup}=await setup();
  try{expect(await settings.read()).toEqual({version:1,revision:0,enabled:true,hooks:[]});}
  finally{await cleanup();}
 });
 it('saves, removes and toggles with revision bumps and cache invalidation',async()=>{
  const {settings,cleanup}=await setup();
  try{
   const one=hook();let doc=await settings.save({hook:one,baseRevision:0});expect(doc.revision).toBe(1);expect(doc.hooks).toHaveLength(1);
   expect((await settings.snapshot()).revision).toBe(1);
   doc=await settings.setEnabled({enabled:false,baseRevision:1});expect(doc.enabled).toBe(false);expect(doc.revision).toBe(2);
   expect((await settings.snapshot()).enabled).toBe(false);
   doc=await settings.remove({id:one.id,baseRevision:2});expect(doc.hooks).toHaveLength(0);expect((await settings.snapshot()).revision).toBe(3);
  }finally{await cleanup();}
 });
 it('accepts a regex matcher and rejects invalid input',async()=>{
  const {settings,cleanup}=await setup();
  try{
   const doc=await settings.save({hook:hook({matcher:'file_.*|repository_test_prepare'}),baseRevision:0});expect(doc.hooks[0].matcher).toContain('|');
   await expect(settings.save({hook:hook({matcher:'('}),baseRevision:1})).rejects.toMatchObject({code:'HOOK_INVALID'});
   await expect(settings.save({hook:hook({timeoutSeconds:0}),baseRevision:1})).rejects.toThrow();
   await expect(settings.save({hook:hook({timeoutSeconds:121}),baseRevision:1})).rejects.toThrow();
   await expect(settings.save({hook:hook({command:'a\0b'}),baseRevision:1})).rejects.toThrow();
   await expect(settings.save({hook:hook({unknownKey:1} as Record<string,unknown>),baseRevision:1})).rejects.toThrow();
  }finally{await cleanup();}
 });
 it('rejects a stale baseRevision and a 51st hook',async()=>{
  const {settings,cleanup}=await setup();
  try{
   await settings.save({hook:hook(),baseRevision:0});
   await expect(settings.save({hook:hook(),baseRevision:0})).rejects.toMatchObject({code:'HOOKS_CHANGED'});
   await expect(settings.remove({id:'hook_missing',baseRevision:0})).rejects.toMatchObject({code:'HOOKS_CHANGED'});
   let base=(await settings.read()).revision;
   for(let i=1;i<50;i++)base=(await settings.save({hook:hook(),baseRevision:base})).revision;
   await expect(settings.save({hook:hook(),baseRevision:base})).rejects.toMatchObject({code:'HOOK_LIMIT'});
  }finally{await cleanup();}
 });
 it('fails closed on a symlinked or invalid hooks file',async()=>{
  const {dir,settings,cleanup}=await setup();
  try{
   await mkdir(join(dir,'hooks'),{recursive:true});
   const real=join(dir,'hooks','real.json');await writeFile(real,'{"version":1,"revision":0,"enabled":true,"hooks":[]}');
   await symlink(real,join(dir,'hooks','hooks.json'));
   await expect(settings.read()).rejects.toMatchObject({code:'HOOKS_UNAVAILABLE'});
  }finally{await cleanup();}
 });
 it('keeps hooks.json inside protected storage',async()=>{
  const {dir,cleanup}=await setup();
  try{expect(()=>assertNotStorage(join(dir,'hooks','hooks.json'),dir)).toThrow();}
  finally{await cleanup();}
 });
 it('returns one singleton per data dir',async()=>{
  const {dir,cleanup}=await setup();
  try{expect(hookSettingsFor(dir)).toBe(hookSettingsFor(dir));}
  finally{await cleanup();}
 });
});
