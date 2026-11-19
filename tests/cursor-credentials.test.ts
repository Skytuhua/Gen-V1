import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {cursorAuthPath,cursorCredentialStore,CURSOR_LOGIN_BACKEND} from '../packages/runtime-official/cursor-credentials.ts';
import {fakeSecretCodec} from './fixtures/secret-codec.ts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'cursor-secrets-'));roots.push(root);return{root,path:cursorAuthPath(root),codec:fakeSecretCodec(),credentials:{version:1 as const,backendUrl:CURSOR_LOGIN_BACKEND,apiKey:'private-browser-token',createdAtMs:Date.now()}};}
it('encrypts browser credentials and round-trips them',async()=>{
 const{root,path,codec,credentials}=await fixture();await cursorCredentialStore(root,true,codec).save(credentials);const bytes=await readFile(path,'utf8');expect(JSON.parse(bytes).version).toBe(2);expect(bytes).not.toContain(credentials.apiKey);expect(await cursorCredentialStore(root,false,codec).load()).toEqual(credentials);
});
it.each(['success','unavailable'] as const)('reads legacy Cursor credentials when migration is %s',async(mode)=>{
 const{root,path,codec,credentials}=await fixture();await mkdir(dirname(path),{recursive:true});const prior=JSON.stringify({version:1,provenance:'cursor-sdk-official-browser',credentials});await writeFile(path,prior);
 const secrets=mode==='success'?codec:{...codec,protect:async()=>{throw Error('Unavailable');}};expect(await cursorCredentialStore(root,false,secrets).load()).toEqual(credentials);const bytes=await readFile(path,'utf8');if(mode==='success'){expect(JSON.parse(bytes).version).toBe(2);expect(bytes).not.toContain(credentials.apiKey);expect(await cursorCredentialStore(root,false,secrets).load()).toEqual(credentials);}else expect(bytes).toBe(prior);expect((await readdir(dirname(path))).filter(name=>name.endsWith('.tmp'))).toEqual([]);
});
it.each(['tampered',''] as const)('fails safely for invalid ciphertext %j',async(protectedValue)=>{
 const{root,path,codec}=await fixture();await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify({version:2,protected:protectedValue}));expect(await cursorCredentialStore(root,false,codec).load()).toBeUndefined();
});
it('returns no credentials for missing storage and refuses invalid or unauthorized writes',async()=>{
 const{root,codec,credentials}=await fixture();expect(await cursorCredentialStore(root,false,codec).load()).toBeUndefined();await expect(cursorCredentialStore(root,false,codec).save(credentials)).rejects.toThrow();await expect(cursorCredentialStore(root,true,codec).save({...credentials,backendUrl:'https://invalid.example'})).rejects.toThrow();
});
