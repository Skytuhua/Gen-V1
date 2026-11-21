import {describe,expect,it} from 'vitest';
import {searchSettings,buildSupportedSettings,type SupportedSettingRow} from '../apps/web/src/settings-registry';
import {SETTINGS_ROWS,SETTINGS_SECTIONS} from '../apps/web/src/Settings';

const rows=buildSupportedSettings(SETTINGS_ROWS,SETTINGS_SECTIONS);
const ids=(query:string,platform:'browser'|'desktop'='desktop')=>searchSettings(query,rows,platform).map(row=>row.id);

describe('settings registry search (T06)',()=>{
 it('returns no results for an empty or whitespace query',()=>{
  expect(searchSettings('',rows,'desktop')).toEqual([]);
  expect(searchSettings('   ',rows,'desktop')).toEqual([]);
 });
 it('finds accounts, project colors and prompt font as actual targets',()=>{
  expect(ids('accounts')).toContain('harness-accounts');
  expect(ids('project colors')).toContain('harness-project-colors');
  expect(ids('prompt font')).toContain('harness-personalization');
 });
 it('requires every token to match (AND semantics)',()=>{
  expect(ids('diff layout')).toContain('diff-layout');
  expect(ids('diff nonexistenttoken')).toEqual([]);
 });
 it('shows one truthful empty state for an unknown phrase',()=>{
  expect(ids('zzz-not-a-setting')).toEqual([]);
 });
 it('matches the section label like the rendered search',()=>{
  expect(ids('keyboard')).toContain('harness-keybinding-search');
 });
 it('scopes rows by platform',()=>{
  const scoped:SupportedSettingRow[]=[
   {id:'all-row',title:'Everywhere',section:'general',terms:'',group:'Basics',targetId:'all-row',platform:'all',sectionLabel:'General'},
   {id:'desktop-row',title:'Native only',section:'general',terms:'',group:'Basics',targetId:'desktop-row',platform:'desktop',sectionLabel:'General'},
   {id:'browser-row',title:'Web only',section:'general',terms:'',group:'Basics',targetId:'browser-row',platform:'browser',sectionLabel:'General'},
  ];
  expect(searchSettings('only',scoped,'desktop').map(r=>r.id)).toEqual(['desktop-row']);
  expect(searchSettings('only',scoped,'browser').map(r=>r.id)).toEqual(['browser-row']);
  expect(searchSettings('everywhere',scoped,'browser').map(r=>r.id)).toEqual(['all-row']);
 });
 it('gives every supported row a stable target and group',()=>{
  for(const row of rows){expect(row.targetId).toBeTruthy();expect(row.group).toBeTruthy();expect(['all','desktop','browser']).toContain(row.platform);}
 });
});

describe('keep-awake rows',()=>{
 it('are registered in the general section and scoped to the desktop platform',()=>{
  const tasks=rows.find(row=>row.id==='keep-awake-tasks'),schedules=rows.find(row=>row.id==='keep-awake-schedules');
  expect(tasks).toMatchObject({section:'general',platform:'desktop',targetId:'keep-awake-tasks'});
  expect(schedules).toMatchObject({section:'general',platform:'desktop',targetId:'keep-awake-schedules'});
  expect(ids('keep the PC awake','desktop')).toEqual(expect.arrayContaining(['keep-awake-tasks','keep-awake-schedules']));
  expect(ids('keep the PC awake','browser')).toEqual([]);
 });
});
