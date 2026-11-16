import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../packages/storage/store.ts';
import {Service} from '../packages/core/service.ts';
import type {RuntimeAdapter} from '../packages/contracts/index.ts';
import {mergeAccountModels} from '../apps/web/src/account-api.ts';

const personal='13b23643-8c4d-42ac-a5f5-d14823bc4441',other='13b23643-8c4d-42ac-a5f5-d14823bc4442';
const models=[{id:'openai/new',provider:'openai',name:'New Personal model'},{id:'cursor-sdk/kept',provider:'cursor-sdk',name:'Unrelated Cursor model'}];
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it.each([personal,null])('refreshes only the exact auth target, including legacy (%s)',async accountId=>{
  const root=await mkdtemp(join(tmpdir(),'account-model-refresh-')),store=new Store(root);
  const runtime:RuntimeAdapter={configure(){},models:vi.fn(async()=>models),start:async()=>{},followUp:async()=>{},cancel:async()=>{},compact:async()=>{},history:async()=>[],dispose:async()=>{}};
  const service=new Service(store,runtime);cleanup.push(async()=>{await service.dispose();store.close();await rm(root,{recursive:true,force:true});});
  store.internal('fixture',null,()=>{
    for(const [id,providerId]of [[personal,'openai'],[other,'cursor-sdk']])store.put('account',id,null,{id,providerId,label:id,enabled:true,createdAt:'2026-11-15',updatedAt:'2026-11-15'});
    store.put('settings','global',null,{theme:'dark',selectedAccounts:{openai:accountId,'cursor-sdk':other}});
  });
  expect(await service.models({refresh:true,target:{providerId:'openai',accountId}})).toEqual([models[0]]);
  expect(runtime.models).toHaveBeenCalledExactlyOnceWith({refresh:true,providerId:'openai',accountId});
});
it('replaces only the affected provider, preserving unrelated catalog objects and an explicit empty result',()=>{
  const kept=models[1],previous=[{id:'openai/old',provider:'openai',name:'Old'},kept];
  expect(mergeAccountModels(previous,[models[0]],{providerId:'openai',accountId:personal})).toEqual([kept,models[0]]);
  expect(mergeAccountModels(previous,[],{providerId:'openai',accountId:personal})).toEqual([kept]);
  expect(mergeAccountModels(previous,models)).toBe(models);
});
