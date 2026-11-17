import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../packages/storage/store';
import {SourceWorkbench} from '../packages/core/source-workbench';
import {__setCapabilityFlagForTests} from '../packages/core/capability-flags';
import {activityOutputRows} from '../apps/web/src/activity-output';
it.each([['first\nsecond'],['first\nsecond\n'],['first\n','next\n'],['first','']])('uses identical host and production presentation row identities for %j',(...contents:string[])=>{
 const directory=mkdtempSync(join(tmpdir(),'m15-output-contract-')),store=new Store(join(directory,'data'));
 try{
  __setCapabilityFlagForTests('ui.sourceWorkbenchV1',true);
  const owner={threadId:'task',projectId:null,workspaceId:null},messages=contents.map((content,index)=>({id:`message-${index}`,content}));
  store.internal('fixture',owner.threadId,()=>{store.put('thread',owner.threadId,owner.threadId,{id:owner.threadId,status:'ready',epoch:0,runId:null});for(const message of messages)store.put('message',message.id,owner.threadId,{...message,threadId:owner.threadId,role:'activity'});});
  const host=new SourceWorkbench(store).readOutput({logicalOwner:owner,messageIds:messages.map(message=>message.id),sourceRevision:createHash('sha256').update(JSON.stringify(messages)).digest('hex')});
  expect(activityOutputRows(messages)).toEqual(host.rows);
  expect(host.rows.map(row=>row.text).join('\n')+(host.trailingNewline?'\n':'')).toBe(contents.join('\n'));
 }finally{__setCapabilityFlagForTests('ui.sourceWorkbenchV1',undefined);store.close();rmSync(directory,{recursive:true,force:true});}
});
