import {parseDesktopSurface,type DesktopCompanyTaskSurface,type DesktopSurface} from '../../packages/desktop-contract/index.ts';
import {captureApprovedJobRead} from '../../packages/company-contracts/approved-job-read.ts';
import {CompanyStatusSchema,COMPANY_PROTOCOL} from '../../packages/company-contracts/index.ts';

const denied=()=>Error('Company task selection is unavailable. Check its current project and saved task reference.');
async function json(response:Response,limit:number):Promise<unknown>{
 if(!response.ok||!response.body)throw denied();
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>limit)throw denied();chunks.push(next.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));

/** Existing host reads select a view; they never grant an action or inference. */
export async function authorizeCompanyTaskSurface(value:DesktopSurface,origin:string,fetcher:typeof fetch=fetch):Promise<DesktopCompanyTaskSurface>{
 try{
  const surface=parseDesktopSurface(value);
  if(surface.kind!=='company-task'||!/^http:\/\/127\.0\.0\.1:\d{4,5}$(?![\s\S])/.test(origin)||new URL(origin).origin!==origin||Number(new URL(origin).port)<1024)throw denied();
  const signal=AbortSignal.timeout(5000),base={redirect:'error' as const,cache:'no-store' as const,signal};
  const bootstrap=await fetcher(origin+'/api/bootstrap',base),cookie=bootstrap.headers.get('set-cookie')?.split(';')[0],session=await json(bootstrap,32768);
  if(!cookie||!/^company_session=[A-Za-z0-9_-]{16,256}$(?![\s\S])/.test(cookie)||!record(session)||session.mode!=='company'||typeof session.csrfToken!=='string'||!/^[A-Za-z0-9_-]{16,256}$(?![\s\S])/.test(session.csrfToken))throw denied();
  const headers={cookie,origin,'x-harness-csrf':session.csrfToken,'content-type':'application/json'};
  const workflow=await fetcher(origin+'/api/company/workflow',{...base,headers}).then(response=>json(response,32768));
  if(!record(workflow))throw denied();const selected=captureApprovedJobRead(workflow.approvedJob);
  if(selected.companyId!==surface.companyId||selected.projectId!==surface.projectId||selected.workOrderId!==surface.resourceId)throw denied();
  const response=await fetcher(origin+'/api/company/status',{...base,method:'POST',headers,body:JSON.stringify({scope:{kind:'project',id:surface.projectId}})}).then(response=>json(response,8*1024*1024));
  if(!record(response)||response.source!=='company_service'||response.protocol!==COMPANY_PROTOCOL)throw denied();
  const status=CompanyStatusSchema.parse(response.data);if(status.project?.id!==surface.projectId||status.projects.length!==1||status.projects[0].id!==surface.projectId)throw denied();
  return surface;
 }catch{throw denied();}
}
