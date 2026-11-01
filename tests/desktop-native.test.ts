import {describe,it,expect} from 'vitest';
import {desktopSurfaceKey,parseDesktopSurface} from '../packages/desktop-contract/index.ts';
import {allowRemoteBrowserUrl,clampDesktopBounds,isTrustedDesktopSender,needsEditorHandoff,parseBrowserCommand,publicAddress,remoteBrowserUrl,trustedDesktopUrl} from '../apps/desktop/window-policy.ts';
import {createBrowserProxy,pinnedBrowserTarget} from '../apps/desktop/browser-proxy.ts';
import {createServer,request as httpRequest} from 'node:http';
import {createServer as tcpServer,connect} from 'node:net';
import {nodeSidecarArguments} from '../apps/desktop/backend-policy.ts';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {releaseOwnedBrowsers} from '../apps/desktop/browser-lifecycle.ts';
import {desktopSignInArguments} from '../apps/desktop/auth-launcher.ts';

describe('native desktop surface authority',()=>{
 it('passes only an explicitly supported subscription provider into the fixed sign-in helper',()=>{
  for(const provider of ['openai','openai-codex','github-copilot','xai'] as const)expect(desktopSignInArguments(resolve('.'),resolve('isolated-data'),provider).slice(-2)).toEqual(['--provider',provider]);
 });
 it('rejects unrecognized provider or executable-shaped sign-in input before process creation',()=>{
  for(const provider of ['claude','--eval','openai --eval code',{},null])expect(()=>desktopSignInArguments(resolve('.'),resolve('isolated-data'),provider as never)).toThrow('subscription provider');
 });
 it('launches the real Node sidecar loader through a file URL, including Windows paths with spaces',()=>{
  const args=nodeSidecarArguments(resolve('.'));expect(args[0]).toBe('--import');expect(args[1]).toMatch(/^file:\/\//);expect(fileURLToPath(args[1])).toBe(resolve('node_modules/tsx/dist/loader.mjs'));expect(args[2]).toBe(resolve('apps/server/main.ts'));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
  expect(execFileSync(process.execPath,[...args.slice(0,2),'--eval','process.stdout.write("SIDECAR_LOADER_READY")'],{encoding:'utf8',windowsHide:true,env})).toBe('SIDECAR_LOADER_READY');
 });
 it('admits only bounded typed identities and registered surface properties',()=>{
  expect(parseDesktopSurface({kind:'artifact',threadId:'task-1',artifactId:'artifact-1'})).toEqual({kind:'artifact',threadId:'task-1',artifactId:'artifact-1'});
  for(const value of [{kind:'artifact',artifactId:'a'},{kind:'agent',threadId:'t'},{kind:'usage'},{kind:'browser',browserId:'../host'},{kind:'workspace',tab:'terminal'},{kind:'plan',threadId:'t',url:'file:///secret'},{kind:'plan',threadId:'constructor'},{kind:'main',nodeIntegration:true},[],null,Object.create(null)])expect(()=>parseDesktopSurface(value)).toThrow();
 });
 it('keeps task-specific windows distinct without accepting arbitrary window URLs',()=>{
  expect(desktopSurfaceKey({kind:'plan',threadId:'task-a'})).not.toBe(desktopSurfaceKey({kind:'plan',threadId:'task-b'}));
  expect(desktopSurfaceKey({kind:'workspace',threadId:'task-a',tab:'files'})).not.toBe(desktopSurfaceKey({kind:'workspace',threadId:'task-a',tab:'diff'}));
  expect(desktopSurfaceKey({kind:'workspace',threadId:'task-a',tab:'artifact',artifactId:'artifact-a'})).toBe(desktopSurfaceKey({kind:'artifact',threadId:'task-a',artifactId:'artifact-a'}));
  expect(trustedDesktopUrl('http://127.0.0.1:4317','a:b')).toBe('http://127.0.0.1:4317/?desktopWindow=a%3Ab');
 });
 it('requires the original main frame, exact URL and webContents identity',()=>{
  const expected={id:11,url:'http://127.0.0.1:4317/?desktopWindow=main'};
  expect(isTrustedDesktopSender(expected,{...expected,mainFrame:true})).toBe(true);
  for(const sender of [{...expected,mainFrame:false},{...expected,id:12,mainFrame:true},{...expected,url:'https://example.org/',mainFrame:true},{...expected,url:expected.url+'#fake',mainFrame:true},{...expected,url:'http://127.0.0.1:4317/',mainFrame:true}])expect(isTrustedDesktopSender(expected,sender)).toBe(false);
 });
 it('requires the actual matching editor to flush when detachment starts in a sidebar',()=>{
  const target={kind:'artifact',threadId:'task-a',artifactId:'artifact-a'} as const;
  expect(needsEditorHandoff(target,{kind:'main'})).toBe(true);expect(needsEditorHandoff(target,{kind:'thread',threadId:'task-a'})).toBe(true);expect(needsEditorHandoff(target,{kind:'workspace',threadId:'task-a',tab:'artifact',artifactId:'artifact-a'})).toBe(true);
  expect(needsEditorHandoff(target,{kind:'thread',threadId:'task-b'})).toBe(false);expect(needsEditorHandoff(target,{kind:'navigation'})).toBe(false);expect(needsEditorHandoff({kind:'plan',threadId:'task-a'},{kind:'main'})).toBe(false);
 });
});
describe('pinned outbound browser transport',()=>{
 it('resolves once and returns a numeric destination, rejecting private rebinds and custom ports',async()=>{
  let calls=0;const resolveHost=async()=>{calls++;return [{address:calls===1?'93.184.216.34':'127.0.0.1',family:4}];};
  expect(await pinnedBrowserTarget('https://example.org/path',resolveHost)).toMatchObject({host:'93.184.216.34',port:443,family:4});expect(calls).toBe(1);
  await expect(pinnedBrowserTarget('https://example.org/path',resolveHost)).rejects.toThrow('Private');
  await expect(pinnedBrowserTarget('https://example.org:8443/',resolveHost)).rejects.toThrow('port');
 });
 it('sends HTTP only to the approved numeric address and rejects a later private response',async()=>{
  const upstream=createServer((_request,response)=>response.end('PUBLIC FIXTURE'));await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const address=upstream.address();if(!address||typeof address==='string')throw Error('Fixture did not bind');
  let calls=0,connections=0;const proxy=await createBrowserProxy({resolve:async()=>[{address:++calls===1?'93.184.216.34':'127.0.0.1',family:4}],request:(options,callback)=>{connections++;expect(options.hostname).toBe('93.184.216.34');expect(options.headers).toMatchObject({host:'example.org'});return httpRequest({...options,hostname:'127.0.0.1',port:address.port},callback);}});
  const through=()=>new Promise<{status:number;body:string}>((resolve,reject)=>{const request=httpRequest({host:'127.0.0.1',port:proxy.port,path:'http://example.org/path',headers:{host:'example.org'}},response=>{let body='';response.on('data',data=>body+=data);response.on('end',()=>resolve({status:response.statusCode!,body}));});request.on('error',reject);request.end();});
  try{expect(await through()).toEqual({status:200,body:'PUBLIC FIXTURE'});expect(await through()).toMatchObject({status:403});expect(connections).toBe(1);}finally{await proxy.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
 });
 it('pins CONNECT to the approved numeric address and rejects loopback before opening a socket',async()=>{
  const echo=tcpServer(socket=>socket.on('data',bytes=>socket.write(bytes)));await new Promise<void>(resolve=>echo.listen(0,'127.0.0.1',resolve));const address=echo.address();if(!address||typeof address==='string')throw Error('Fixture did not bind');
  let connections=0;const proxy=await createBrowserProxy({resolve:async host=>[{address:host==='example.org'?'93.184.216.34':'127.0.0.1',family:4}],connect:options=>{connections++;expect(options).toEqual({host:'93.184.216.34',port:443,family:4});return connect({host:'127.0.0.1',port:address.port});}});
  const tunnel=(authority:string)=>new Promise<string>((resolve,reject)=>{const client=connect(proxy.port,'127.0.0.1',()=>client.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\n'));let received='';client.on('data',bytes=>{received+=bytes.toString();if(received.includes('\r\n\r\n')){client.destroy();resolve(received);}});client.on('error',reject);});
  try{expect(await tunnel('example.org:443')).toContain('200 Connection Established');expect(await tunnel('private.example:443')).toContain('403 Forbidden');expect(await tunnel('127.0.0.1:443')).toContain('403 Forbidden');expect(connections).toBe(1);}finally{await proxy.close();await new Promise<void>(resolve=>echo.close(()=>resolve()));}
 });
});
describe('native detached geometry',()=>{
 const areas=[{x:0,y:0,width:1920,height:1040},{x:-1280,y:-100,width:1280,height:960}];
 it('allows independent X/Y placement on a connected negative-coordinate display',()=>{
  expect(clampDesktopBounds({x:-1100,y:50,width:430,height:700},areas)).toEqual({x:-1100,y:50,width:430,height:700});
 });
 it('recovers removed-monitor bounds and oversized/invalid values inside a reachable work area',()=>{
  const result=clampDesktopBounds({x:5000,y:5000,width:9000,height:9000},areas);expect(result).toEqual({x:0,y:0,width:1920,height:1040});
  const reset=clampDesktopBounds(undefined,areas,{width:430,height:720});expect(reset).toEqual({x:745,y:160,width:430,height:720});
  const invalid=clampDesktopBounds({x:NaN,y:Infinity,width:NaN,height:-1},[{x:0,y:0,width:200,height:120}]);expect(invalid).toEqual({x:0,y:0,width:200,height:120});
 });
});
describe('isolated built-in browser',()=>{
 it('closes explicitly removed browser views and frees their budget while preserving a reparented view',()=>{
  interface View {id:string;owner?:unknown;running:boolean}const closed:string[]=[],records=new Map<string,View>(),old:{browser?:View;dockedBrowser?:View}={},next:{browser?:View}={};
  const view:View={id:'remote',owner:old,running:true};old.browser=view;records.set(view.id,view);
  releaseOwnedBrowsers(old,records,browser=>{closed.push(browser.id);browser.running=false;});expect(records.size).toBe(0);expect(view.running).toBe(false);expect(old.browser).toBeUndefined();expect(closed).toEqual(['remote']);
  const transferred:View={id:'preserved',owner:next,running:true};old.browser=transferred;next.browser=transferred;records.set(transferred.id,transferred);
  releaseOwnedBrowsers(old,records,browser=>{closed.push(browser.id);browser.running=false;});expect(transferred.running).toBe(true);expect(records.get('preserved')).toBe(transferred);expect(closed).toEqual(['remote']);
  releaseOwnedBrowsers(next,records,browser=>{browser.running=false;});expect(records.size).toBe(0);expect(transferred.running).toBe(false);
 });
 it('rejects local/private/credentialled/non-web pages before native navigation',()=>{
  for(const url of ['file:///C:/secret','javascript:alert(1)','https://user:pass@example.org','http://localhost:4317','http://127.0.0.1:4317','http://2130706433/','http://0x7f000001/','http://10.0.0.1/','http://169.254.169.254/','http://[::1]/','http://[::ffff:127.0.0.1]/','https://intranet/','https://server.local/','https://example.org./'])expect(()=>remoteBrowserUrl(url),url).toThrow();
  expect(remoteBrowserUrl('https://example.org/path?q=ok').href).toBe('https://example.org/path?q=ok');
 });
 it('fails closed for DNS failures and mixed public/private DNS responses',async()=>{
  expect(await allowRemoteBrowserUrl('https://example.org/',async()=>[{address:'93.184.216.34'}])).toBe(true);
  expect(await allowRemoteBrowserUrl('https://example.org/',async()=>[{address:'93.184.216.34'},{address:'127.0.0.1'}])).toBe(false);
  expect(await allowRemoteBrowserUrl('https://example.org/',async()=>[])).toBe(false);
  expect(await allowRemoteBrowserUrl('https://example.org/',async()=>{throw Error('offline');})).toBe(false);
 });
 it('does not admit mapped/private IPv6 addresses or arbitrary browser control arguments',()=>{
  expect(publicAddress('::ffff:7f00:1')).toBe(false);expect(publicAddress('fc00::1')).toBe(false);expect(publicAddress('fe80::1')).toBe(false);expect(publicAddress('2002:7f00:1::')).toBe(false);expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  expect(parseBrowserCommand({type:'bounds',bounds:{x:0,y:96,width:400,height:0}})).toEqual({type:'bounds',bounds:{x:0,y:96,width:400,height:0}});
  for(const value of [{type:'executeJavaScript',code:'process.exit()'},{type:'back',url:'file:///'},{type:'bounds',bounds:{x:Infinity,y:0,width:1,height:1}},{type:'navigate',url:'https://example.org',extra:true}])expect(()=>parseBrowserCommand(value)).toThrow();
 });
});
