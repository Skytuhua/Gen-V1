import {execFileSync} from 'node:child_process';
import {chmodSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';

it.skipIf(process.platform==='win32')('runs JavaScript build tasks with the same Node executable as the parent',()=>{
 const root=mkdtempSync(join(tmpdir(),'gen-build-node-'));
 try{
  mkdirSync(join(root,'scripts'));
  mkdirSync(join(root,'bin'));
  copyFileSync(new URL('../scripts/build.mjs',import.meta.url),join(root,'scripts','build.mjs'));
  for(const name of ['build-widgets','build-plugin-runtime']){
   writeFileSync(join(root,'scripts',name+'.mjs'),`import {writeFileSync} from 'node:fs';writeFileSync('${name}.node-path',process.execPath);`);
  }
  for(const [name,line] of [['node','exit 23'],['pnpm','exit 0']]){
   const file=join(root,'bin',name);
   writeFileSync(file,'#!/bin/sh\n'+line+'\n');
   chmodSync(file,0o755);
  }
  expect(()=>execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,env:{...process.env,PATH:join(root,'bin')},stdio:'pipe'})).not.toThrow();
  for(const name of ['build-widgets','build-plugin-runtime']){
   expect(readFileSync(join(root,name+'.node-path'),'utf8')).toBe(process.execPath);
  }
 }finally{
  rmSync(root,{recursive:true,force:true});
 }
});
