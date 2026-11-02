import {afterEach,expect,it} from 'vitest';
import {fork} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,link,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {acquireProfileLease} from '../apps/server/profile-lease.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function directory(){const root=await mkdtemp(join(tmpdir(),'harness-profile-lease-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));return root;}
it('uses one exclusive canonical profile lock and releases it without deleting the lease file',async()=>{
 const root=await directory(),first=acquireProfileLease(root);expect(()=>acquireProfileLease(join(root,'.'))).toThrow(expect.objectContaining({code:'PROFILE_IN_USE'}));first.close();first.close();
 const next=acquireProfileLease(root);next.close();expect(await readFile(join(root,'.host-lease.sqlite'))).toBeInstanceOf(Buffer);
});
it.skipIf(process.platform!=='win32')('recognizes a second junction spelling as the same live profile',async()=>{
 const root=await directory(),actual=join(root,'actual'),alias=join(root,'alias');await mkdir(actual);await symlink(actual,alias,'junction');const first=acquireProfileLease(actual);
 try{expect(()=>acquireProfileLease(alias)).toThrow(expect.objectContaining({code:'PROFILE_IN_USE'}));}finally{first.close();}
});
it('refuses a hardlinked ownership file without changing the linked bytes',async()=>{
 const root=await directory(),profile=join(root,'profile'),sentinel=join(root,'sentinel');await mkdir(profile);await writeFile(sentinel,'retain the original bytes');await link(sentinel,join(profile,'.host-lease.sqlite'));
 expect(()=>acquireProfileLease(profile)).toThrow(expect.objectContaining({code:'PROFILE_LEASE_INVALID'}));expect(await readFile(sentinel,'utf8')).toBe('retain the original bytes');
});
it('lets a successor acquire the profile after the real owner process exits',async()=>{
 const root=await directory(),script=join(root,'owner.mjs');
 await writeFile(script,`import {acquireProfileLease} from ${JSON.stringify(pathToFileURL(resolve('apps/server/profile-lease.ts')).href)}; const profile=acquireProfileLease(${JSON.stringify(root)}); process.send({ready:true}); setInterval(()=>{if(!profile.dataDir)process.exit(2);},1000);`);
 const options={execArgv:['--import',pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],silent:true,windowsHide:true};
 const child=fork(script,[],options);
 const exited=new Promise<void>(done=>child.once('exit',()=>done()));cleanup.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;});
 await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Profile owner did not become ready')),5000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Profile owner exited early: '+code));});child.once('message',()=>{clearTimeout(timer);done();});});
 expect(()=>acquireProfileLease(root)).toThrow(expect.objectContaining({code:'PROFILE_IN_USE'}));child.kill();await exited;
 const successor=acquireProfileLease(root);successor.close();
});
