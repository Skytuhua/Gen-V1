import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HermesClient} from '../packages/runtime-hermes/client.ts';
import * as homeGuard from '../packages/runtime-hermes/home.ts';
import * as processTree from '../packages/runtime-pi/process-tree.ts';

const python={executable:process.execPath,args:[resolve('tests/fixtures/hermes-protocol-worker.mjs')]};
async function fixture(){
 const home=await mkdtemp(join(tmpdir(),'hermes-client-startup-'));
 return{home,client:new HermesClient({home,python})};
}

it('disposes after home admission fails before lending custody to the worker',async()=>{
 const root=await mkdtemp(join(tmpdir(),'hermes-client-denied-')),parent=join(root,'ordinary-file');
 await writeFile(parent,'retained');
 const client=new HermesClient({home:join(parent,'home'),python});let startupError:unknown;
 try{
  startupError=await client.request('echo',{}).catch(error=>error);
  expect(startupError).toMatchObject({code:'CAPABILITY_DENIED'});
  await expect(client.dispose()).resolves.toBeUndefined();
  await expect(client.dispose()).resolves.toBeUndefined();
  expect(await readFile(parent,'utf8')).toBe('retained');
  await expect(client.request('echo',{})).rejects.toMatchObject({code:'HERMES_CLOSED'});
 }finally{
  await client.dispose().catch(error=>{if(error!==startupError)throw error;});
  await rm(root,{recursive:true,force:true});
 }
});

// These scripted guard callbacks exercise client ownership, not kernel custody.
// The worker and process-tree shutdown remain real wherever a worker is started.
it('retains an acquired namespace guard release failure',async()=>{
 const failure=new Error('Synthetic acquired guard release failure');
 const guard=vi.spyOn(homeGuard,'withHermesHome').mockImplementationOnce(async(_home,action)=>{await action();throw failure;});
 const {home,client}=await fixture();
 try{
  expect(await client.request('echo',{ready:true})).toEqual({ready:true});
  await expect(client.dispose()).rejects.toBe(failure);
  await expect(client.dispose()).rejects.toBe(failure);
 }finally{
  await client.dispose().catch(error=>{if(error!==failure)throw error;});guard.mockRestore();
  await rm(home,{recursive:true,force:true});
 }
});

it('retains an acquired guard failure when startup is revoked before worker creation',async()=>{
 const failure=new Error('Synthetic acquired guard loss before spawn');
 const guard=vi.spyOn(homeGuard,'withHermesHome').mockImplementationOnce(async(_home,action,onLoss)=>{
  const held=action();onLoss!();await held;throw failure;
 });
 const {home,client}=await fixture();
 try{
  await expect(client.request('echo',{})).rejects.toMatchObject({code:'HERMES_CLOSED'});
  await expect(client.dispose()).rejects.toBe(failure);
 }finally{
  await client.dispose().catch(error=>{if(error!==failure)throw error;});guard.mockRestore();
  await rm(home,{recursive:true,force:true});
 }
});

it('keeps acquired guard custody when descendant cancellation is unconfirmed',async()=>{
 let released=false;
 const guard=vi.spyOn(homeGuard,'withHermesHome').mockImplementationOnce(async(_home,action)=>{try{return await action();}finally{released=true;}});
 const failure=new Error('Synthetic unconfirmed descendant cancellation');
 const termination=vi.spyOn(processTree,'terminateProcessTree').mockRejectedValueOnce(failure);
 const {home,client}=await fixture();
 try{
  expect(await client.request('echo',{ready:true})).toEqual({ready:true});
  const stopped=await client.dispose().catch(error=>error);
  expect(stopped).toBeInstanceOf(AggregateError);expect(stopped.errors).toEqual([failure]);
  expect(released).toBe(false);
  await expect(client.dispose()).resolves.toBeUndefined();expect(released).toBe(true);
 }finally{
  termination.mockRestore();await client.dispose();guard.mockRestore();
  await rm(home,{recursive:true,force:true});
 }
});
