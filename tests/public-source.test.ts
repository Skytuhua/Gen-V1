import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {publicSourceFiles,publicRuntimeSourceFiles,publicSourceAllowed,publicRuntimeSourceAllowed,assertPublicPackageFiles} from '../scripts/public-source.ts';
import {runtimeSourceAllowed} from '../scripts/desktop-assets.ts';

describe('reviewed public source allowlist',()=>{
  it('preserves pinned integration bytes when Windows enables automatic CRLF checkout',async()=>{
    const root=await mkdtemp(join(tmpdir(),'harness-public-byte-checkout-'));
    const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
    const git=(...args:string[])=>execFileSync('git',['-c','core.autocrlf=true','-c','core.hooksPath='+join(root,'disabled-hooks'),'-C',root,...args],{env,windowsHide:true});
    const path='third-party/integrations/graphify/LICENSE',original=readFileSync(new URL('../'+path,import.meta.url));
    try{
      git('init','--quiet');await mkdir(join(root,'third-party/integrations/graphify'),{recursive:true});
      await writeFile(join(root,'.gitattributes'),readFileSync(new URL('../.gitattributes',import.meta.url)));
      await writeFile(join(root,path),original);git('add','--','.gitattributes',path);
      const output=join(root,'checked-out');await mkdir(output);
      git('checkout-index','--all','--prefix='+output.replaceAll('\\','/')+'/');
      expect((await readFile(join(output,path))).equals(original)).toBe(true);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('normalizes Windows separators while rejecting traversal, aliases and absolute paths',()=>{
    expect(publicRuntimeSourceAllowed('apps\\server\\main.ts')).toBe(true);
    for(const path of ['../apps/server/main.ts','apps/server/../server/main.ts','./apps/server/main.ts','apps//server/main.ts','/apps/server/main.ts','C:/apps/server/main.ts','apps/server/main.ts:stream','apps/server/%2e%2e/main.ts'])expect(publicSourceAllowed(path),path).toBe(false);
  });
  it('preserves the current personal runtime and guarded host inputs by exact name',()=>{
    for(const path of ['apps/server/main.ts','apps/server/desktop-controls.ts','apps/server/plugin-routes.ts','packages/runtime-hermes/task-pool.ts','packages/integrations/index.ts','packages/core/linux-path-guard.ts','packages/core/linux-path-guard.py','packages/core/windows-path-guard.ps1','packages/capabilities/sqlite-worker.mjs','packages/runtime-hermes/worker.py','packages/plugins/host.ts'])expect(publicRuntimeSourceAllowed(path),path).toBe(true);
    expect(publicSourceAllowed('apps/web/src/App.tsx')).toBe(true);
    expect(publicRuntimeSourceAllowed('apps/web/src/App.tsx')).toBe(false);
  });
  it('excludes private implementation, fixtures, plans, state, credentials and unknown additions',()=>{
    for(const path of ['apps/server/company-main.ts','apps/desktop/company-task-policy.ts','apps/web/src/company/ManagerPanel.tsx','packages/company-client/index.ts','packages/company-contracts/company-manager.v1.json','packages/company-manager/runtime.ts','scripts/package-company-host.ts','scripts/company-host/start-owner.ps1','tests/company-client.test.ts','tests/desktop-company-task.test.ts','tests/company/fixture.key','tests/e2e/company-manager.spec.ts','docs/superpowers/plans/2026-11-04-gen-plugin-execution.md','.gen-main/state.sqlite','userdata/secrets/owner.token','.env','packages/core/unreviewed-new-module.ts']){
      expect(publicSourceAllowed(path),path).toBe(false);expect(publicRuntimeSourceAllowed(path),path).toBe(false);
    }
  });
  it('resolves the staged host and worker entries using only admitted runtime sources',async()=>{
    const root=await mkdtemp(join(tmpdir(),'harness-public-runtime-'));
    try{
      for(const path of publicSourceFiles){
        if(!/^(?:packages|apps\/server)\//.test(path)||!runtimeSourceAllowed(path))continue;
        const destination=join(root,path);await mkdir(dirname(destination),{recursive:true});
        await copyFile(new URL('../'+path,import.meta.url),destination);
      }
      await build({absWorkingDir:root,entryPoints:['apps/server/main.ts','packages/runtime-login/index.ts','packages/runtime-pi/worker.ts','packages/runtime-official/cursor-worker.ts','packages/runtime-hermes/acp-server.ts'],outdir:'build',bundle:true,packages:'external',platform:'node',target:'node24',format:'esm',write:false,logLevel:'silent'});
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('resolves the staged browser entry using only admitted public sources',async()=>{
    const root=await mkdtemp(join(tmpdir(),'harness-public-browser-'));
    try{
      for(const path of publicSourceFiles){
        if((path!=='package.json'&&!/^(?:apps\/web|packages|third-party\/vespin)\//.test(path))||!publicSourceAllowed(path))continue;
        const destination=join(root,path);await mkdir(dirname(destination),{recursive:true});
        await copyFile(new URL('../'+path,import.meta.url),destination);
      }
      await build({absWorkingDir:root,entryPoints:['apps/web/src/main.tsx'],outdir:'build',bundle:true,packages:'external',platform:'browser',target:'es2022',format:'esm',jsx:'automatic',loader:{'.svg':'file','.png':'file','.jpg':'file','.woff2':'file'},write:false,logLevel:'silent'});
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('admits only enumerated inputs and rejects an unexpected payload source',()=>{
    expect(()=>assertPublicPackageFiles(publicRuntimeSourceFiles)).not.toThrow();
    expect(()=>assertPublicPackageFiles(publicSourceFiles,'source')).not.toThrow();
    expect(()=>assertPublicPackageFiles(['apps/server/main.ts','packages/core/new-unreviewed.ts'])).toThrow(/not in the reviewed public runtime allowlist/);
    expect(()=>assertPublicPackageFiles(['apps/web/src/App.tsx'])).toThrow();
  });
  it('keeps a unique, sorted manifest and a runtime subset rather than source globs',()=>{
    const manifest=JSON.parse(readFileSync(new URL('../scripts/public-source-files.json',import.meta.url),'utf8')) as {version:number;source:string[];runtime:string[]};
    expect(manifest.version).toBe(1);expect(publicSourceFiles).toEqual([...new Set(manifest.source)].sort());
    expect(publicRuntimeSourceFiles).toEqual([...new Set(manifest.runtime)].sort());
    expect(publicRuntimeSourceFiles.every(path=>publicSourceAllowed(path))).toBe(true);
    expect(publicSourceFiles.some(path=>/[?*]/.test(path))).toBe(false);
  });
});
