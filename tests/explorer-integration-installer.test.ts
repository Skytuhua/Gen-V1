import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {desktopBuilderConfig,EXPLORER_INTEGRATION_NSH} from '../scripts/desktop-assets.ts';

// Fixed registration schema for the Explorer verbs. The in-app toggle service
// (T06) must mirror these literals through reg.exe — extend this test to parse
// the runtime service once it lands so the two cannot drift.
const NSH=resolve('scripts/installer',EXPLORER_INTEGRATION_NSH);
const source=readFileSync(NSH,'utf8');
const VERB_KEYS=['Software\\Classes\\Directory\\shell\\GenV1','Software\\Classes\\Directory\\Background\\shell\\GenV1'];

describe('Explorer integration NSIS include',()=>{
 it('resolves a staged absolute include path inside the builder stage',()=>{
  expect(EXPLORER_INTEGRATION_NSH).toBe('explorer-integration.nsh');
  expect(desktopBuilderConfig('C:/build').nsis.include).toBe('C:/build/desktop-installer/explorer-integration.nsh');
  expect(desktopBuilderConfig('D:\\out\\stage').nsis.include).toBe('D:/out/stage/desktop-installer/explorer-integration.nsh');
  expect(existsSync(NSH)).toBe(true);
 });
 it('defines both customInstall and customUnInstall hook macros',()=>{
  expect(source).toMatch(/!macro\s+customInstall\b/);
  expect(source).toMatch(/!macro\s+customUnInstall\b/);
 });
 it('registers both verbs with the fixed label, single-select model, icon and quoted command',()=>{
  for(const key of VERB_KEYS){
   expect(source).toContain(`WriteRegStr HKCU "${key}" "" "Open in Gen V1"`);
   expect(source).toContain(`WriteRegStr HKCU "${key}" "MultiSelectModel" "Single"`);
   expect(source).toContain(`WriteRegStr HKCU "${key}\\DefaultIcon" "" '"$INSTDIR\\Gen V1.exe",0'`);
   expect(source).toContain(`WriteRegStr HKCU "${key}\\command" "" '"$INSTDIR\\Gen V1.exe" --open-project "%V"'`);
  }
  expect((source.match(/WriteRegStr HKCU/g)??[]).length).toBe(8);
 });
 it('honours the ExplorerIntegration DWORD opt-out marker under HKCU\\Software\\Gen V1',()=>{
  expect(source).toContain('ReadRegDWORD $R0 HKCU "Software\\Gen V1" "ExplorerIntegration"');
  expect(source).toMatch(/\$\{elseif\}\s+\$R0 != 0/);
  expect(source).not.toMatch(/WriteRegDWORD/);
 });
 it('preserves the marker on upgrade but deletes it and both owned keys on explicit uninstall',()=>{
  const uninstall=source.slice(source.indexOf('!macro customUnInstall'));
  for(const key of VERB_KEYS)expect(uninstall).toContain(`DeleteRegKey HKCU "${key}"`);
  expect(uninstall).toMatch(/\$\{ifNot\}\s+\$\{isUpdated\}[\s\S]*?DeleteRegValue HKCU "Software\\Gen V1" "ExplorerIntegration"/);
  expect(uninstall).not.toContain('DeleteRegKey HKCU "Software\\Gen V1"');
  expect(uninstall).not.toContain('DeleteRegKey HKCU "Software\\Classes"');
 });
 it('stays per-user: no HKLM, elevation, signing or machine-wide registration',()=>{
  for(const forbidden of ['HKLM','HKEY_LOCAL_MACHINE','RequestExecutionLevel','SetShellVarContext all','SHCTX','admin','signtool'])expect(source).not.toContain(forbidden);
 });
});
