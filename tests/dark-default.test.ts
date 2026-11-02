import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store';
import type {Snapshot} from '../packages/contracts';

const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
function fixture(){
 const prefix=join(tmpdir(),'harness-dark-default-'),folder=mkdtempSync(prefix);if(!folder.startsWith(prefix))throw new Error('Unexpected temporary store path');let store=new Store(folder);
 cleanups.push(()=>{store.close();rmSync(folder,{recursive:true,force:true});});
 return {get store(){return store;},reopen(){store.close();store=new Store(folder);return store;}};
}
describe('dark theme defaults',()=>{
 it('starts a fresh profile in dark without inventing a stored preference',()=>{
  const {store}=fixture();expect(store.snapshot().settings).toEqual({theme:'dark',modelId:null});expect(store.get('settings','global')).toBeNull();
 });
 for(const theme of ['light','system']as const)it(`retains an explicit ${theme} profile and its other settings after reopening`,()=>{
  const fixtureState=fixture(),settings:Snapshot['settings']={theme,modelId:'test/saved-model',preferences:{chatWidth:'full'}};
  fixtureState.store.command({id:'saved-settings',type:'settings.update',payload:settings},()=>fixtureState.store.put('settings','global',null,settings));
  expect(fixtureState.reopen().snapshot().settings).toEqual(settings);
 });
});
