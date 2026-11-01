import {afterEach,expect,it,vi} from 'vitest';
import {PassThrough} from 'node:stream';
import {createServer,type Server} from 'node:http';
import {createHermesAcpServer} from '../packages/runtime-hermes/acp-server.ts';
import {MODEL_ONLY_MAX_WIRE_BYTES} from '../packages/runtime/model-only.ts';

const owned:Server[]=[];afterEach(async()=>{for(const server of owned.splice(0)){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}});
async function broker(handle:(request:any,response:any)=>void){const server=createServer(handle);owned.push(server);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));return`http://127.0.0.1:${(server.address() as any).port}/model`;}
function client(url:string){const input=new PassThrough(),output=new PassThrough(),messages:any[]=[];let pending='';output.setEncoding('utf8');output.on('data',chunk=>{pending+=chunk;let newline:number;while((newline=pending.indexOf('\n'))>=0){messages.push(JSON.parse(pending.slice(0,newline)));pending=pending.slice(newline+1);}});const server=createHermesAcpServer({input,output,brokerUrl:url,jobKey:'owned-job-key-1234567890',modelId:'openai/model'});let id=0;return{input,messages,server,async request(method:string,params:unknown){const current=++id;input.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');await vi.waitFor(()=>expect(messages.some(message=>message.id===current)).toBe(true));return messages.find(message=>message.id===current);}};}
it('runs the original ACP handshake and returns Hermes tool-call text verbatim after broker completion',async()=>{
 let received:any,authorization:string|undefined;const text='<tool_call>{"name":"skill_manage","arguments":{"action":"create"}}</tool_call>\n日本語';
 const url=await broker((request,response)=>{authorization=request.headers.authorization;let content='';request.on('data',(chunk:Buffer)=>{content+=chunk;});request.on('end',()=>{received=JSON.parse(content);response.setHeader('content-type','application/json');response.end(JSON.stringify({content:text,usage:{inputTokens:12,outputTokens:5,cost:null}}));});});
 const c=client(url);try{expect((await c.request('initialize',{protocolVersion:1})).result.protocolVersion).toBe(1);const session=(await c.request('session/new',{cwd:'not-used',mcpServers:[]})).result.sessionId;
 expect((await c.request('session/set_model',{sessionId:session,modelId:'openai/model'})).result).toEqual({});const prompt='Original Hermes transcript.\nDo not alter <tool_call> tags.';
 const result=await c.request('session/prompt',{sessionId:session,prompt:[{type:'text',text:prompt}]});expect(result.result).toMatchObject({stopReason:'end_turn',usage:{inputTokens:12,outputTokens:5,cost:null}});expect(received).toEqual({sessionId:session,modelId:'openai/model',prompt});expect(authorization).toBe('Bearer owned-job-key-1234567890');
 expect(c.messages.find(message=>message.method==='session/update')?.params.update).toEqual({sessionUpdate:'agent_message_chunk',content:{type:'text',text}});expect(JSON.stringify(c.messages)).not.toContain('owned-job-key');
 }finally{await c.server.close();}
});
it('rejects native MCP/client filesystem surfaces and refuses a substituted model',async()=>{
 const fetcher=vi.fn();const c=client(await broker(fetcher));try{await c.request('initialize',{protocolVersion:1});expect((await c.request('session/new',{cwd:'x',mcpServers:[{name:'unsafe'}]})).error.code).toBe(-32602);
 const session=(await c.request('session/new',{cwd:'x',mcpServers:[]})).result.sessionId;expect((await c.request('fs/read_text_file',{path:'C:/private'})).error.code).toBe(-32601);
 expect((await c.request('session/set_model',{sessionId:session,modelId:'claude-code/other'})).error.code).toBe(-32602);expect((await c.request('session/prompt',{sessionId:session,prompt:[{type:'text',text:'hello'}]})).error).toBeDefined();expect(fetcher).not.toHaveBeenCalled();
 }finally{await c.server.close();}
});
it.each(['cancel','close'])('aborts the owned broker request on %s without emitting completed content',async mode=>{
 let entered=false,aborted=false;const url=await broker((_request,response)=>{entered=true;response.on('close',()=>{aborted=true;});});const c=client(url);try{await c.request('initialize',{protocolVersion:1});const session=(await c.request('session/new',{cwd:'x',mcpServers:[]})).result.sessionId;
 const prompting=c.request('session/prompt',{sessionId:session,prompt:[{type:'text',text:'Wait for the model.'}]});await vi.waitFor(()=>expect(entered).toBe(true));if(mode==='cancel'){await c.request('session/cancel',{sessionId:session});expect((await prompting).result.stopReason).toBe('cancelled');}else{c.input.end();await c.server.closed;await prompting;}
 await vi.waitFor(()=>expect(aborted).toBe(true));expect(c.messages.some(message=>message.method==='session/update')).toBe(false);
 }finally{await c.server.close();}
});
it('rejects non-loopback broker configuration before opening a connection',()=>{
 expect(()=>createHermesAcpServer({input:new PassThrough(),output:new PassThrough(),brokerUrl:'https://example.com/model',jobKey:'owned-job-key-1234567890'})).toThrow('loopback');
});
it('rejects a broker response whose ACP wrapper would exceed the wire bound without truncating content',async()=>{
 const content='x'.repeat(MODEL_ONLY_MAX_WIRE_BYTES-64),body=JSON.stringify({content});expect(Buffer.byteLength(body)).toBeLessThan(MODEL_ONLY_MAX_WIRE_BYTES);
 const c=client(await broker((_request,response)=>response.end(body)));try{await c.request('initialize',{protocolVersion:1});const session=(await c.request('session/new',{cwd:'x',mcpServers:[]})).result.sessionId;
 const result=await c.request('session/prompt',{sessionId:session,prompt:[{type:'text',text:'hello'}]});expect(result.error?.code).toBe(-32001);expect(c.messages.some(message=>message.method==='session/update')).toBe(false);
 }finally{await c.server.close();}
});
