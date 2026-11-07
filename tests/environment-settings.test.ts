import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EnvironmentSettings,environmentName} from '../packages/core/environment-settings.ts';
const roots:string[]=[];
const codec={protect:async(value:string)=>Buffer.from('encrypted:'+value).toString('base64'),unprotect:async(value:string)=>Buffer.from(value,'base64').toString().slice(10)};
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
describe('protected environment settings',()=>{
 it('rejects an oversized encrypted document before replacing the last readable revision',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gen-env-test-'));roots.push(root);await mkdir(join(root,'environment'));
  const entries=Array.from({length:32},(_,i)=>({scope:'device',name:'KEY_'+i,secret:true,stored:'x'.repeat(65000),updatedAt:new Date().toISOString()}));
  await writeFile(join(root,'environment','values.json'),JSON.stringify({version:1,revision:32,entries}));
  const settings=new EnvironmentSettings(root,{protect:async()=> 'y'.repeat(65536),unprotect:async()=>''});
  await expect(settings.save({scope:'device',name:'NEXT_KEY',value:'test-value',secret:true,baseRevision:32})).rejects.toThrow('limit');
  expect((await settings.read()).revision).toBe(32);
 });
 it('stores only protected values, returns metadata, and applies exact project overrides',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gen-env-test-'));roots.push(root);const settings=new EnvironmentSettings(root,codec);
  await settings.save({scope:'device',name:'EXAMPLE_API_KEY',value:'test-key',secret:true,baseRevision:0});
  const metadata=await settings.read();expect(JSON.stringify(metadata)).not.toContain('test-key');expect(metadata.revision).toBe(1);
  expect(await settings.resolve('project-a')).toEqual({EXAMPLE_API_KEY:'test-key'});
  expect(await readFile(join(root,'environment','values.json'),'utf8')).not.toContain('test-key');
  await settings.save({scope:'project:project-a',name:'EXAMPLE_API_KEY',value:'project-key',secret:true,baseRevision:1});
  expect(await settings.resolve('project-a')).toEqual({EXAMPLE_API_KEY:'project-key'});
  expect(await settings.resolve('project-b')).toEqual({EXAMPLE_API_KEY:'test-key'});
  await expect(settings.remove({scope:'device',name:'EXAMPLE_API_KEY',baseRevision:1})).rejects.toThrow('changed');
  await settings.remove({scope:'device',name:'EXAMPLE_API_KEY',baseRevision:2});
  expect(await settings.resolve('project-b')).toEqual({});
 });
 it.each(['PATH','HOME','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','PI_CODING_AGENT_DIR','HARNESS_DATA_DIR','__proto__','OPENAI_BASE_URL'])('rejects runtime and host authority override %s',name=>{expect(()=>environmentName.parse(name)).toThrow();});
 it('does not persist a failed protected write',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gen-env-test-'));roots.push(root);const settings=new EnvironmentSettings(root,{protect:async()=>{throw Error('vault unavailable');},unprotect:codec.unprotect});
  await expect(settings.save({scope:'device',name:'EXAMPLE_API_KEY',value:'test-key',secret:true,baseRevision:0})).rejects.toThrow();
  expect((await settings.read()).entries).toEqual([]);
 });
});
