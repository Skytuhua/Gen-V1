// Fixed employee information persistence only. No owner fallback or engine/CLI composition.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest} from 'node:http';
import {decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {captureEmployeeSendContext,captureEmployeeInboxContext,prepareEmployeeInformationCommand,
  validateEmployeeInformationReceipt,validateEmployeeInformationInbox,
  type EmployeeSendContext,type EmployeeInboxContext,type EmployeeInformationReceipt,type EmployeeInformationInbox,
  type PreparedEmployeeInformationCommand} from '../company-contracts/communications/employee-information.ts';

const wireErrors = Object.freeze({400:['INVALID_REQUEST'],401:['AUTHENTICATION_REQUIRED'],403:['SCOPE_DENIED'],404:['NOT_FOUND'],409:['IDEMPOTENCY_CONFLICT'],503:['AUTHORITY_UNAVAILABLE','RECORDS_UNAVAILABLE']} as const);
type WireStatus=keyof typeof wireErrors;
type WireCode=typeof wireErrors[WireStatus][number];
export type EmployeeInformationClientErrorCode=WireCode|'CONFIG'|'REQUEST'|'TIMEOUT'|'ABORTED'|'TRANSPORT'|'RESPONSE';
export class EmployeeInformationClientError extends Error {
  constructor(readonly code:EmployeeInformationClientErrorCode,readonly status?:WireStatus){super(code);this.name='EmployeeInformationClientError';}
}
export interface EmployeeInformationClientOptions {
  origin:string;role:'employee';credential:()=>string|Promise<string>;ca:string|Buffer;timeoutMs?:number;
}
function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function reflected(value:unknown,token:string):boolean{
  if(typeof value==='string')return value.includes(token);
  return !!value&&typeof value==='object'&&Object.entries(value).some(([key,child])=>key.includes(token)||reflected(child,token));
}
export class EmployeeInformationClient {
  #port:number;#ca:Buffer;#credential:EmployeeInformationClientOptions['credential'];#timeoutMs:number;
  constructor(options:EmployeeInformationClientOptions){
    try{
      if(!object(options)||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!['origin','role','credential','ca','timeoutMs'].includes(k)))throw 0;
      const{origin,role,credential,ca,timeoutMs=3000}=options;
      const match=typeof origin==='string'&&/^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if(!match||Number(match[1])>65535||role!=='employee'||typeof credential!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw 0;
      if(typeof ca!=='string'&&!Buffer.isBuffer(ca))throw 0;
      const trust=Buffer.from(ca);if(!trust.length)throw 0;new X509Certificate(trust);
      this.#port=Number(match[1]);this.#ca=trust;this.#credential=credential;this.#timeoutMs=timeoutMs;
    }catch{throw new EmployeeInformationClientError('CONFIG');}
  }
  get role():'employee'{return'employee';}
  /** Explicit information-only submission; uncertain outcomes retain the caller's same envelope. */
  async send(expected:EmployeeSendContext,raw:Uint8Array,signal?:AbortSignal):Promise<EmployeeInformationReceipt>{
    const deadline=performance.now()+this.#timeoutMs;
    let context:EmployeeSendContext,bytes:Uint8Array;
    try{context=captureEmployeeSendContext(expected);if(!(raw instanceof Uint8Array)||raw.byteLength>32768)throw 0;bytes=Uint8Array.from(raw);}catch{throw new EmployeeInformationClientError('REQUEST');}
    return this.#request('send',context,bytes,20,signal,deadline) as Promise<EmployeeInformationReceipt>;
  }
  /** One nonconsuming exact-project read. There is no cursor or background polling. */
  async inbox(expected:EmployeeInboxContext,limit=20,signal?:AbortSignal):Promise<EmployeeInformationInbox>{
    const deadline=performance.now()+this.#timeoutMs;
    let context:EmployeeInboxContext;
    try{context=captureEmployeeInboxContext(expected);if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw 0;}catch{throw new EmployeeInformationClientError('REQUEST');}
    return this.#request('inbox',context,undefined,limit,signal,deadline,arguments.length>=2&&arguments[1]!==undefined) as Promise<EmployeeInformationInbox>;
  }
  #request(operation:'send'|'inbox',context:EmployeeSendContext|EmployeeInboxContext,raw:Uint8Array|undefined,limit:number,signal:AbortSignal|undefined,deadline:number,explicitLimit=false):Promise<EmployeeInformationReceipt|EmployeeInformationInbox>{
    return new Promise((resolve,reject)=>{
      let settled=false,pending:ClientRequest|undefined;
      const finish=(code?:EmployeeInformationClientErrorCode,value?:EmployeeInformationReceipt|EmployeeInformationInbox,status?:WireStatus)=>{
        if(settled)return;
        if(code!=='ABORTED'&&performance.now()>=deadline){code='TIMEOUT';status=undefined;}
        settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);pending?.destroy();
        if(code)reject(new EmployeeInformationClientError(code,status));else resolve(value!);
      };
      const abort=()=>finish('ABORTED'),timer=setTimeout(()=>finish('TIMEOUT'),Math.max(0,deadline-performance.now()));
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){finish('ABORTED');return;}
      void(async()=>{
        let prepared:PreparedEmployeeInformationCommand|undefined;
        if(operation==='send')try{prepared=await prepareEmployeeInformationCommand(raw!,context as EmployeeSendContext);}catch{finish('REQUEST');return;}
        if(settled)return;
        let token:string;
        try{token=await this.#credential();}catch{finish('AUTHENTICATION_REQUIRED');return;}
        if(settled)return;if(performance.now()>=deadline){finish('TIMEOUT');return;}
        if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token)){finish('AUTHENTICATION_REQUIRED');return;}
        const body=prepared?Buffer.from(prepared.canonicalJson,'utf8'):undefined;
        const path=operation==='send'?'/company/v1/commands':`/company/v1/me/inbox?project_id=${context.scope.id}`+(explicitLimit?`&limit=${limit}`:'');
        const headers:Record<string,string>={Host:`127.0.0.1:${this.#port}`,Authorization:`Bearer ${token}`,Connection:'close'};
        if(body){headers['Content-Type']='application/json';headers['Content-Length']=String(body.length);}
        try{
          pending=httpsRequest({hostname:'127.0.0.1',port:this.#port,method:body?'POST':'GET',path,headers,
            ca:this.#ca,rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false,maxHeaderSize:16384},response=>{
            if(settled){response.destroy();return;}
            const status=response.statusCode??0,success=operation==='send'?202:200,allowed=wireErrors[status as WireStatus] as readonly WireCode[]|undefined;
            const counts=new Map<string,number>();for(let i=0;i<response.rawHeaders.length;i+=2){const name=response.rawHeaders[i].toLowerCase();counts.set(name,(counts.get(name)??0)+1);}
            const length=response.headers['content-length'];
            if((status!==success&&!allowed)||counts.get('content-type')!==1||counts.get('content-length')!==1||counts.has('content-encoding')||counts.has('transfer-encoding')||!/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type']??'')||length===undefined||!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>262144){finish('RESPONSE');response.destroy();return;}
            const chunks:Buffer[]=[];let size=0;
            response.on('data',(chunk:Buffer)=>{if(settled)return;size+=chunk.length;if(size>262144){finish('RESPONSE');response.destroy();return;}chunks.push(chunk);});
            response.on('error',()=>finish('RESPONSE'));response.on('aborted',()=>finish('RESPONSE'));
            response.on('end',()=>{
              if(settled)return;
              void(async()=>{
                try{
                  const bytes=Buffer.concat(chunks);if(!response.complete||bytes.length!==Number(length))throw 0;
                  if(status!==success){
                    const value=decodeBoundedJson(bytes,262144);
                    if(!object(value)||Object.keys(value).sort().join(',')!=='error,schema_version'||value.schema_version!==1||!object(value.error)||Object.keys(value.error).join(',')!=='code'||!allowed?.includes(value.error.code as WireCode))throw 0;
                    finish(value.error.code as WireCode,undefined,status as WireStatus);return;
                  }
                  const result=operation==='send'?await validateEmployeeInformationReceipt(bytes,context as EmployeeSendContext,prepared!):await validateEmployeeInformationInbox(bytes,context as EmployeeInboxContext,limit);
                  if(reflected(result,token))throw 0;finish(undefined,result);
                }catch{finish('RESPONSE');}
              })();
            });
          });
          pending.on('error',()=>finish('TRANSPORT'));pending.end(body);
        }catch{finish('TRANSPORT');}
      })();
    });
  }
}
