import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {link,mkdtemp,rm,utimes,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inlineJson} from '../packages/integrations/inline-json.ts';
import {Context7SecretReferences,observeContext7Executable} from '../packages/integrations/context7-secret-reference.ts';
import {captureContext7Binding,withContext7Binding,type Context7LaunchDescriptor} from '../packages/integrations/context7-execution.ts';
import {ordinaryFile,payloadPath,readManifest,verifyDefinition} from '../packages/integrations/manifest.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const dir=async()=>{const root=await mkdtemp(join(tmpdir(),'harness-context7-unit-'));roots.push(root);return root;};
const file=async(root:string,name:string,body='bytes')=>{const path=join(root,name);await writeFile(path,body);return path;};
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

describe('inlineJson',()=>{
 it('copies plain JSON values deeply',()=>{
  const input={a:[1,'x',null,true,{b:2}]};
  const output=inlineJson(input) as typeof input;
  expect(output).toEqual(input);
  expect(output.a).not.toBe(input.a);
 });
 it('rejects non-finite numbers, undefined, functions and class instances',()=>{
  for(const value of [Number.NaN,Number.POSITIVE_INFINITY,undefined,()=>1,new Date(),new Map()])expect(()=>inlineJson(value)).toThrow('inline JSON values');
  expect(()=>inlineJson({ok:Number.NaN})).toThrow('inline JSON values');
 });
 it('rejects file: and package: loader strings case-insensitively, allowing lookalikes',()=>{
  for(const value of ['file:/etc/passwd','  FILE:c:\\x','package:foo','\tpackage:x'])expect(()=>inlineJson(value)).toThrow('external loaders');
  for(const value of ['profile:a','a file:x','pkg:x'])expect(inlineJson(value)).toBe(value);
 });
 it('rejects oversized strings, deep nesting, wide graphs and oversized results',()=>{
  expect(()=>inlineJson('x'.repeat(128*1024+1))).toThrow('external loaders');
  let deep:unknown={v:1};for(let i=0;i<21;i++)deep=[deep];
  expect(()=>inlineJson(deep)).toThrow('exceeds its bound');
  expect(()=>inlineJson(Array.from({length:10001},()=>0))).toThrow('exceeds its bound');
  const wide:{[k:string]:string}={};for(let i=0;i<9;i++)wide['k'+i]='x'.repeat(120*1024);
  expect(()=>inlineJson(wide)).toThrow('exceeds its bound');
 });
});

describe('observeContext7Executable',()=>{
 it('reports canonical path, identity and sha256 of a real file',async()=>{
  const root=await dir(),path=await file(root,'tool.exe','launcher-bytes');
  const seen=await observeContext7Executable(path);
  expect(seen.sha256).toBe(sha('launcher-bytes'));
  expect(seen.size).toBe('14');
  expect(seen.path).not.toBe('');
  expect(seen.dev).toMatch(/^\d+$/);expect(seen.ino).toMatch(/^\d+$/);
 });
 it('rejects second hard links and post-observation identity changes',async()=>{
  const root=await dir(),path=await file(root,'tool.exe','v1');
  await link(path,join(root,'alias.exe'));
  await expect(observeContext7Executable(path)).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
 });
});

describe('Context7SecretReferences',()=>{
 const refs=(enabled=true,executable='x',resolver:()=>string|undefined=()=>'secret-value')=>new Context7SecretReferences(enabled,executable,resolver);
 it('returns no references while disabled or unconfigured, then one process-env reference',async()=>{
  const root=await dir(),exe=await file(root,'tool.exe','bin');
  const off=refs(true,exe);expect((await off.status()).references).toHaveLength(0);
  off.configure(true);
  const status=await off.status();
  expect(status.references).toHaveLength(1);
  expect(status.references[0]).toMatchObject({owner:'personal/context7',revoked:false,destination:{kind:'process-env',envName:'CONTEXT7_API_KEY',executableSha256:sha('bin')}});
  const disabled=refs(false,exe);disabled.configure(true);
  expect((await disabled.status()).references).toHaveLength(0);
 });
 it('capture() returns the current reference and executable; resolveApproved delivers the resolver value once',async()=>{
  const root=await dir(),exe=await file(root,'tool.exe','bin');
  const reference=refs(true,exe,()=>'ctx-key-1');reference.configure(true);
  const {reference:ref,executable}=await reference.capture();
  await expect(reference.resolveApproved(ref,executable,'op-1')).resolves.toBe('ctx-key-1');
 });
 it('resolveApproved rejects stale references and a missing resolver value',async()=>{
  const root=await dir(),exe=await file(root,'tool.exe','bin');
  const stale=refs(true,exe);stale.configure(true);
  const {reference:ref,executable}=await stale.capture();
  await expect(stale.resolveApproved({...ref,refId:'context7.nope'},executable,'op-1')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  await expect(stale.resolveApproved(ref,{...executable,sha256:sha('other')},'op-1')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  const none=refs(true,exe,()=>undefined);none.configure(true);
  const current=await none.capture();
  await expect(none.resolveApproved(current.reference,current.executable,'op-1')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
 });
 it('reissues a new refId after executable change and revokes the old one',async()=>{
  const root=await dir(),exe=await file(root,'tool.exe','v1');
  const reference=refs(true,exe,()=>'k');reference.configure(true);
  const first=(await reference.capture()).reference;
  await utimes(exe,new Date(),new Date(Date.now()+5000));
  const second=(await reference.capture()).reference;
  expect(second.refId).not.toBe(first.refId);
  await expect(reference.resolveApproved(first,(await reference.capture()).executable,'op-1')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
 });
 it('invalidate() blocks resolution until configure() runs again',async()=>{
  const root=await dir(),exe=await file(root,'tool.exe','bin');
  const reference=refs(true,exe);reference.configure(true);
  const {reference:ref,executable}=await reference.capture();
  reference.invalidate();expect(reference.requiresConfiguration()).toBe(true);
  await expect(reference.resolveApproved(ref,executable,'op-1')).rejects.toMatchObject({code:'SECRET_REF_UNAVAILABLE'});
  reference.configure(true);expect(reference.requiresConfiguration()).toBe(false);
  const fresh=await reference.capture();
  await expect(reference.resolveApproved(fresh.reference,fresh.executable,'op-1')).resolves.toBe('secret-value');
 });
});

describe('context7 execution binding',()=>{
 const launch=async(args:string[]=['--transport','stdio']):Promise<{root:string;launch:Context7LaunchDescriptor}>=>{
  const root=await dir();
  return {root,launch:{executable:await file(root,'node.exe','node'),entry:await file(root,'entry.js','entry'),manifest:await file(root,'manifest.json','{}'),packageManifest:await file(root,'package.json','{}'),cwd:root,args}};
 };
 it('captures observed identities and prefixes argv with the entry path',async()=>{
  const {launch:descriptor}=await launch(['a','b']);
  const binding=await captureContext7Binding(descriptor);
  expect(binding.argv).toEqual([binding.entry.path,'a','b']);
  expect(binding.definition).toMatchObject({id:'integration_prepare',version:1,executorBinding:'domain-prepare'});
  expect(binding.executable.sha256).toBe(sha('node'));
  expect(binding.cwd.path.length).toBeGreaterThan(0);
 });
 it('dispatches inside the unchanged approved binding',async()=>{
  const {launch:descriptor}=await launch();
  const approved=await captureContext7Binding(descriptor);
  const seen=await withContext7Binding(descriptor,approved,new AbortController().signal,async binding=>binding.argv);
  expect(seen).toEqual(approved.argv);
 },120000);
 it('fails closed when a file changed after approval and honours cancellation',async()=>{
  const {launch:descriptor}=await launch();
  const approved=await captureContext7Binding(descriptor);
  await utimes(descriptor.entry,new Date(),new Date(Date.now()+5000));
  await expect(withContext7Binding(descriptor,approved,new AbortController().signal,async()=>'never')).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  const aborted=new AbortController();aborted.abort();
  await expect(withContext7Binding(descriptor,approved,aborted.signal,async()=>'never')).rejects.toMatchObject({code:'CANCELLED'});
 },120000);
});

describe('integration manifest custody',()=>{
 it('rejects payload paths that are empty, absolute-looking, segmented or escaping the root',async()=>{
  const root=await dir();
  for(const path of ['','a\\b','C:/x','a//b','/a','a/./b','../escape','a/../../x'])expect(()=>payloadPath(root,path)).toThrow(/Invalid integration payload path|leaves its root/);
  expect(payloadPath(root,'a/b/c.txt')).toBe(join(root,'a','b','c.txt'));
 });
 it('rejects non-ordinary, oversized, hardlinked and mutating payload files',async()=>{
  const root=await dir(),normal=await file(root,'ok.txt','stable');
  await expect(ordinaryFile(root)).rejects.toThrow(/ordinary files/);
  const linked=await file(root,'linked.txt','x');await link(linked,join(root,'linked-alias.txt'));
  await expect(ordinaryFile(linked)).rejects.toThrow(/ordinary files/);
  await expect(ordinaryFile(linked,undefined,true)).resolves.toEqual(Buffer.from('x'));
  expect((await ordinaryFile(normal)).toString()).toBe('stable');
 });
 it('accepts the bundled manifest and rejects tampered allowlist entries',async()=>{
  const root=process.cwd();
  const manifest=await readManifest(root);
  expect(manifest.version).toBe(1);expect(manifest.integrations).toHaveLength(10);
  const context7=manifest.integrations.find(item=>item.id==='context7')!;
  await verifyDefinition(root,context7);
  const broken={...context7,files:[{...context7.files[0]!,sha256:sha('tampered')}]};
  await expect(verifyDefinition(root,broken)).rejects.toThrow(/checksum mismatch/);
 });
});
