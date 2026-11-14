import {authenticated, read} from '../api';
import type {ContentQuery, HistoryPage, HistoryQuery, InventoryPage, InventoryQuery, InventoryUpdates, MessageSlice, UpdatesQuery} from '../../../../packages/contracts/agent-inventory';

export interface AgentTransport {
 inventory(query: InventoryQuery, signal: AbortSignal): Promise<InventoryPage>;
 history(query: HistoryQuery, signal: AbortSignal): Promise<HistoryPage>;
 content(query: ContentQuery, signal: AbortSignal): Promise<MessageSlice>;
 updates(query: UpdatesQuery, signal: AbortSignal): Promise<InventoryUpdates>;
 events(query: UpdatesQuery, accept: (update: InventoryUpdates) => void, signal: AbortSignal): Promise<void>;
}
export function agentQuery(query: object): string {
 const params = new URLSearchParams();
 for (const [key, value] of Object.entries(query)) {
  if (value === undefined || Array.isArray(value) && !value.length) continue;
  params.set(key === 'statuses' ? 'status' : key === 'visibleAgentIds' ? 'visible' : key, value === null ? '' : Array.isArray(value) ? value.join(',') : String(value));
 }
 return params.toString();
}
async function request(path: string, query: object, signal: AbortSignal) {
 return authenticated(() => fetch(`/api/agents${path}?${agentQuery(query)}`, {credentials: 'same-origin', cache: 'no-store', signal}));
}

/** Fetch streams share the host's session renewal; no legacy snapshot/event channel. */
export const personalAgentTransport: AgentTransport = {
 inventory: (query, signal) => request('', query, signal).then(read<InventoryPage>),
 history: (query, signal) => request('/history', query, signal).then(read<HistoryPage>),
 content: (query, signal) => request('/content', query, signal).then(read<MessageSlice>),
 updates: (query, signal) => request('/updates', query, signal).then(read<InventoryUpdates>),
 async events(query, accept, signal) {
  const response = await request('/events', query, signal);
  if (!response.ok) {await read(response); return;}
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('Live updates are unavailable. Retry connection.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
   while (!signal.aborted) {
    const {value, done} = await reader.read(); if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
     const frame = buffer.slice(0, end), boundary = buffer.slice(end).match(/^\r?\n\r?\n/)![0]; buffer = buffer.slice(end + boundary.length);
     const lines = frame.split(/\r?\n/), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
     if (event !== 'agents') continue;
     const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
     if (data && !signal.aborted) {let update: InventoryUpdates; try {update = JSON.parse(data) as InventoryUpdates;} catch {continue;} accept(update);}
    }
   }
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
 },
};
