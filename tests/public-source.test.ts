import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {publicSourceFiles,publicRuntimeSourceFiles,publicSourceAllowed,publicRuntimeSourceAllowed,assertPublicPackageFiles} from '../scripts/public-source.ts';

describe('reviewed public source allowlist',()=>{
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
