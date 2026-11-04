import { afterEach,expect, it } from 'vitest';
import { join } from 'node:path';
import {mkdtempSync,mkdirSync,renameSync,rmSync,symlinkSync,linkSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import { accountProfileRoot, providerAccountKey,withAccountProfile } from '../packages/runtime/account-profile.ts';
import type { ConnectionAccount } from '../packages/contracts/accounts.ts';
import {withPathGuard} from '../packages/core/file-access.ts';

const account: ConnectionAccount = { id: '8933cc31-976d-4f76-a183-035c4b3263e8', providerId: 'openai', label: 'Personal', enabled: true, createdAt: '', updatedAt: '' };
const temporary:string[]=[];
const directory=()=>{const path=mkdtempSync(join(tmpdir(),'harness-account-profile-'));temporary.push(path);return path;};
afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
it('preserves T3 credential-binding hashing and unambiguous tuple boundaries', () => {
  expect(providerAccountKey('cursor', '../../personal')).toBe('provider-auth-db3cc9436c8272847fe0c152ba8b0d4695af90acd916f555649e17ba6efe6094');
  expect(providerAccountKey('ab', 'c')).not.toBe(providerAccountKey('a', 'bc'));
});
it('isolates account and provider roots without using the account label', () => {
  const root = accountProfileRoot('workspace', account);
  expect(root).toBe(join('workspace', 'accounts', providerAccountKey('openai', account.id)));
  expect(accountProfileRoot('workspace', { ...account, label: '../../Elsewhere' })).toBe(root);
  expect(accountProfileRoot('workspace', { ...account, providerId: 'claude-code' })).not.toBe(root);
  expect(accountProfileRoot('workspace', { ...account, id: 'a9314811-0937-4f76-b565-445d57504cce' })).not.toBe(root);
});
it('rejects unsaved IDs and unavailable providers before constructing a profile path', () => {
  for (const id of ['../outside', '', 'not-an-id']) expect(() => accountProfileRoot('workspace', { ...account, id })).toThrow();
  expect(() => accountProfileRoot('workspace', { ...account, providerId: 'opencode' as ConnectionAccount['providerId'] })).toThrow();
});
it('rejects an accounts junction and holds the acquired namespace against replacement',async()=>{
 const root=directory(),outside=directory();symlinkSync(outside,join(root,'accounts'),'junction');let entered=false;
 await expect(withAccountProfile(root,account,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(entered).toBe(false);
 rmSync(join(root,'accounts'));mkdirSync(join(root,'accounts'));
 await withAccountProfile(root,account,async profile=>{expect(profile).toBe(accountProfileRoot(root,account));expect(()=>renameSync(profile,profile+'-moved')).toThrow();expect(()=>renameSync(join(root,'accounts'),join(root,'accounts-moved'))).toThrow();});
 renameSync(accountProfileRoot(root,account),accountProfileRoot(root,account)+'-moved');
});

it('rejects native descendant directory redirects and hardlinked credential files before entry',async()=>{
 const root=directory(),outside=directory(),profile=accountProfileRoot(root,account);mkdirSync(profile,{recursive:true});symlinkSync(outside,join(profile,'pi'),'junction');let entered=false;
 await expect(withAccountProfile(root,account,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(entered).toBe(false);
 rmSync(join(profile,'pi'));mkdirSync(join(profile,'pi'));writeFileSync(join(outside,'synthetic.json'),'synthetic');linkSync(join(outside,'synthetic.json'),join(profile,'pi','auth.json'));
 await expect(withAccountProfile(root,account,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});expect(entered).toBe(false);
});

it('pins native directories while allowing legitimate atomic credential replacement',async()=>{
 const root=directory();await withAccountProfile(root,account,async profile=>{
  const pi=join(profile,'pi'),auth=join(pi,'auth.json'),temporary=join(pi,'auth.next');
  mkdirSync(pi,{recursive:true});writeFileSync(auth,'synthetic old');writeFileSync(temporary,'synthetic refreshed');renameSync(temporary,auth);expect(readFileSync(auth,'utf8')).toBe('synthetic refreshed');
  expect(()=>renameSync(pi,pi+'-moved')).toThrow();
 });
});

it('keeps each writable account directory nonempty with a pinned ordinary marker',async()=>{
 const parent=directory(),root=join(parent,'data');mkdirSync(root);const thread='synthetic-thread';
 await withAccountProfile(root,account,async profile=>{
  const inspect=(path:string)=>{
   const marker=join(path,'.harness-directory-guard');
   expect(existsSync(marker)).toBe(true);
   expect(()=>rmSync(marker)).toThrow();
   expect(()=>renameSync(marker,marker+'.moved')).toThrow();
   expect(()=>writeFileSync(marker,'changed')).toThrow();
   for(const name of readdirSync(path,{withFileTypes:true}))if(name.isDirectory())inspect(join(path,name.name));
  };
  inspect(root);
  const auth=join(profile,'pi','auth.json'),next=auth+'.next';writeFileSync(next,'synthetic');renameSync(next,auth);
  expect(readFileSync(auth,'utf8')).toBe('synthetic');
  expect(existsSync(join(parent,'.harness-directory-guard'))).toBe(false);
 },undefined,thread);
});

it('rejects a missing writable account directory before entering native work',async()=>{
 const root=directory();let entered=false;
 await expect(withPathGuard([{path:join(root,'missing'),leaf:false,allowChildWrites:true,childWriteRoot:root}],new AbortController().signal,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
 expect(entered).toBe(false);
});

it('rejects missing and file-valued writable directories without an explicit ancestor scope',async()=>{
 const root=directory(),file=join(root,'file');writeFileSync(file,'synthetic');
 for(const path of [join(root,'missing'),file]){
  let entered=false;
  await expect(withPathGuard([{path,leaf:false,allowChildWrites:true}],new AbortController().signal,async()=>{entered=true;})).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
  expect(entered).toBe(false);
 }
});

it('keeps official home namespaces pinned while native credential files remain atomically replaceable',async()=>{
 const root=directory(),official={...account,providerId:'gemini-cli' as const};
 await withAccountProfile(root,official,async profile=>{
  const home=join(profile,'official','gemini-cli','home'),authDir=join(home,'.gemini'),auth=join(authDir,'oauth_creds.json'),temporary=auth+'.next';
  writeFileSync(auth,'synthetic old');writeFileSync(temporary,'synthetic refreshed');renameSync(temporary,auth);expect(readFileSync(auth,'utf8')).toBe('synthetic refreshed');
  expect(()=>renameSync(home,home+'-moved')).toThrow();expect(()=>renameSync(authDir,authDir+'-moved')).toThrow();
 });
 const file=join(root,'synthetic');writeFileSync(file,'synthetic');
 await expect(withPathGuard([{path:file,leaf:true,allowChildWrites:true}],new AbortController().signal,async()=>null)).rejects.toMatchObject({code:'CAPABILITY_DENIED'});
});
