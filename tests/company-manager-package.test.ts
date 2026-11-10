import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {MANAGER_PINS,MANAGER_NPM_ROOTS,REQUIRED_MANAGER_FILES,selectManagerNpmInputs,validateManagerArchive} from '../scripts/package-company-manager.ts';

const project=JSON.parse(readFileSync('package.json','utf8'));
function lock(){return {settings:{autoInstallPeers:true},overrides:project.pnpm.overrides,importers:{'.':{dependencies:Object.fromEntries(Object.entries(MANAGER_NPM_ROOTS).map(([name,version])=>[name,{specifier:version,version}]))}},packages:{retained:{integrity:'unchanged'}},snapshots:{retained:{dependencies:{}}}};}
describe('complete Linux company manager package',()=>{
 it('preserves the actual Gen engine/provider route and compatible platform pins',()=>{
  expect(MANAGER_PINS.node.version).toBe('24.22.2');expect(MANAGER_PINS.python.version).toBe('3.14.10');
  expect(MANAGER_PINS.hermesCommit).toBe('c627ec84664d43e0b18b95d9d86d8963747d56c7');
  expect(MANAGER_PINS.provider).toBe('openai-codex');expect(MANAGER_NPM_ROOTS['@earendil-works/pi-coding-agent']).toBe('1.4.0');
  expect(Object.keys(MANAGER_NPM_ROOTS)).not.toContain('@openai/codex');
 });
 it('keeps frozen dependency resolutions and overrides while excluding unrelated application dependencies',()=>{
  const original=lock(), before=structuredClone(original), selected=selectManagerNpmInputs(project,original);
  expect(selected.lock).toMatchObject({packages:original.packages,snapshots:original.snapshots});
  expect(selected.pkg.dependencies).toEqual(MANAGER_NPM_ROOTS);expect(selected.pkg.pnpm.overrides).toEqual(project.pnpm.overrides);
  expect(selected.pkg.dependencies).not.toHaveProperty('promptfoo');expect(selected.pkg.dependencies).not.toHaveProperty('electron');
  expect(original).toEqual(before);
 });
 it('rejects a root dependency/version or archive substitution',()=>{
  const changed=structuredClone(project);changed.dependencies['@earendil-works/pi-coding-agent']='1.5.0';
  expect(()=>selectManagerNpmInputs(changed,lock())).toThrow(/pin/);
  const missing=lock();delete missing.importers['.'].dependencies.tsx;
  expect(()=>selectManagerNpmInputs(project,missing)).toThrow(/lock/);
  expect(()=>validateManagerArchive('python',Buffer.from('replacement'))).toThrow(/checksum/);
 });
 it('requires the manager composition, original Python engine and subscription worker, not only the status host',()=>{
  for(const file of ['apps/server/company-manager-main.ts','apps/server/company-lifecycle.ts','apps/server/company-manager-host.ts','packages/company-manager/runtime.ts','packages/core/linux-path-guard.ts','packages/core/linux-path-guard.py','packages/runtime-hermes/worker.py','third-party/hermes-agent/upstream/run_agent.py','hermes-python/bin/python3.14','node_modules/tsx/dist/loader.mjs','node_modules/@earendil-works/pi-coding-agent/package.json'])expect(REQUIRED_MANAGER_FILES).toContain(file);
 });
});
