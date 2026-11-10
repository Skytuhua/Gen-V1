// Explicit same-host trusted owner transport. No browser, CLI, engine or reconnect loop.
import {X509Certificate} from 'node:crypto';
import {request as httpsRequest} from 'node:https';
import type {ClientRequest, IncomingMessage} from 'node:http';
import {canonicalBytes, decodeBoundedJson} from '../company-contracts/communications/json.ts';
import {snapshotReadContext, type ReadContext} from '../company-contracts/communications/reads.ts';
import {captureOwnerDiscussionStreamState, normalizeOwnerDiscussionStreamRequest, validateOwnerDiscussionChanges,
  projectOwnerDiscussionChanges, type OwnerDiscussionChangesState, type OwnerDiscussionChangesResult} from '../company-contracts/communications/owner-discussion-stream.ts';
import {OwnerDiscussionSSEParser} from './owner-discussion-sse-parser.ts';
import type {OwnerDiscussionStreamClientOptions} from './owner-discussion-stream.ts';

export const OWNER_DISCUSSION_SSE_PIN = Object.freeze({backendCheckpoint:'3c2ec7acf393f86a59a4c70aaec672fb8bc34d80',
  descriptorSHA256:'2e2460b26be8463b671296590c2963bd68387a55ac133ab985b189387511b7c1', maximumFrameBytes:65536});
const wireErrors = Object.freeze({400:'INVALID_REQUEST',401:'AUTHENTICATION_REQUIRED',403:'SCOPE_DENIED',404:'NOT_FOUND',409:'RESYNC_REQUIRED',410:'RESYNC_REQUIRED',503:'RECORDS_UNAVAILABLE'} as const);
type WireStatus = keyof typeof wireErrors;
type WireCode = typeof wireErrors[WireStatus];
export type OwnerDiscussionSSEErrorCode = WireCode | 'CONFIG' | 'REQUEST' | 'TIMEOUT' | 'TRANSPORT' | 'RESPONSE';
export class OwnerDiscussionSSEError extends Error {
  readonly requiresSnapshot: boolean;
  constructor(readonly code: OwnerDiscussionSSEErrorCode, readonly status?: WireStatus) {
    super(code); this.name='OwnerDiscussionSSEError'; this.requiresSnapshot=code==='RESYNC_REQUIRED';
  }
}
export type OwnerDiscussionSSEEvent =
  {readonly kind:'comment'; readonly comment:'connected'|'keepalive'; readonly rawFrame:Uint8Array} |
  {readonly kind:'changes'; readonly result:OwnerDiscussionChangesResult; readonly rawFrame:Uint8Array};
export interface OwnerDiscussionSSEOpenOptions {signal:AbortSignal; projection?:OwnerDiscussionChangesState}
function object(v:unknown):v is Record<string,unknown> {return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function same(a:unknown,b:unknown):boolean {return Buffer.from(canonicalBytes(a)).equals(Buffer.from(canonicalBytes(b)));}
function closedError(raw:Uint8Array):WireCode {
  const value=decodeBoundedJson(raw,262144);
  if(!object(value)||Object.keys(value).sort().join(',')!=='error,schema_version'||value.schema_version!==1||!object(value.error)||Object.keys(value.error).join(',')!=='code'||!Object.values(wireErrors).includes(value.error.code as WireCode))throw new OwnerDiscussionSSEError('RESPONSE');
  return value.error.code as WireCode;
}
function reflected(value:unknown,token:string):boolean {
  if(typeof value==='string')return value.includes(token);
  return !!value&&typeof value==='object'&&Object.entries(value).some(([key,child])=>key.includes(token)||reflected(child,token));
}

export class OwnerDiscussionSSEClient {
  #port:number; #ca:Buffer; #credential:OwnerDiscussionStreamClientOptions['credential']; #timeoutMs:number;
  constructor(options:OwnerDiscussionStreamClientOptions) {
    try {
      if(!object(options)||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!['origin','role','credential','ca','timeoutMs'].includes(k)))throw 0;
      const {origin,role,credential,ca,timeoutMs=3000}=options;
      const match=typeof origin==='string'&&/^https:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(origin);
      if(!match||Number(match[1])>65535||role!=='owner'||typeof credential!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw 0;
      if(typeof ca!=='string'&&!Buffer.isBuffer(ca))throw 0;
      const trust=Buffer.from(ca); if(!trust.length)throw 0; new X509Certificate(trust);
      this.#port=Number(match[1]);this.#ca=trust;this.#credential=credential;this.#timeoutMs=timeoutMs;
    }catch {throw new OwnerDiscussionSSEError('CONFIG');}
  }
  get role():'owner' {return 'owner';}

  /** Capture independently permitted state synchronously; next() explicitly starts I/O.
   * Abort cancels a pending read; break/return at a yielded value closes in finally.
   * Abort before returning an iterator with an already pending next(). No reset/retry.
   * Keep the last yielded result.state; partial bytes and comments never advance it. */
  open(expected:ReadContext,from:OwnerDiscussionChangesState,options:OwnerDiscussionSSEOpenOptions):AsyncGenerator<OwnerDiscussionSSEEvent,void> {
    try {
      if(!object(options)||Reflect.ownKeys(options).some(k=>typeof k!=='string'||!['signal','projection'].includes(k))||!(options.signal instanceof AbortSignal))throw 0;
      const context=snapshotReadContext(expected),state=captureOwnerDiscussionStreamState(from,context);
      const latest=options.projection===undefined?state:captureOwnerDiscussionStreamState(options.projection,context);
      if(state.mode!=='changes'||latest.mode!=='changes'||state.requestedLimit!==latest.requestedLimit||!same(state.snapshot,latest.snapshot)||!same(state.baseline,latest.baseline)||latest.position<state.position)throw 0;
      normalizeOwnerDiscussionStreamRequest('changes',context,state.requestedLimit,state.nextCursor);
      return this.#read(context,state,latest,options.signal);
    }catch {throw new OwnerDiscussionSSEError('REQUEST');}
  }

  async *#read(context:ReadContext,from:OwnerDiscussionChangesState,latest:OwnerDiscussionChangesState,signal:AbortSignal):AsyncGenerator<OwnerDiscussionSSEEvent,void> {
    if(signal.aborted)return;
    let pending:ClientRequest|undefined,response:IncomingMessage|undefined,close:Promise<void>|undefined;
    const cancelled=Symbol('cancelled'); let interrupt!:(reason:unknown)=>void;
    const interrupted=new Promise<never>((_,reject)=>{interrupt=reject;}); void interrupted.catch(()=>{});
    let timedOut=false;
    const abort=()=>{interrupt(cancelled);response?.destroy();pending?.destroy();};
    const deadline=performance.now()+this.#timeoutMs;
    const timer=setTimeout(()=>{timedOut=true;interrupt(new OwnerDiscussionSSEError('TIMEOUT'));response?.destroy();pending?.destroy();},this.#timeoutMs);
    signal.addEventListener('abort',abort,{once:true});
    try {
      if(signal.aborted)return;
      const credential=Promise.resolve().then(()=>{if(signal.aborted)throw cancelled;return this.#credential();}).catch(()=>{throw new OwnerDiscussionSSEError('AUTHENTICATION_REQUIRED');});
      const token=await Promise.race([credential,interrupted]);
      if(signal.aborted)return;
      if(performance.now()>=deadline)throw new OwnerDiscussionSSEError('TIMEOUT');
      if(typeof token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(token))throw new OwnerDiscussionSSEError('AUTHENTICATION_REQUIRED');
      const query=`limit=${from.requestedLimit}&cursor=${from.nextCursor}`;
      if(query.length>4160)throw new OwnerDiscussionSSEError('REQUEST');
      response=await Promise.race([new Promise<IncomingMessage>((resolve,reject)=>{
        pending=httpsRequest({hostname:'127.0.0.1',port:this.#port,method:'GET',path:`/company/v1/projects/${context.scope.id}/owner-discussion/events?${query}`,
          ca:this.#ca,rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false,maxHeaderSize:16384,
          headers:{Host:`127.0.0.1:${this.#port}`,Authorization:`Bearer ${token}`,Accept:'text/event-stream',Connection:'close'}},resolve);
        close=new Promise<void>(resolveClosed=>pending!.once('close',resolveClosed));
        pending.once('error',()=>reject(new OwnerDiscussionSSEError('TRANSPORT'))); pending.end();
      }),interrupted]);
      if(performance.now()>=deadline)throw new OwnerDiscussionSSEError('TIMEOUT');
      const status=response.statusCode??0,code=wireErrors[status as WireStatus],counts=new Map<string,number>();
      for(let i=0;i<response.rawHeaders.length;i+=2){const name=response.rawHeaders[i].toLowerCase();counts.set(name,(counts.get(name)??0)+1);}
      if(counts.get('content-type')!==1||counts.has('content-encoding')||counts.has('transfer-encoding'))throw new OwnerDiscussionSSEError('RESPONSE');
      if(status!==200){
        if(!code||!/^application\/json;\s*charset=utf-8$/i.test(response.headers['content-type']??'')||(counts.get('content-length')??0)>1)throw new OwnerDiscussionSSEError('RESPONSE');
        const length=response.headers['content-length'];
        if(length!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>262144))throw new OwnerDiscussionSSEError('RESPONSE');
        const chunks:Buffer[]=[];let size=0;
        for await(const raw of response){const chunk=Buffer.from(raw);size+=chunk.length;if(size>262144)throw new OwnerDiscussionSSEError('RESPONSE');chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        if(performance.now()>=deadline)throw new OwnerDiscussionSSEError('TIMEOUT');
        if(!response.complete||length!==undefined&&bytes.length!==Number(length)||closedError(bytes)!==code)throw new OwnerDiscussionSSEError('RESPONSE');
        throw new OwnerDiscussionSSEError(code,status as WireStatus);
      }
      if(response.httpVersion!=='1.0'||counts.has('content-length')||!/^text\/event-stream;\s*charset=utf-8$/i.test(response.headers['content-type']??'')||counts.get('cache-control')!==1||response.headers['cache-control']!=='no-store, no-transform'||counts.get('connection')!==1||response.headers.connection!=='close')throw new OwnerDiscussionSSEError('RESPONSE');
      clearTimeout(timer); // Establishment is bounded; live lifetime belongs to explicit caller abort.
      const parser=new OwnerDiscussionSSEParser();let connected=false;
      for await(const raw of response){
        if(signal.aborted)return;
        for(const frame of parser.push(Buffer.from(raw))){
          if(signal.aborted)return;
          if(frame.kind==='comment'){
            if(frame.comment==='connected'?connected:!connected)throw new OwnerDiscussionSSEError('RESPONSE');
            connected=true; yield Object.freeze({kind:'comment',comment:frame.comment,rawFrame:frame.rawFrame});continue;
          }
          if(!connected)throw new OwnerDiscussionSSEError('RESPONSE');
          if(frame.kind==='control'){
            const control=closedError(frame.data);
            if(!Buffer.from(canonicalBytes({schema_version:1,error:{code:control}})).equals(Buffer.from(frame.data)))throw new OwnerDiscussionSSEError('RESPONSE');
            throw new OwnerDiscussionSSEError(control);
          }
          const request=normalizeOwnerDiscussionStreamRequest('changes',context,from.requestedLimit,from.nextCursor);
          const validated=await validateOwnerDiscussionChanges(frame.data,context,request,from);
          if(frame.id!==validated.page.next_cursor||!validated.page.items.length||!Buffer.from(canonicalBytes(validated.page)).equals(Buffer.from(frame.data)))throw new OwnerDiscussionSSEError('RESPONSE');
          const projected=await projectOwnerDiscussionChanges(latest,validated);
          if(signal.aborted)return;
          if(reflected(projected,token))throw new OwnerDiscussionSSEError('RESPONSE');
          from=validated.state;latest=projected.state;
          yield Object.freeze({kind:'changes',result:projected,rawFrame:frame.rawFrame});
        }
      }
      parser.finish(); // Discard incomplete tail, retaining only prior yielded state.
    }catch(error){
      if(error instanceof OwnerDiscussionSSEError&&Object.values(wireErrors).includes(error.code as WireCode))throw error;
      if(signal.aborted)return;
      if(timedOut)throw new OwnerDiscussionSSEError('TIMEOUT');
      if(error instanceof OwnerDiscussionSSEError)throw error;
      throw new OwnerDiscussionSSEError(response?'RESPONSE':'TRANSPORT');
    }finally{
      clearTimeout(timer);signal.removeEventListener('abort',abort);response?.destroy();pending?.destroy();if(close)await close;
    }
  }
}
