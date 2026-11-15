import {afterEach,expect,it,vi} from 'vitest';
import {createServer,type Server,type IncomingMessage,type ServerResponse} from 'node:http';
import {workspaceEvents} from '../apps/desktop/workspace-events.ts';
import type {DesktopWorkspaceChange} from '../packages/desktop-contract/index.ts';
import {subscribe} from '../apps/web/src/api.ts';

const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.useRealTimers();vi.unstubAllGlobals();});
async function host(handler:(request:IncomingMessage,response:ServerResponse)=>void){
 const server:Server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();if(!address||typeof address==='string')throw Error('Fixture host missing');return 'http://127.0.0.1:'+address.port;
}
function relay(origin:string,changes:DesktopWorkspaceChange[]){const value=workspaceEvents(origin,change=>changes.push(change));cleanup.push(value.close);return value;}

it('uses one authenticated Node stream and relays only connection state and sequence across native windows',async()=>{
 let streams=0,disconnected=false;const changes:DesktopWorkspaceChange[]=[];
 const origin=await host((request,response)=>{
  if(request.url==='/api/bootstrap'){response.setHeader('Set-Cookie','harness_session=abcdef; Path=/; HttpOnly; SameSite=Strict');response.end('{"csrfToken":"private"}');return;}
  expect(request.url).toBe('/api/events?after=0');expect(request.headers.cookie).toBe('harness_session=abcdef');streams++;request.once('close',()=>{disconnected=true;});
  response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('id: 4\nevent: workspace\ndata: {"secret":"fixture-private-payload"}\n\n');
 });
 const value=relay(origin,changes);await vi.waitFor(()=>expect(value.state()).toEqual({connected:true,sequence:4}));
 expect(streams).toBe(1);expect(changes).toEqual([{connected:true,sequence:0},{connected:true,sequence:4}]);expect(JSON.stringify(changes)).not.toContain('private');
 await value.close();
 await vi.waitFor(()=>expect(disconnected).toBe(true));
 expect(value.state()).toEqual({connected:false,sequence:4});expect(changes.at(-1)).toEqual({connected:false,sequence:4});
});

it('bootstraps the owned desktop relay using the sidecar launch credential', async () => {
 const launchCredential = 'fixture-launch-credential';
 let sessionCookie: string | undefined;
 let streamCredential: string | undefined;
 const origin = await host((request, response) => {
  if (request.url === '/api/bootstrap') {
   if (request.headers['x-harness-launch'] !== launchCredential) { response.writeHead(403).end(); return; }
   response.setHeader('Set-Cookie', 'harness_session=abc; Path=/; HttpOnly');
   response.end('{}');
   return;
  }
  sessionCookie = request.headers.cookie;
  streamCredential = request.headers['x-harness-launch'] as string | undefined;
  response.writeHead(200, {'Content-Type':'text/event-stream'});
  response.write('id: 5\n\n');
 });
 // Pass the launch secret as a separate argument, not as a URL parameter.
 const value = workspaceEvents(origin, () => {}, launchCredential);
 cleanup.push(value.close);
 await vi.waitFor(() => expect(value.state()).toEqual({connected:true,sequence:5}), {timeout:750});
 expect(sessionCookie).toBe('harness_session=abc');
 expect(streamCredential).toBeUndefined();
});

it('renews its private session and resumes after the last accepted sequence when the owned host disconnects',async()=>{
 let bootstraps=0,streams=0;const changes:DesktopWorkspaceChange[]=[];
 const origin=await host((request,response)=>{
  if(request.url==='/api/bootstrap'){bootstraps++;response.setHeader('Set-Cookie','harness_session='+String(bootstraps)+'abc; Path=/');response.end('{}');return;}
  streams++;expect(request.headers.cookie).toBe('harness_session='+String(bootstraps)+'abc');response.writeHead(200,{'Content-Type':'text/event-stream'});
  if(streams===1){response.end('id: 7\n\n');return;}
  expect(request.url).toBe('/api/events?after=7');response.write('id: 8\n\n');
 });
 const value=relay(origin,changes);await vi.waitFor(()=>expect(value.state()).toEqual({connected:true,sequence:8}),{timeout:3000});
 expect(bootstraps).toBe(2);expect(changes).toContainEqual({connected:false,sequence:7});
});

it('bounds payload buffering and ignores malformed or regressing event identities',async()=>{
 const changes:DesktopWorkspaceChange[]=[];let finishLine!:()=>void;const origin=await host((request,response)=>{
  if(request.url==='/api/bootstrap'){response.setHeader('Set-Cookie','harness_session=abc; Path=/');response.end('{}');return;}
  response.writeHead(200,{'Content-Type':'text/event-stream'});response.write('data: '+('x'.repeat(10000))+'\nid: NaN\nid: 9007199254740992\nid: 11\nid: 10\nid: ');finishLine=()=>{response.write('12\r\n\n');};
 });
 const value=relay(origin,changes);await vi.waitFor(()=>expect(value.state().sequence).toBe(11));
 // Wait for the first sequence rather than assuming two writes yield two decoded chunks.
 finishLine();await vi.waitFor(()=>expect(value.state().sequence).toBe(12));
 expect(changes).toEqual([{connected:true,sequence:0},{connected:true,sequence:11},{connected:true,sequence:12}]);
});

it('aborts a hanging bootstrap on shutdown and rejects non-owned origins before any network access',async()=>{
 let requested=false;const origin=await host(()=>{requested=true;});const value=relay(origin,[]);
 await vi.waitFor(()=>expect(requested).toBe(true));await value.close();
 for(const origin of ['https://example.com','http://localhost:4317','http://127.0.0.1:4317/redirect','file:///secret'])expect(()=>workspaceEvents(origin,()=>{})).toThrow('owned loopback');
});

it('retries a transient native snapshot failure after a newer notification arrived during the pending read',async()=>{
 vi.useFakeTimers();let changed!:(change:DesktopWorkspaceChange)=>void;
 vi.stubGlobal('window',{harnessDesktop:{onWorkspaceChanged:(listener:typeof changed)=>{changed=listener;return()=>{};}}});
 const eventSource=vi.fn();vi.stubGlobal('EventSource',eventSource);
 let rejectRead!:(cause:Error)=>void;const waiting=new Promise<void>((_resolve,reject)=>{rejectRead=reject;});
 const refresh=vi.fn<()=>Promise<void>>().mockResolvedValueOnce().mockReturnValueOnce(waiting).mockResolvedValue(undefined),online=vi.fn();
 const unsubscribe=subscribe(0,()=>{},online,refresh);cleanup.push(async()=>unsubscribe());await vi.advanceTimersByTimeAsync(0);
 changed({connected:true,sequence:1});changed({connected:true,sequence:2});rejectRead(Error('Temporary snapshot interruption'));
 await vi.advanceTimersByTimeAsync(1000);
 expect(refresh).toHaveBeenCalledTimes(3);expect(online).toHaveBeenLastCalledWith(true);expect(eventSource).not.toHaveBeenCalled();
});

it('cancels the native snapshot retry when its renderer subscription unmounts',async()=>{
 vi.useFakeTimers();const removed=vi.fn();vi.stubGlobal('window',{harnessDesktop:{onWorkspaceChanged:()=>removed}});
 const refresh=vi.fn<()=>Promise<void>>().mockRejectedValue(Error('Temporary snapshot interruption'));
 const unsubscribe=subscribe(0,()=>{},()=>{},refresh);await vi.advanceTimersByTimeAsync(0);unsubscribe();await vi.advanceTimersByTimeAsync(10000);
 expect(refresh).toHaveBeenCalledOnce();expect(removed).toHaveBeenCalledOnce();
});
