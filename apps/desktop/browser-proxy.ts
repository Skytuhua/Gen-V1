import {createServer,request as httpRequest,type IncomingMessage,type RequestOptions} from 'node:http';
import {connect as netConnect,type Socket} from 'node:net';
import {lookup} from 'node:dns/promises';
import type {Duplex} from 'node:stream';
import {publicAddress,remoteBrowserUrl} from './window-policy.ts';

export interface BrowserProxy {port:number;close():Promise<void>}
export interface BrowserProxyOptions {
 resolve?:(hostname:string)=>Promise<{address:string;family:number}[]>;
 connect?:(options:{host:string;port:number;family:number})=>Socket;
 request?:(options:RequestOptions,callback:(response:IncomingMessage)=>void)=>ReturnType<typeof httpRequest>;
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
export async function createBrowserProxy(options:BrowserProxyOptions={}):Promise<BrowserProxy> {
 const sockets=new Set<Duplex>(),connect=options.connect??netConnect,request=options.request??httpRequest;
 const server=createServer({maxHeaderSize:16*1024,requestTimeout:30000,headersTimeout:15000},(incoming,outgoing)=>{
  void (async()=>{
   if(!incoming.url||incoming.method==='CONNECT'||incoming.headers.upgrade)throw Error('Unsupported proxy request');
   const target=await pinnedBrowserTarget(incoming.url,options.resolve);if(target.url.protocol!=='http:')throw Error('HTTPS requests must use a tunnel');
   const length=Number(incoming.headers['content-length']??0);if(!Number.isFinite(length)||length<0||length>8*1024*1024)throw Error('Browser request is too large');
   const headers={...cleanHeaders(incoming.headers),host:target.url.host};
   const upstream=request({hostname:target.host,family:target.family,port:target.port,path:target.url.pathname+target.url.search,method:incoming.method,headers,agent:false,timeout:30000},response=>{
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
   const upstream=connect({host:target.host,port:443,family:target.family});sockets.add(upstream);upstream.once('close',()=>sockets.delete(upstream));
   upstream.setTimeout(30000,()=>{upstream.destroy();client.destroy();});
   upstream.once('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
   upstream.on('error',()=>{client.destroy();upstream.destroy();});client.on('error',()=>upstream.destroy());client.once('close',()=>upstream.destroy());
  })().catch(()=>client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'));
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address();if(!address||typeof address==='string')throw Error('Browser proxy did not bind');
 return {port:address.port,close:()=>new Promise<void>(resolve=>{for(const socket of sockets)socket.destroy();server.close(()=>resolve());})};
}
