import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Readable,Writable} from 'node:stream';
import {MODEL_ONLY_MAX_PROMPT_BYTES,MODEL_ONLY_MAX_WIRE_BYTES} from '../runtime/model-only.ts';

interface Options {input:Readable;output:Writable;brokerUrl:string;jobKey:string;modelId?:string;fetch?:typeof fetch}
interface RpcMessage {jsonrpc:'2.0';id?:string|number|null;method:string;params?:Record<string,unknown>}
class RpcError extends Error {constructor(readonly code:number,message:string){super(message);}}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const model=(value:unknown):value is string=>typeof value==='string'&&/^[^\s\u0000]{1,300}$/.test(value);
const invalid=()=>new RpcError(-32602,'Invalid model transport parameters.');
function measuredUsage(value:unknown){
 if(!object(value))return;
 const result:Record<string,number|null>={};for(const key of ['inputTokens','outputTokens','contextTokens','contextWindow','cost','sessionPercent','weeklyPercent']){const item=value[key];if(item===null||typeof item==='number'&&Number.isFinite(item)&&item>=0)result[key]=item;}
 return Object.keys(result).length?result:undefined;
}

/** ACP text adapter for upstream Hermes ACPClient. It never executes a tool. */
export function createHermesAcpServer(options:Options):{closed:Promise<void>;close():Promise<void>}{
 const url=new URL(options.brokerUrl);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash)throw Error('Hermes requires an authenticated loopback model broker.');
 if(!/^[A-Za-z0-9_-]{16,256}$/.test(options.jobKey)||options.modelId!==undefined&&!model(options.modelId))throw Error('Hermes model transport configuration is invalid.');
 let initialized=false,sessionId:string|undefined,selected=options.modelId,rejectedSelection=false,buffer='',shuttingDown=false,stopped=false;
 let active:{abort:AbortController;done:Promise<unknown>}|undefined,closing:Promise<void>|undefined,release!:()=>void;
 const pending=new Set<Promise<void>>(),decoder=new StringDecoder('utf8'),closed=new Promise<void>(done=>{release=done;});
 const send=(value:unknown)=>{if(!stopped&&!options.output.destroyed){const frame=JSON.stringify(value);if(Buffer.byteLength(frame)>MODEL_ONLY_MAX_WIRE_BYTES)throw new RpcError(-32001,'The ACP response exceeded its bounded limit.');options.output.write(frame+'\n');}};
 const reply=(id:RpcMessage['id'],result:unknown)=>{if(id!==undefined)send({jsonrpc:'2.0',id,result});};
 const fail=(id:RpcMessage['id'],error:unknown)=>{if(id!==undefined)send({jsonrpc:'2.0',id:typeof id==='string'&&id.length>300?null:id,error:{code:error instanceof RpcError?error.code:-32603,message:error instanceof RpcError?error.message:'The owned model request could not finish.'}});};
 const session=(params:Record<string,unknown>)=>{if(!sessionId||params.sessionId!==sessionId)throw new RpcError(-32004,'Unknown model transport session.');return sessionId;};
 async function completion(id:string,text:string,abort:AbortController){
  try{
   const response=await (options.fetch??fetch)(url,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+options.jobKey,'content-type':'application/json'},body:JSON.stringify({sessionId:id,modelId:selected,prompt:text}),signal:abort.signal});
   if(!response.ok)throw new RpcError(-32001,'The owned model broker rejected the request.');
   const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body?.getReader();if(!reader)throw new RpcError(-32001,'The model broker returned no response.');
   try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MODEL_ONLY_MAX_WIRE_BYTES){await reader.cancel();throw new RpcError(-32001,'The model broker response exceeded its bounded limit.');}chunks.push(next.value);}}finally{reader.releaseLock();}
   const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!object(value)||typeof value.content!=='string'||Buffer.byteLength(value.content)>MODEL_ONLY_MAX_WIRE_BYTES)throw new RpcError(-32001,'The model broker returned an invalid text response.');
   if(abort.signal.aborted)return{stopReason:'cancelled'};
   if(value.content)send({jsonrpc:'2.0',method:'session/update',params:{sessionId:id,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:value.content}}}});
   const usage=measuredUsage(value.usage);return{stopReason:'end_turn',...(usage?{usage}:{})};
  }catch(error){if(abort.signal.aborted)return{stopReason:'cancelled'};throw error;}
 }
 async function handle(message:RpcMessage):Promise<unknown>{
  const params=message.params??{};
  if(message.method==='initialize'){if(initialized||params.protocolVersion!==1)throw invalid();initialized=true;return{protocolVersion:1,agentInfo:{name:'generative-harness-model-transport',version:'1'},agentCapabilities:{loadSession:false,promptCapabilities:{image:false,audio:false,embeddedContext:false},mcpCapabilities:{http:false,sse:false}},authMethods:[]};}
  if(!initialized)throw new RpcError(-32002,'Initialize the model transport first.');
  if(message.method==='session/new'){if(sessionId||typeof params.cwd!=='string'||params.mcpServers!==undefined&&(!Array.isArray(params.mcpServers)||params.mcpServers.length))throw invalid();sessionId=randomUUID();return{sessionId};}
  if(message.method==='session/set_model'||message.method==='session/set_config_option'){
   session(params);const requested=message.method==='session/set_model'?params.modelId:params.configId==='model'?params.value:undefined;
   if(active||!model(requested)||options.modelId!==undefined&&requested!==options.modelId){rejectedSelection=true;throw invalid();}
   selected=requested;rejectedSelection=false;return message.method==='session/set_model'?{}:{configOptions:[{id:'model',name:'Model',category:'model',type:'select',currentValue:selected,options:[{value:selected,name:selected}]}]};
  }
  if(message.method==='session/cancel'){session(params);const current=active;current?.abort.abort();await current?.done;return{};}
  if(message.method==='session/prompt'){
   const id=session(params);if(active)throw new RpcError(-32003,'A model request already owns this session.');
   if(!selected||rejectedSelection||!Array.isArray(params.prompt)||params.prompt.some(block=>!object(block)||block.type!=='text'||typeof block.text!=='string'))throw invalid();
   const text=params.prompt.map(block=>(block as {text:string}).text).join('');if(Buffer.byteLength(text)>MODEL_ONLY_MAX_PROMPT_BYTES)throw new RpcError(-32602,'The model prompt exceeded its bounded limit.');
   const abort=new AbortController(),done=completion(id,text,abort),owner=active={abort,done};try{return await done;}finally{if(active===owner)active=undefined;}
  }
  throw new RpcError(-32601,'Only model-text ACP methods are available.');
 }
 const line=(text:string)=>{
  if(shuttingDown||!text.trim())return;
  let value:unknown;try{value=JSON.parse(text);}catch{fail(null,new RpcError(-32700,'Invalid JSON-RPC message.'));return;}
  if(!object(value)||value.jsonrpc!=='2.0'||typeof value.method!=='string'||value.id!==undefined&&value.id!==null&&typeof value.id!=='string'&&typeof value.id!=='number'||value.params!==undefined&&!object(value.params)){fail(object(value)?value.id as RpcMessage['id']:null,new RpcError(-32600,'Invalid JSON-RPC request.'));return;}
  const message=value as unknown as RpcMessage,work=handle(message).then(result=>reply(message.id,result)).catch(error=>fail(message.id,error));pending.add(work);void work.finally(()=>pending.delete(work));
 };
 const data=(chunk:Buffer|string)=>{
  if(shuttingDown)return;buffer+=typeof chunk==='string'?chunk:decoder.write(chunk);let newline:number;
  while((newline=buffer.indexOf('\n'))>=0){const frame=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(Buffer.byteLength(frame)>MODEL_ONLY_MAX_WIRE_BYTES){fail(null,new RpcError(-32600,'The ACP frame exceeded its bounded limit.'));void close();return;}line(frame);}
  if(Buffer.byteLength(buffer)>MODEL_ONLY_MAX_WIRE_BYTES){fail(null,new RpcError(-32600,'The ACP frame exceeded its bounded limit.'));void close();}
 };
 const end=()=>{void close();};
 function close():Promise<void>{return closing??=(async()=>{shuttingDown=true;options.input.off('data',data);active?.abort.abort();await Promise.allSettled([...pending]);stopped=true;options.input.off('end',end);options.input.off('error',end);options.output.off('error',end);release();})();}
 options.input.on('data',data);options.input.once('end',end);options.input.once('error',end);options.output.once('error',end);
 return{closed,close};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{const server=createHermesAcpServer({input:process.stdin,output:process.stdout,brokerUrl:process.env.HARNESS_HERMES_BROKER_URL??'',jobKey:process.env.HARNESS_HERMES_JOB_KEY??'',modelId:process.env.HARNESS_HERMES_MODEL_ID});await server.closed;}
 catch{process.stderr.write('Hermes model transport could not start.\n');process.exitCode=1;}
}
