import {digest,type Store} from '../storage/store.ts';
import {HarnessError,type ArtifactRecord,type Thread} from '../contracts/index.ts';

export type CredentialScope={artifactId:string;threadId:string;revision:number};
export type CredentialMetadata={present:boolean;version:number;expiresAt:number|null};
type Slot=CredentialScope&{slotKey:string;declaration:string;bytes:Buffer;expiresAt:number};
const unavailable=()=>new HarnessError('CAPABILITY_DENIED','This credential slot is unavailable. Refresh the interface.');
const validKey=(value:string)=>/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);

/** No credential read API exists. Native entry is isolated from task projections,
 * command receipts, inference and external execution. All bytes die with this host. */
export class SessionCredentials{
  private slots=new Map<string,Slot>();
  private versions=new Map<string,number>();
  private unsubscribe:()=>void;
  private closed=false;
  private expiryTimer:ReturnType<typeof setTimeout>|undefined;
  constructor(private store:Store,private now=Date.now){
    this.unsubscribe=store.subscribe(event=>{if(['ui_present','ui_close','artifact.archive','thread.archive'].includes(event.type))this.reconcile();});
  }
  private key(scope:CredentialScope,slotKey:string){return JSON.stringify([scope.threadId,scope.artifactId,slotKey]);}
  private declaration(scope:CredentialScope,slotKey:string,exact=true):string{
    if(this.closed||!validKey(slotKey))throw unavailable();
    const artifact=this.store.get<ArtifactRecord>('artifact',scope.artifactId),thread=this.store.get<Thread>('thread',scope.threadId);
    if(!thread||this.store.get('archivedThread',scope.threadId)||!artifact||artifact.threadId!==scope.threadId||artifact.lifecycle!=='active'||artifact.kind!=='structured')throw unavailable();
    if(exact&&artifact.revision!==scope.revision)throw new HarnessError('STALE_REVISION','The interface changed. Refresh before entering a credential.');
    const nodes=Object.values(artifact.spec?.elements??{}).filter(node=>node.type==='CredentialEntry'&&node.props.slotKey===slotKey);
    if(nodes.length!==1)throw unavailable();
    const props=nodes[0].props;if(typeof props.service!=='string'||typeof props.label!=='string')throw unavailable();
    return digest({slotKey,service:props.service,label:props.label,purpose:props.purpose??null});
  }
  private clear(key:string){const slot=this.slots.get(key);if(!slot)return;slot.bytes.fill(0);this.slots.delete(key);this.versions.set(key,(this.versions.get(key)??0)+1);}
  private scheduleExpiry(){
    clearTimeout(this.expiryTimer);this.expiryTimer=undefined;
    if(this.closed||!this.slots.size)return;
    const next=Math.min(...[...this.slots.values()].map(slot=>slot.expiresAt));
    this.expiryTimer=setTimeout(()=>{this.expiryTimer=undefined;this.reconcile();},Math.max(1,next-this.now()));
    this.expiryTimer.unref?.();
  }
  private reconcile(){for(const [key,slot]of this.slots){try{if(slot.expiresAt<=this.now()||this.declaration(slot,slot.slotKey,false)!==slot.declaration)this.clear(key);}catch{this.clear(key);}}this.scheduleExpiry();}
  status(scope:CredentialScope,slotKey:string):CredentialMetadata{
    this.declaration(scope,slotKey);this.reconcile();const key=this.key(scope,slotKey),slot=this.slots.get(key);
    return {present:Boolean(slot),version:this.versions.get(key)??0,expiresAt:slot?.expiresAt??null};
  }
  save(scope:CredentialScope,slotKey:string,token:string,version:number):CredentialMetadata{
    const declaration=this.declaration(scope,slotKey),status=this.status(scope,slotKey),key=this.key(scope,slotKey);
    if(!Number.isSafeInteger(version)||version!==status.version)throw new HarnessError('CREDENTIAL_CHANGED','This credential changed in another window. Refresh its status.');
    if(typeof token!=='string'||!token.trim()||Buffer.byteLength(token)>8192||/[\u0000-\u001f\u007f]/.test(token))throw new HarnessError('INVALID_INPUT','Enter a token within the supported size limit.');
    if((!this.slots.has(key)&&this.slots.size>=100)||(!this.versions.has(key)&&this.versions.size>=500))throw new HarnessError('CREDENTIAL_LIMIT','The host session credential limit has been reached.');
    this.slots.get(key)?.bytes.fill(0);this.slots.set(key,{...scope,slotKey,declaration,bytes:Buffer.from(token,'utf8'),expiresAt:this.now()+3600000});this.versions.set(key,status.version+1);
    return this.status(scope,slotKey);
  }
  remove(scope:CredentialScope,slotKey:string,version:number):CredentialMetadata{
    const status=this.status(scope,slotKey);if(!Number.isSafeInteger(version)||version!==status.version)throw new HarnessError('CREDENTIAL_CHANGED','This credential changed in another window. Refresh its status.');
    this.clear(this.key(scope,slotKey));return this.status(scope,slotKey);
  }
  dispose(){if(this.closed)return;this.unsubscribe();clearTimeout(this.expiryTimer);this.expiryTimer=undefined;for(const key of this.slots.keys())this.clear(key);this.versions.clear();this.closed=true;}
}
