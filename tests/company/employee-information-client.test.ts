import {readFileSync} from 'node:fs';
import {createServer} from 'node:https';
import type {RequestListener} from 'node:http';
import type {Duplex} from 'node:stream';
import {rootCertificates} from 'node:tls';
import {inspect} from 'node:util';
import {afterEach,expect,it,vi} from 'vitest';
import {EmployeeInformationClient,EmployeeInformationClientError} from '../../packages/company-client/employee-information.ts';
import {canonicalBytes} from '../../packages/company-contracts/communications/json.ts';
import golden from '../../packages/company-contracts/communications/v1/golden/employee-information.json';
const ca=readFileSync(new URL('./fixtures/owner-history-test.cert.pem',import.meta.url)),key=readFileSync(new URL('./fixtures/owner-history-test.key.pem',import.meta.url));
const TOKEN='PUBLIC-employee-information-unit-only',sample=golden.examples[0];
function binding(actor:typeof sample.receipt.sender){const{principal_id,employee_id,machine_id,generation,task_id,attempt_id,work_order_id}=actor;return{principal_id,employee_id,machine_id,generation,task_id,attempt_id,work_order_id};}
const sendContext=()=>({company_id:'leo-company',scope:{kind:'project' as const,id:'alpha'},sender:binding(sample.receipt.sender),recipient:binding(sample.receipt.recipient)});
const inboxContext=()=>{const{sender:_sender,...rest}=sendContext();return rest;};
const rawCommand=()=>canonicalBytes(sample.command);
const cleanup:(()=>void|Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(handler:RequestListener){
 const sockets=new Set<Duplex>(),server=createServer({cert:ca,key},handler);
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 cleanup.push(()=>new Promise<void>(resolve=>{for(const s of sockets)s.destroy();server.close(()=>resolve());}));
 const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
 return{origin:`https://127.0.0.1:${address.port}`,sockets};
}
function client(origin:string,extra:Record<string,unknown>={}){return new EmployeeInformationClient({origin,role:'employee',credential:()=>TOKEN,ca,timeoutMs:2000,...extra} as never);}
function send(response:Parameters<RequestListener>[1],value:unknown,status=200){const b=Buffer.from(canonicalBytes(value));response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length});response.end(b);}
async function fails(pending:Promise<unknown>,code:string,status?:number){const error=await pending.catch(e=>e);expect(error).toBeInstanceOf(EmployeeInformationClientError);if(!(error instanceof EmployeeInformationClientError))throw Error('typed error');expect(error.code).toBe(code);expect(error.status).toBe(status);expect(inspect(error)).not.toContain(TOKEN);}

it('sends one canonical original-C01 envelope and independently binds its information receipt',async()=>{
 const requests:{url:string;method:string;headers:Record<string,unknown>;body:Buffer}[]=[];
 const endpoint=await fixture((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{requests.push({url:req.url!,method:req.method!,headers:req.headers,body:Buffer.concat(chunks)});send(res,sample.receipt,202);});});
 const reader=client(endpoint.origin),raw=rawCommand();
 const one=await reader.send(sendContext(),raw),two=await reader.send(sendContext(),raw);
 expect(one).toEqual(sample.receipt);expect(two).toEqual(one);expect(requests).toHaveLength(2);
 for(const r of requests){expect(r.url).toBe('/company/v1/commands');expect(r.method).toBe('POST');expect(r.body).toEqual(Buffer.from(raw));expect(r.headers['content-length']).toBe(String(raw.byteLength));expect(r.headers['content-type']).toBe('application/json');expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);expect(r.headers.host).toBe(new URL(endpoint.origin).host);for(const h of ['origin','transfer-encoding','content-encoding'])expect(r.headers[h]).toBeUndefined();}
});
it('reads a scoped nonconsuming inbox once with independently defaulted limit20',async()=>{
 const paths:string[]=[],endpoint=await fixture((req,res)=>{paths.push(req.url!);expect(req.method).toBe('GET');expect(req.headers['content-type']).toBeUndefined();expect(req.headers['content-length']).toBeUndefined();send(res,golden.inbox);});
 const page=await client(endpoint.origin).inbox(inboxContext());expect(page).toEqual(golden.inbox);expect(page.next_cursor).toBeNull();expect(page.has_more).toBeNull();expect(paths).toEqual(['/company/v1/me/inbox?project_id=alpha']);
 await fails(client(endpoint.origin).inbox(inboxContext(),1),'RESPONSE');
});
it('captures the exact command and both permitted peer identities before credential await',async()=>{
 let release!:(v:string)=>void,entered!:()=>void;const ready=new Promise<void>(r=>{entered=r;});
 const endpoint=await fixture((req,res)=>{const chunks:Buffer[]=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{expect(Buffer.concat(chunks)).toEqual(Buffer.from(rawCommand()));send(res,sample.receipt,202);});});
 const context=sendContext(),raw=Uint8Array.from(rawCommand());
 const pending=client(endpoint.origin,{credential:()=>new Promise<string>(r=>{release=r;entered();})}).send(context,raw);
 await ready;context.scope.id='beta';context.sender.generation=9;context.recipient.attempt_id='foreign';raw.fill(0);release(TOKEN);
 await expect(pending).resolves.toEqual(sample.receipt);
});
it('captures inbox recipient generation/task/attempt and query before credential await',async()=>{
 let release!:(v:string)=>void,entered!:()=>void;const ready=new Promise<void>(r=>{entered=r;});
 const endpoint=await fixture((req,res)=>{expect(req.url).toBe('/company/v1/me/inbox?project_id=alpha&limit=20');send(res,golden.inbox);});
 const expected=inboxContext(),pending=client(endpoint.origin,{credential:()=>new Promise<string>(r=>{release=r;entered();})}).inbox(expected,20);
 await ready;expected.recipient.generation=2;expected.recipient.attempt_id='new';expected.scope.id='beta';release(TOKEN);await expect(pending).resolves.toEqual(golden.inbox);
});
it('rejects owner role/fallback and arbitrary transport/config options',()=>{
 for(const o of [{role:'owner'},{ownerCredential:()=>TOKEN},{headers:{}},{rejectUnauthorized:false},{agent:{}},{ca:'bad'},{timeoutMs:0},{timeoutMs:10001}])expect(()=>client('https://127.0.0.1:1',o)).toThrow('CONFIG');
});
it.each(['http://127.0.0.1:1','https://localhost:1','https://127.0.0.2:1','https://127.0.0.1:0','https://127.0.0.1:01','https://127.0.0.1:65536','https://127.0.0.1:1/'])('rejects nonexact origin%s',origin=>{expect(()=>client(origin)).toThrow('CONFIG');});
it('fails local scope/peer/command/limit validation without requesting credentials',async()=>{
 const credential=vi.fn(()=>TOKEN),reader=client('https://127.0.0.1:1',{credential});
 for(const n of [0,51,1.2,NaN,'20',null])await fails(reader.inbox(inboxContext(),n as never),'REQUEST');
 const command=structuredClone(sample.command);command.payload.attempt_id='foreign';await fails(reader.send(sendContext(),canonicalBytes(command)),'REQUEST');
 const wrong=sendContext();wrong.recipient.employee_id=wrong.sender.employee_id;await fails(reader.send(wrong,rawCommand()),'REQUEST');
 await fails(reader.send(sendContext(),new Uint8Array(32769)),'REQUEST');await fails(reader.inbox({...inboxContext(),scope:{kind:'project',id:'company-ops'}}),'REQUEST');expect(credential).not.toHaveBeenCalled();
});
it.each([[400,'INVALID_REQUEST'],[401,'AUTHENTICATION_REQUIRED'],[403,'SCOPE_DENIED'],[404,'NOT_FOUND'],[409,'IDEMPOTENCY_CONFLICT'],[503,'AUTHORITY_UNAVAILABLE'],[503,'RECORDS_UNAVAILABLE']] as const)('exposes only exact closed HTTP%i/%s',async(status,code)=>{
 let calls=0;const endpoint=await fixture((_q,r)=>{calls++;send(r,{schema_version:1,error:{code}},status);});await fails(client(endpoint.origin).send(sendContext(),rawCommand()),code,status);expect(calls).toBe(1);
});
it('does not automatically retry an uncertain send or allocate a replacement identity',async()=>{
 let calls=0;const endpoint=await fixture(req=>{calls++;req.socket.destroy();});await fails(client(endpoint.origin).send(sendContext(),rawCommand()),'TRANSPORT');expect(calls).toBe(1);
});
it('rejects wrong CA and redirects with no fallback or redirected credential dispatch',async()=>{
 let calls=0;const endpoint=await fixture((_q,r)=>{calls++;send(r,golden.inbox);});await fails(client(endpoint.origin,{ca:rootCertificates[0]}).inbox(inboxContext()),'TRANSPORT');expect(calls).toBe(0);
 const redirect=await fixture((_q,r)=>{r.writeHead(302,{Location:endpoint.origin});r.end();});await fails(client(redirect.origin).inbox(inboxContext()),'RESPONSE');expect(calls).toBe(0);
});
it('bounds credential delay and blocks late native requests after timeout',async()=>{
 let release!:(s:string)=>void,calls=0;const endpoint=await fixture((_q,r)=>{calls++;send(r,golden.inbox);});await fails(client(endpoint.origin,{timeoutMs:40,credential:()=>new Promise<string>(r=>{release=r;})}).inbox(inboxContext()),'TIMEOUT');release(TOKEN);await new Promise(r=>setTimeout(r,10));expect(calls).toBe(0);
});
it('aborts an active response and a preaborted request without touching credentials',async()=>{
 const c=new AbortController();c.abort();const credential=vi.fn(()=>TOKEN);await fails(client('https://127.0.0.1:1',{credential}).inbox(inboxContext(),20,c.signal),'ABORTED');expect(credential).not.toHaveBeenCalled();
 let entered!:()=>void;const ready=new Promise<void>(r=>{entered=r;}),endpoint=await fixture((_q,r)=>{r.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':'1000'});r.write('{');entered();});
 const active=new AbortController(),pending=client(endpoint.origin).inbox(inboxContext(),20,active.signal);await ready;active.abort();await fails(pending,'ABORTED');await vi.waitFor(()=>expect(endpoint.sockets.size).toBe(0));
});
it('keeps the total deadline despite slow response progress',async()=>{
 const endpoint=await fixture((_q,r)=>{r.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':'1000'});r.write(' ');const drip=setInterval(()=>r.write(' '),10);r.once('close',()=>clearInterval(drip));});await fails(client(endpoint.origin,{timeoutMs:120}).inbox(inboxContext()),'TIMEOUT');await vi.waitFor(()=>expect(endpoint.sockets.size).toBe(0));
});
it('rejects malformed, oversized, mis-scoped or reflected responses without raw error leakage',async()=>{
 for(const mode of ['overflow','utf8','duplicate','html','encoding','error-extra','error-mismatch','scope']){
  const endpoint=await fixture((_q,r)=>{
   if(mode==='error-extra'||mode==='error-mismatch'){send(r,{schema_version:1,error:mode==='error-extra'?{code:'AUTHORITY_UNAVAILABLE',secret:TOKEN}:{code:'IDEMPOTENCY_CONFLICT'}},503);return;}
   if(mode==='scope'){send(r,{...golden.inbox,company_id:'foreign'});return;}
   r.writeHead(200,{'Content-Type':mode==='html'?'text/html':'application/json; charset=utf-8',...(mode==='encoding'?{'Content-Encoding':'gzip'}:{})});
   if(mode==='overflow')r.end(Buffer.alloc(262145,32));else if(mode==='utf8')r.end(Buffer.from([0xc3,0x28]));else if(mode==='duplicate')r.end(Buffer.from(canonicalBytes(golden.inbox)).toString().replace('"schema_version":1','"schema_version":1,"schema_version":1'));else if(mode==='html')r.end(`<html>${TOKEN}</html>`);else r.end(canonicalBytes(golden.inbox));
  });await fails(client(endpoint.origin).inbox(inboxContext()),'RESPONSE');
 }
});
it('sanitizes failed credentials and header injection without owner fallback',async()=>{
 for(const value of ['',null,4,'bad\r\nOrigin: evil'])await fails(client('https://127.0.0.1:1',{credential:()=>value}).inbox(inboxContext()),'AUTHENTICATION_REQUIRED');await fails(client('https://127.0.0.1:1',{credential:()=>{throw Error(TOKEN);}}).inbox(inboxContext()),'AUTHENTICATION_REQUIRED');
});
