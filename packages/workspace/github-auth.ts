import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {lstat,readFile,rename,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {HarnessError} from '../contracts/index.ts';
import {secureDirectory} from '../runtime-official/manifest.ts';
import {withPathGuard} from '../core/file-access.ts';

// Public application identifier from cli/cli v2.87.3 internal/authflow/flow.go.
// Device authorization avoids gh's ambient operating-system keyring entirely.
const CLIENT_ID='178c6fc778ccc68e1d6a';
const credential=z.strictObject({version:z.literal(1),token:z.string().min(10).max(4096),login:z.string().regex(/^[A-Za-z0-9-]{1,100}$/)});
interface Device{id:string;code:string;userCode:string;url:string;expires:number;interval:number;next:number}
export class GitHubAuth{
 private device?:Device;
 constructor(private readonly dataDir:string,private readonly request:typeof fetch=fetch){}
 private async folder(){return secureDirectory(this.dataDir,join(this.dataDir,'github'));}
 async token(){const path=join(await this.folder(),'credentials.json');try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>8192)throw Error('Invalid credential file.');return await withPathGuard([{path,leaf:true,readOnly:true}],new AbortController().signal,async()=>credential.parse(JSON.parse(await readFile(path,'utf8'))).token);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new HarnessError('GITHUB_AUTH_REQUIRED','Sign in to GitHub for this Gen V1 profile.');throw error;}}
 async start(){const response=await this.request('https://github.com/login/device/code',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,scope:'repo read:org'}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new HarnessError('GITHUB_AUTH_FAILED','GitHub could not start sign-in.');const body=z.object({device_code:z.string().min(1).max(512),user_code:z.string().min(1).max(40),verification_uri:z.literal('https://github.com/login/device'),expires_in:z.number().int().positive().max(1800),interval:z.number().int().positive().max(60)}).parse(await response.json()),device:Device={id:randomUUID(),code:body.device_code,userCode:body.user_code,url:body.verification_uri,expires:Date.now()+body.expires_in*1000,interval:body.interval*1000,next:Date.now()+body.interval*1000};this.device=device;return{id:device.id,userCode:device.userCode,url:device.url,expiresAt:device.expires,interval:device.interval};}
 async poll(id:string){const device=this.device;if(!device||device.id!==id||device.expires<Date.now())throw new HarnessError('GITHUB_AUTH_EXPIRED','Start a new GitHub sign-in.');if(device.next>Date.now())return{status:'pending' as const};device.next=Date.now()+device.interval;
  const response=await this.request('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:CLIENT_ID,device_code:device.code,grant_type:'urn:ietf:params:oauth:grant-type:device_code'}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new HarnessError('GITHUB_AUTH_FAILED','GitHub sign-in did not complete.');const body=await response.json() as Record<string,unknown>;
  if(body.error==='authorization_pending')return{status:'pending' as const};if(body.error==='slow_down'){device.interval+=5000;device.next=Date.now()+device.interval;return{status:'pending' as const};}if(typeof body.access_token!=='string'){this.device=undefined;throw new HarnessError('GITHUB_AUTH_FAILED','GitHub sign-in was denied or expired.');}
  const token=z.string().min(10).max(4096).parse(body.access_token),viewer=await this.request('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});if(!viewer.ok)throw new HarnessError('GITHUB_AUTH_FAILED','GitHub did not confirm this account.');const login=z.object({login:credential.shape.login}).parse(await viewer.json()).login;
  if(this.device!==device)throw new HarnessError('GITHUB_AUTH_EXPIRED','A newer sign-in replaced this request.');
  const folder=await this.folder(),path=join(folder,'credentials.json'),temporary=join(folder,randomUUID()+'.tmp');await withPathGuard([{path:folder,leaf:false,allowChildWrites:true}],new AbortController().signal,async()=>{await writeFile(temporary,JSON.stringify({version:1,token,login}),{flag:'wx',mode:0o600});await rename(temporary,path);});this.device=undefined;return{status:'authenticated' as const,login};
 }
}
