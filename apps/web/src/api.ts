import type { CommandReceipt, HostCommand, ModelInfo, Snapshot, WorkspaceEvent } from '../../../packages/contracts';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new ApiError(body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? `Request failed (${response.status})`, body.error?.details);
  return body as T;
}

let csrfToken = '';
export let widgetOrigin = 'http://localhost:4318';
let bootstrapPromise: Promise<void> | undefined;
export function bootstrap() {
  return bootstrapPromise ??= fetch('/api/bootstrap', { credentials: 'same-origin' }).then(read<{ csrfToken: string; widgetOrigin?: string }>).then(value => { csrfToken = value.csrfToken; if (value.widgetOrigin) widgetOrigin = value.widgetOrigin; }).catch(error => { bootstrapPromise = undefined; throw error; });
}

async function renewSession(previous: Promise<void> | undefined) {
  if (bootstrapPromise === previous) { bootstrapPromise = undefined; csrfToken = ''; }
  await bootstrap();
}

async function authenticated(send: () => Promise<Response>) {
  await bootstrap();
  const session = bootstrapPromise;
  let response = await send();
  const error = !response.ok ? await response.clone().json().catch(() => null) : null;
  if (response.status === 401 || error?.error?.code === 'AUTH_REQUIRED' || error?.error?.code === 'CSRF_REQUIRED') {
    await renewSession(session);
    response = await send();
  }
  return response;
}

export async function command(type: string, payload: Record<string, unknown> = {}, threadId?: string, commandId: string = crypto.randomUUID()): Promise<CommandReceipt> {
  await bootstrap();
  const command: HostCommand = { id: commandId, type, payload, ...(threadId ? { threadId } : {}) };
  const body = JSON.stringify(command);
  const send = () => fetch('/api/commands', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body });
  const response = await authenticated(async () => { try { return await send(); } catch { return send(); } });
  return read<CommandReceipt>(response);
}

export const getSnapshot = () => authenticated(() => fetch('/api/snapshot', { credentials: 'same-origin', cache: 'no-store' })).then(read<Snapshot>);
export const getSkill=(name:string,options:{path?:string;revision?:number;versionOffset?:number;includeInactive?:boolean}={})=>{const query=new URLSearchParams(Object.entries(options).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])).toString();return authenticated(()=>fetch(`/api/skills/${encodeURIComponent(name)}${query?'?'+query:''}`,{credentials:'same-origin',cache:'no-store'})).then(read<import('../../../packages/contracts/skills.ts').SkillDetail>);};
export const getSkillProposal=(id:string)=>authenticated(()=>fetch(`/api/skill-proposals/${encodeURIComponent(id)}`,{credentials:'same-origin',cache:'no-store'})).then(read<import('../../../packages/contracts/skills.ts').SkillProposal>);
export const getModels = (refresh = false, threadId?: string) => {
  const query = new URLSearchParams({ ...(refresh ? { refresh: '1' } : {}), ...(threadId ? { threadId } : {}) }).toString();
  return authenticated(() => fetch(`/api/models${query ? `?${query}` : ''}`, { credentials: 'same-origin', cache: 'no-store' })).then(read<{ models: ModelInfo[]; error?: string }>);
};
export const getSource = (id: string) => authenticated(() => fetch(`/api/artifacts/${encodeURIComponent(id)}/source`, { credentials: 'same-origin' })).then(async response => { if (!response.ok) throw new Error('Source could not be loaded.'); return response.text(); });
export interface ResourceTree { path: string; entries: { name: string; path: string; kind: 'file' | 'directory'; bytes: number }[]; truncated: boolean }
export const getResourceTree = (id: string, path = '') => authenticated(() => fetch(`/api/resources/${encodeURIComponent(id)}/tree${path ? '?path=' + encodeURIComponent(path) : ''}`, { credentials: 'same-origin', cache: 'no-store' })).then(read<ResourceTree>);
export const getResourceContent = (id: string, path = '', signal?: AbortSignal) => authenticated(() => fetch(`/api/resources/${encodeURIComponent(id)}/content${path ? '?path=' + encodeURIComponent(path) : ''}`, { credentials: 'same-origin', cache: 'no-store', signal, redirect: 'error' }));
export const getWidgetMount = (id: string) => authenticated(() => fetch(`/api/artifacts/${encodeURIComponent(id)}/mount`, { credentials: 'same-origin', cache: 'no-store' })).then(read<{ url: string; token: string; mountId: string; revision: number }>);
type CredentialScope={artifactId:string;threadId:string;revision:number};
export type CredentialMetadata={present:boolean;version:number;expiresAt:number|null};
const credentialPath=(scope:CredentialScope,key:string)=>`/api/artifacts/${encodeURIComponent(scope.artifactId)}/credentials/${encodeURIComponent(key)}`;
export const getCredentialSlot=(scope:CredentialScope,key:string)=>authenticated(()=>fetch(credentialPath(scope,key)+'?'+new URLSearchParams({threadId:scope.threadId,artifactRevision:String(scope.revision)}),{credentials:'same-origin',cache:'no-store',redirect:'error'})).then(read<CredentialMetadata>);
export const saveCredentialSlot=(scope:CredentialScope,key:string,token:string,version:number)=>authenticated(()=>fetch(credentialPath(scope,key),{method:'PUT',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({threadId:scope.threadId,artifactRevision:scope.revision,token,version})})).then(read<CredentialMetadata>);
export const removeCredentialSlot=(scope:CredentialScope,key:string,version:number)=>authenticated(()=>fetch(credentialPath(scope,key),{method:'DELETE',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({threadId:scope.threadId,artifactRevision:scope.revision,version})})).then(read<CredentialMetadata>);

export function subscribe(after: number, accept: (event: WorkspaceEvent) => void, connectivity: (online: boolean) => void, reconnect: () => Promise<void> = async () => {}) {
  const desktop=window.harnessDesktop;
  if(desktop?.onWorkspaceChanged){
    let closed=false,pending=false,again=false,connected=true,retry=250,timer:ReturnType<typeof setTimeout>|undefined;
    const resync=async()=>{
      if(closed||!connected)return;
      if(pending){again=true;return;}pending=true;
      clearTimeout(timer);
      try{do{again=false;await reconnect();retry=250;if(!closed&&connected)connectivity(true);}while(again&&!closed&&connected);}
      catch{if(!closed){connectivity(false);if(connected){timer=setTimeout(()=>void resync(),retry);retry=Math.min(retry*2,5000);}}}
      finally{pending=false;}
    };
    const remove=desktop.onWorkspaceChanged(change=>{if(closed)return;connected=change.connected;connectivity(connected);if(connected)void resync();else clearTimeout(timer);});
    // Register before refreshing so a change between the initial snapshot and
    // this subscription cannot be missed. No persistent renderer socket opens.
    void resync();
    return()=>{closed=true;clearTimeout(timer);remove();};
  }
  let source: EventSource;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = after;
  const receive = (message: MessageEvent<string>) => {
    try {
      const event = JSON.parse(message.data) as WorkspaceEvent;
      if (!Number.isSafeInteger(event.seq) || event.seq <= sequence) return;
      sequence = event.seq;
      accept(event);
    } catch { /* An invalid event cannot replace the last durable snapshot. */ }
  };
  const connect = () => {
    if (closed) return;
    source = new EventSource(`/api/events?after=${sequence}`);
    source.onopen = () => connectivity(true);
    source.onerror = () => {
      source.close(); connectivity(false);
      const session = bootstrapPromise;
      const recover = async () => {
        try { await renewSession(session); await reconnect(); if (!closed) connect(); }
        catch { if (!closed) timer = setTimeout(() => { void recover(); }, 2000); }
      };
      if (!closed) timer = setTimeout(() => { void recover(); }, 500);
    };
    source.onmessage = receive;
    source.addEventListener('workspace', receive as EventListener);
  };
  connect();
  return () => { closed = true; clearTimeout(timer); source.close(); };
}
