import {createServer,request as httpRequest,type IncomingMessage,type RequestOptions} from 'node:http';
import {connect as netConnect,type Socket} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import type {Duplex} from 'node:stream';
import {publicAddress,remoteBrowserUrl} from './window-policy.ts';
import {bypassesHost,type NetworkProxySnapshot} from '../../packages/core/network-proxy-env.ts';

export interface BrowserProxy {port:number;close():Promise<void>}
export interface BrowserProxyOptions {
 resolve?:(hostname:string)=>Promise<{address:string;family:number}[]>;
 connect?:(options:{host:string;port:number;family:number})=>Socket;
 request?:(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ReturnType<typeof httpRequest>;
 /** #1531 T04: corporate upstream snapshot provider (revision-aware); throwing fails closed. */
 upstream?:()=>Promise<NetworkProxySnapshot|null>;
 connectTls?:(options:{host:string;port:number;servername:string})=>Socket;
 requestTls?:(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ReturnType<typeof httpRequest>;
}
const hopHeaders=new Set(['connection','proxy-connection','proxy-authorization','proxy-authenticate','keep-alive','te','trailer','transfer-encoding','upgrade']);
function cleanHeaders(headers:IncomingMessage['headers']) {
 const denied=new Set([...hopHeaders,...String(headers.connection??'').split(',').map(item=>item.trim().toLowerCase())]);
 return Object.fromEntries(Object.entries(headers).filter(([key])=>!denied.has(key.toLowerCase())));
}
export async function pinnedBrowserTarget(raw:string,resolveHost:NonNullable<BrowserProxyOptions['resolve']>=hostname=>lookup(hostname,{all:true,verbatim:true})) {
 const url=remoteBrowserUrl(raw),port=Number(url.port||(url.protocol==='https:'?443:80));
 if(port!==(url.protocol==='https:'?443:80))throw Error('Only public HTTP port80 and HTTPS port443 are supported');
 const host=url.hostname.replace(/^\[|\]$/g,'');let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const addresses=await Promise.race([resolveHost(host),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS lookup timed out')),2500);})]);
  if(!addresses.length||addresses.length>32||addresses.some(item=>![4,6].includes(item.family)||!publicAddress(item.address)))throw Error('Private and local network requests are blocked');
  const selected=addresses.find(item=>item.family===4)??addresses[0];return {url,host:selected.address,family:selected.family,port};
 }finally{clearTimeout(timer);}
}
async function pinnedUpstreamAddress(raw:string,resolveHost:NonNullable<BrowserProxyOptions['resolve']>):Promise<{address:string;family:number;port:number;secure:boolean;hostname:string}> {
 const url=new URL(raw);if(url.protocol!=='http:'&&url.protocol!=='https:')throw Error('Only HTTP and HTTPS corporate proxies are supported for Browser egress');
 const secure=url.protocol==='https:';const port=Number(url.port||(secure?443:80));if(!Number.isInteger(port)||port<1||port>65535)throw Error('Corporate proxy port is out of range');
 const addresses=await resolveHost(url.hostname.replace(/^\[|\]$/g,''));
 const selected=(addresses.find(item=>item.family===4)??addresses[0]);
 if(!selected||!publicAddress(selected.address))throw Error('The configured proxy resolves to a private or local address');
 return {...selected,port,secure,hostname:url.hostname.replace(/^\[|\]$/g,'')};
}
const proxyAuthHeader=(credentials:string|null)=>{ if(!credentials)return undefined;
 const i=credentials.indexOf(':');const user=decodeURIComponent(credentials.slice(0,i)),pass=decodeURIComponent(credentials.slice(i+1));
 return 'Basic '+Buffer.from(user+':'+pass,'utf8').toString('base64');};
const literal=(host:string)=>isIP(host)===6?'['+host+']':host;
/** CONNECT through the corporate hop to the already-vetted numeric target; fails closed (never falls back to direct, never lets the upstream re-resolve the name). */
async function upstreamTunnel(up:NetworkProxySnapshot,target:{host:string;port:number},resolveHost:NonNullable<BrowserProxyOptions['resolve']>,connect:NonNullable<BrowserProxyOptions['connect']>,connectTls:NonNullable<BrowserProxyOptions['connectTls']>):Promise<Socket> {
 const hop=await pinnedUpstreamAddress(up.url!,resolveHost);
 const authority=literal(target.host)+':'+target.port;
 return new Promise<Socket>((accept,reject)=>{
  const socket=hop.secure?connectTls({host:hop.address,port:hop.port,servername:hop.hostname}):connect({host:hop.address,port:hop.port,family:hop.family});
  socket.setTimeout(15000,()=>socket.destroy(Error('Corporate proxy connection timed out')));
  const auth=proxyAuthHeader(up.credentials);
  let buffer=Buffer.alloc(0);
  const fail=(error:Error)=>{socket.removeListener('data',onData);socket.destroy();reject(error);};
  socket.once('error',fail);socket.once('close',()=>fail(Error('The configured proxy closed the connection')));
  socket.once('connect',()=>{
   socket.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n'+(auth?'Proxy-Authorization: '+auth+'\r\n':'')+'\r\n');
  });
  const onData=(chunk:Buffer)=>{
   buffer=Buffer.concat([buffer,chunk]);if(buffer.length>8192)return fail(Error('Corporate proxy response is too large'));
   const end=buffer.indexOf('\r\n\r\n');if(end<0)return;
   socket.removeListener('data',onData);
   const head=buffer.slice(0,end).toString('latin1'),rest=buffer.slice(end+4);
   if(!/^HTTP\/1\.[01] 200/.test(head))return fail(Error('The configured proxy refused the connection'));
   socket.removeListener('error',fail);socket.removeAllListeners('close');socket.setTimeout(0);if(rest.length)socket.unshift(rest);accept(socket);
  };
  socket.on('data',onData);
 });
}
export async function createBrowserProxy(options:BrowserProxyOptions={}):Promise<BrowserProxy> {
 const sockets=new Set<Duplex>(),connect=options.connect??netConnect,request=options.request??httpRequest,connectTls=options.connectTls??(tlsConnect as unknown as NonNullable<BrowserProxyOptions['connectTls']>),requestTls=options.requestTls??(httpsRequest as unknown as NonNullable<BrowserProxyOptions['requestTls']>);
 const server=createServer({maxHeaderSize:16*1024,requestTimeout:30000,headersTimeout:15000},(incoming,outgoing)=>{
  void (async()=>{
   if(!incoming.url||incoming.method==='CONNECT'||incoming.headers.upgrade)throw Error('Unsupported proxy request');
   const target=await pinnedBrowserTarget(incoming.url,options.resolve);if(target.url.protocol!=='http:')throw Error('HTTPS requests must use a tunnel');
   const length=Number(incoming.headers['content-length']??0);if(!Number.isFinite(length)||length<0||length>8*1024*1024)throw Error('Browser request is too large');
   const up=await options.upstream?.();const viaHop=up?.url&&!bypassesHost(up.bypass,target.url.hostname,target.port);
   const resolveHost=options.resolve??(async hostname=>lookup(hostname,{all:true,verbatim:true}));
   const hop=viaHop?await pinnedUpstreamAddress(up!.url!,resolveHost):null;
   const auth=hop?proxyAuthHeader(up!.credentials):undefined;
   const headers={...cleanHeaders(incoming.headers),host:target.url.host,...(auth?{'proxy-authorization':auth}:{})};
   // Via-hop requests keep the origin Host but name the vetted numeric target so
   // the upstream never re-resolves the destination (DNS rebind cannot detour).
   const viaPath=hop?'http://'+literal(target.host)+(target.port===80?'':':'+target.port)+target.url.pathname+target.url.search:target.url.pathname+target.url.search;
   const upstream=(hop?.secure?requestTls:request)(hop?{hostname:hop.address,family:hop.family,port:hop.port,path:viaPath,method:incoming.method,headers,agent:false,timeout:30000}:{hostname:target.host,family:target.family,port:target.port,path:viaPath,method:incoming.method,headers,agent:false,timeout:30000},response=>{
    outgoing.writeHead(response.statusCode??502,cleanHeaders(response.headers));response.pipe(outgoing);response.on('error',()=>outgoing.destroy());
   });
   upstream.on('timeout',()=>upstream.destroy(Error('Browser request timed out')));
   upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('The public page could not be loaded.');});
   let bytes=0;incoming.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){upstream.destroy();incoming.destroy();outgoing.destroy();}});
   incoming.on('aborted',()=>upstream.destroy());outgoing.on('close',()=>upstream.destroy());incoming.pipe(upstream);
  })().catch(()=>{if(!outgoing.headersSent)outgoing.writeHead(403,{'content-type':'text/plain','cache-control':'no-store'});outgoing.end('Only public HTTP and HTTPS pages are allowed.');});
 });
 server.maxConnections=128;server.maxRequestsPerSocket=128;server.keepAliveTimeout=5000;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 server.on('upgrade',(_request,socket)=>{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
 server.on('connect',(incoming,client,head)=>{
  void (async()=>{
   const authority=incoming.url;if(!authority||!authority.includes(':')||/[/?#@\\\s]/.test(authority))throw Error('Invalid tunnel authority');
   const target=await pinnedBrowserTarget('https://'+authority,options.resolve);if(target.port!==443)throw Error('Unsupported tunnel port');
   const up=await options.upstream?.();
   const viaHop=!!(up?.url&&!bypassesHost(up.bypass,target.url.hostname,443));
   const upstream=viaHop?await upstreamTunnel(up!,{host:target.host,port:443},options.resolve??(async hostname=>lookup(hostname,{all:true,verbatim:true})),connect,connectTls):connect({host:target.host,port:443,family:target.family});
   sockets.add(upstream);upstream.once('close',()=>sockets.delete(upstream));
   upstream.setTimeout(30000,()=>{upstream.destroy();client.destroy();});
   const ready=()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);};
   if(viaHop)ready();else upstream.once('connect',ready);
   upstream.on('error',()=>{client.destroy();upstream.destroy();});client.on('error',()=>upstream.destroy());client.once('close',()=>upstream.destroy());
  })().catch(()=>client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw Error('Browser proxy did not bind');
 return {port:address.port,close:()=>new Promise<void>(resolve=>{for(const socket of sockets)socket.destroy();server.close(()=>resolve());})};
}
