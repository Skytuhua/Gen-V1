import { z } from 'zod';
import type { CommandReceipt, HostCommand, Message, ModelInfo, Snapshot, WorkspaceEvent } from '../../../packages/contracts';
import type {AccountAuthTarget} from '../../../packages/contracts/authentication';
import {networkProxyPublicStateSchema,type NetworkProxyDelete,type NetworkProxySave} from '../../../packages/contracts/network-proxy';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

// A same-origin endpoint bug or hostile response must not grow renderer memory
// without bound; legitimate snapshot/message pages stay far below this cap.
const MAX_JSON_BYTES = 64 * 1024 * 1024;
async function readJson(response: Response): Promise<unknown> {
  const body = response.body;
  if (!body) return await response.json();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { await reader.cancel(); throw new ApiError('RESPONSE_TOO_LARGE', `Response exceeded ${MAX_JSON_BYTES} bytes.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function read<T>(response: Response): Promise<T> {
  if (response.ok) return await readJson(response) as T;
  const body = await readJson(response).catch((cause: unknown) => {
    if (cause instanceof SyntaxError) return null;
    throw cause;
  });
  const failure = body as { error?: { code?: string; message?: string; details?: unknown } } | null;
  throw new ApiError(failure?.error?.code ?? 'HTTP_ERROR', failure?.error?.message ?? `Request failed (${response.status})`, failure?.error?.details);
}

const invalidResponse = () => new ApiError('INVALID_RESPONSE', 'The host returned an unexpected response.');
function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}
const readSchema = <T>(schema: z.ZodType<T>) => async (response: Response): Promise<T> => parseResponse(schema, await read<unknown>(response));

const nonEmpty = z.string().min(1);
const bootstrapSchema = z.object({ csrfToken: nonEmpty, widgetOrigin: nonEmpty.optional() });
const commandReceiptSchema = z.object({
  commandId: nonEmpty, result: z.unknown(),
  // The host emits eventSeq; some older harnesses and fixtures alias it as seq.
  eventSeq: z.number().int().optional(), seq: z.number().int().optional(),
}).refine(value => 'result' in value && (value.eventSeq !== undefined || value.seq !== undefined));
const widgetMountSchema = z.object({
  url: z.string().refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }),
  token: nonEmpty, mountId: nonEmpty, revision: z.number().int().nonnegative(),
});
const credentialMetadataSchema = z.object({ present: z.boolean(), version: z.number().int().nonnegative(), expiresAt: z.number().nullable() });
const composerPredictionSchema = z.object({ suggestion: z.string().nullable(), replyId: nonEmpty, modelId: nonEmpty });
const modelInfoSchema = z.object({ id: nonEmpty, provider: nonEmpty, name: nonEmpty, thinkingLevels: z.array(z.string()).optional() });
const modelsResponseSchema = z.object({ models: z.array(modelInfoSchema), error: z.string().optional() });
const resourceTreeSchema = z.object({
  path: z.string(),
  entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'directory']), bytes: z.number() })),
  truncated: z.boolean(),
});
const messageSchema = z.object({ id: nonEmpty, threadId: nonEmpty, role: z.enum(['user', 'assistant', 'activity']), content: z.string(), createdAt: z.string(), runId: z.string().nullable() });
const threadMessagesSchema = z.object({ messages: z.array(messageSchema), truncated: z.number() });
const threadSearchSchema = z.object({ threadIds: z.array(nonEmpty) });
const shellSettingsSchema = z.object({ theme: z.enum(['light', 'dark', 'system']), preferences: z.record(z.string(), z.unknown()).optional() });
const snapshotSchema = z.looseObject({
  seq: z.number(), threads: z.array(z.unknown()), messages: z.array(z.unknown()), artifacts: z.array(z.unknown()),
  userStates: z.array(z.unknown()), data: z.array(z.unknown()), requests: z.array(z.unknown()),
  operations: z.array(z.unknown()), resources: z.array(z.unknown()), usage: z.record(z.string(), z.unknown()),
  settings: z.looseObject({}), activeThreadId: z.string().nullable(),
});

export let csrfToken = '';
export let widgetOrigin = 'http://localhost:4318';
let bootstrapPromise: Promise<void> | undefined;
// Desktop windows carry a per-boot launch secret in the URL fragment; it is
// exchanged once for the session cookie and never sent in requests itself.
function launchToken(): string | undefined {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('launch');
    return token && /^[a-f0-9]{32,128}$/i.test(token) ? token : undefined;
  } catch { return undefined; }
}
export function bootstrap() {
  const token = launchToken(), headers = token ? { 'x-harness-launch': token } : undefined;
  return bootstrapPromise ??= fetch('/api/bootstrap', { credentials: 'same-origin', ...(headers ? { headers } : {}) }).then(readSchema(bootstrapSchema)).then(value => { csrfToken = value.csrfToken; if (value.widgetOrigin) widgetOrigin = value.widgetOrigin; }).catch(error => { bootstrapPromise = undefined; throw error; });
}

async function renewSession(previous: Promise<void> | undefined) {
  if (bootstrapPromise === previous) { bootstrapPromise = undefined; csrfToken = ''; }
  await bootstrap();
}

export async function authenticated(send: () => Promise<Response>) {
  await bootstrap();
  const session = bootstrapPromise;
  let response = await send();
  const errorBody = (!response.ok ? await readJson(response.clone()).catch(() => null) : null) as { error?: { code?: string } } | null;
  if (response.status === 401 || errorBody?.error?.code === 'AUTH_REQUIRED' || errorBody?.error?.code === 'CSRF_REQUIRED') {
    await renewSession(session);
    response = await send();
  }
  return response;
}

export async function command(type: string, payload: Record<string, unknown> = {}, threadId?: string, commandId: string = crypto.randomUUID(), isCurrent?: () => boolean): Promise<CommandReceipt> {
  await bootstrap();
  const command: HostCommand = { id: commandId, type, payload, ...(threadId ? { threadId } : {}) };
  const body = JSON.stringify(command);
  const send = () => {
    if (isCurrent && !isCurrent()) throw Error('The command owner changed. Retry from the current view.');
    return fetch('/api/commands', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body });
  };
  const response = await authenticated(async () => { try { return await send(); } catch { return send(); } });
  return readSchema(commandReceiptSchema)(response) as Promise<CommandReceipt>;
}

export const getSnapshot = () => authenticated(() => fetch('/api/snapshot', { credentials: 'same-origin', cache: 'no-store' })).then(async response => parseResponse(snapshotSchema, await read<unknown>(response)) as unknown as Snapshot);
export const getShellSettings = () => authenticated(() => fetch('/api/shell-settings', { credentials: 'same-origin', cache: 'no-store' })).then(readSchema(shellSettingsSchema)) as Promise<Pick<Snapshot['settings'],'theme'|'preferences'>>;
export interface ComposerPrediction { suggestion: string | null; replyId: string; modelId: string }
export function getComposerPrediction(input: { threadId: string; replyId: string; modelId: string }, signal: AbortSignal) {
  return authenticated(() => fetch('/api/composer-prediction', { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'x-harness-csrf': csrfToken }, body: JSON.stringify(input) })).then(readSchema(composerPredictionSchema));
}
export const getSkill=(name:string,options:{path?:string;revision?:number;versionOffset?:number;includeInactive?:boolean}={})=>{const query=new URLSearchParams(Object.entries(options).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])).toString();return authenticated(()=>fetch(`/api/skills/${encodeURIComponent(name)}${query?'?'+query:''}`,{credentials:'same-origin',cache:'no-store'})).then(read<import('../../../packages/contracts/skills.ts').SkillDetail>);};
export const getSkillProposal=(id:string)=>authenticated(()=>fetch(`/api/skill-proposals/${encodeURIComponent(id)}`,{credentials:'same-origin',cache:'no-store'})).then(read<import('../../../packages/contracts/skills.ts').SkillProposal>);
export const getModels = (refresh = false, threadId?: string, signal?: AbortSignal, target?:AccountAuthTarget) => {
  const query = new URLSearchParams({ ...(refresh ? { refresh: '1' } : {}), ...(threadId ? { threadId } : {}), ...(target?{providerId:target.providerId,accountId:target.accountId??''}:{}) }).toString();
  return authenticated(() => fetch(`/api/models${query ? `?${query}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal })).then(readSchema(modelsResponseSchema)) as Promise<{ models: ModelInfo[]; error?: string }>;
};
export interface ResourceTree { path: string; entries: { name: string; path: string; kind: 'file' | 'directory'; bytes: number }[]; truncated: boolean }
export const getResourceTree = (id: string, path = '', signal?: AbortSignal) => authenticated(() => fetch(`/api/resources/${encodeURIComponent(id)}/tree${path ? '?path=' + encodeURIComponent(path) : ''}`, { credentials: 'same-origin', cache: 'no-store', signal })).then(readSchema(resourceTreeSchema));
export const getThreadMessages = (id: string, beforeId?: string, limit = 300) => {
  const query = new URLSearchParams({ ...(beforeId ? { beforeId } : {}), limit: String(limit) }).toString();
  return authenticated(() => fetch(`/api/threads/${encodeURIComponent(id)}/messages?${query}`, { credentials: 'same-origin', cache: 'no-store' })).then(readSchema(threadMessagesSchema)) as Promise<{ messages: Message[]; truncated: number }>;
};
// Deep message search over threads the snapshot windowed; in-window threads are
// already covered by the local matchingThreads scan.
export const searchThreadMessages = (q: string, threadIds: string[], signal?: AbortSignal) => {
  // The endpoint bounds `threads` to 4,000 characters; batch so every id is
  // covered, then union the hits.
  const batches: string[] = [];
  for (const id of threadIds) {
    const last = batches[batches.length - 1];
    if (last === undefined || last.length + id.length + 1 > 3500) batches.push(id);
    else batches[batches.length - 1] = last + ',' + id;
  }
  return Promise.all(batches.map(batch => {
    const query = new URLSearchParams({ q, threads: batch }).toString();
    return authenticated(() => fetch(`/api/threads/search?${query}`, { credentials: 'same-origin', cache: 'no-store', signal })).then(readSchema(threadSearchSchema));
  })).then(pages => ({ threadIds: pages.flatMap(page => page.threadIds) }));
};
export const getResourceContent = (id: string, path = '', signal?: AbortSignal) => authenticated(() => fetch(`/api/resources/${encodeURIComponent(id)}/content${path ? '?path=' + encodeURIComponent(path) : ''}`, { credentials: 'same-origin', cache: 'no-store', signal, redirect: 'error' }));
export const getWidgetMount = async (id: string) => {
  const mount = await authenticated(() => fetch(`/api/artifacts/${encodeURIComponent(id)}/mount`, { credentials: 'same-origin', cache: 'no-store' })).then(readSchema(widgetMountSchema));
  // The mount URL carries the edit token in its fragment; it must stay on the
  // widget origin bootstrap advertised or the credential would leak elsewhere.
  let expected: string, actual: string;
  try { expected = new URL(widgetOrigin).origin; actual = new URL(mount.url).origin; } catch { throw invalidResponse(); }
  if (actual !== expected) throw invalidResponse();
  return mount;
};
type CredentialScope={artifactId:string;threadId:string;revision:number};
export type CredentialMetadata={present:boolean;version:number;expiresAt:number|null};
const credentialPath=(scope:CredentialScope,key:string)=>`/api/artifacts/${encodeURIComponent(scope.artifactId)}/credentials/${encodeURIComponent(key)}`;
export const getCredentialSlot=(scope:CredentialScope,key:string)=>authenticated(()=>fetch(credentialPath(scope,key)+'?'+new URLSearchParams({threadId:scope.threadId,artifactRevision:String(scope.revision)}),{credentials:'same-origin',cache:'no-store',redirect:'error'})).then(readSchema(credentialMetadataSchema));
export const saveCredentialSlot=(scope:CredentialScope,key:string,token:string,version:number)=>authenticated(()=>fetch(credentialPath(scope,key),{method:'PUT',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({threadId:scope.threadId,artifactRevision:scope.revision,token,version})})).then(readSchema(credentialMetadataSchema));
export const removeCredentialSlot=(scope:CredentialScope,key:string,version:number)=>authenticated(()=>fetch(credentialPath(scope,key),{method:'DELETE',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify({threadId:scope.threadId,artifactRevision:scope.revision,version})})).then(readSchema(credentialMetadataSchema));

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
  let source: EventSource | undefined;
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
    const stream = new EventSource(`/api/events?after=${sequence}`);
    source = stream;
    const isCurrent = () => !closed && source === stream;
    stream.onopen = () => { if (isCurrent()) connectivity(true); };
    stream.onerror = () => {
      if (!isCurrent()) return;
      source = undefined;
      stream.close(); connectivity(false);
      const session = bootstrapPromise;
      const recover = async () => {
        if (closed) return;
        try { await renewSession(session); if (closed) return; await reconnect(); if (!closed) connect(); }
        catch { if (!closed) timer = setTimeout(() => { void recover(); }, 2000); }
      };
      if (!closed) timer = setTimeout(() => { void recover(); }, 500);
    };
    const receiveCurrent = (event: MessageEvent<string>) => { if (isCurrent()) receive(event); };
    stream.onmessage = receiveCurrent;
    stream.addEventListener('workspace', receiveCurrent as EventListener);
  };
  connect();
  return () => { closed = true; clearTimeout(timer); source?.close(); };
}

export interface ToolEffectRecord {
  effectId: string;
  invocationId: string;
  toolId: string;
  state: string;
  publicRedactedSummary: string;
  targetPreconditions: string[];
  approvalId: string | null;
  providerReceiptRef: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { threadId: string; runId: string | null; epoch: number; projectId: string | null; workspaceId: string | null; accountBinding: string | null };
  transitions: { from: string | null; to: string; at: string; note?: string }[];
  outcome?: { value?: unknown; error?: string };
}
export interface ToolEffectApproval { approvalId: string; operationId: string; expiresAt: string; issuedAt: string; remainingUses: number; issuer: string }
export interface ToolEffectObservation { effect: ToolEffectRecord | null; approval: ToolEffectApproval | null; freshness: 'CURRENT' | 'STALE' | 'INDETERMINATE'; coverage: string[] }
export const getToolEffectObservation = async (threadId: string, invocationId: string): Promise<ToolEffectObservation> => {
  const context = await authenticated(() => fetch(`/api/tool-effects/${encodeURIComponent(threadId)}`, { credentials: 'same-origin', cache: 'no-store' })).then(read<{ scopeKey: string; coverage: string[] }>);
  try {
    const observation = await authenticated(() => fetch(`/api/tool-effects/${encodeURIComponent(threadId)}/observations?` + new URLSearchParams({ scopeKey: context.scopeKey, invocationId }), { credentials: 'same-origin', cache: 'no-store' })).then(read<{ effect: ToolEffectRecord; approval: ToolEffectApproval | null; freshness: ToolEffectObservation['freshness'] }>);
    return { ...observation, coverage: context.coverage };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND')
      return { effect: null, approval: null, freshness: 'INDETERMINATE', coverage: context.coverage };
    throw error;
  }
};
// #1531 T05 — profile network proxy management (authenticated, no-store).
export const getNetworkProxy=()=>authenticated(()=>fetch('/api/network-proxy',{credentials:'same-origin',cache:'no-store',redirect:'error'})).then(readSchema(networkProxyPublicStateSchema));
export const saveNetworkProxy=(input:NetworkProxySave)=>authenticated(()=>fetch('/api/network-proxy',{method:'PUT',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(input)})).then(readSchema(networkProxyPublicStateSchema));
export const removeNetworkProxy=(input:NetworkProxyDelete)=>authenticated(()=>fetch('/api/network-proxy',{method:'DELETE',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','x-harness-csrf':csrfToken},body:JSON.stringify(input)})).then(readSchema(networkProxyPublicStateSchema));
