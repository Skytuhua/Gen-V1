import {inventoryUpdateDisposition, type AgentScope, type AgentSummary, type InventoryUpdates, type MessageSlice} from '../../../../packages/contracts/agent-inventory';
import {personalAgentTransport, type AgentTransport} from './transport';
import {ApiError} from '../api';

export interface AgentNode {agent: AgentSummary; children: AgentNode[]}
export interface ProjectRow {id: string | null; name: string; parents: AgentNode[]}
export function groupAgents(agents: readonly AgentSummary[]): ProjectRow[] {
 const nodes = new Map(agents.map(agent => [agent.agentId, {agent, children: []} as AgentNode])), projects = new Map<string | null, ProjectRow>();
 for (const node of nodes.values()) {
  const parent = node.agent.parentId && nodes.get(node.agent.parentId);
  // Malformed legacy ancestry stays reachable instead of creating an invisible cycle.
  const visited = new Set([node.agent.agentId]); let ancestor = parent;
  while (ancestor && !visited.has(ancestor.agent.agentId)) {visited.add(ancestor.agent.agentId); ancestor = ancestor.agent.parentId && nodes.get(ancestor.agent.parentId);}
  if (parent && !ancestor) {parent.children.push(node); continue;}
  const id = node.agent.projectId;
  if (!projects.has(id)) projects.set(id, {id, name: node.agent.projectName || 'No project', parents: []});
  projects.get(id)!.parents.push(node);
 }
 const sort = (list: AgentNode[]) => {list.sort((a, b) => a.agent.orderKey.localeCompare(b.agent.orderKey) || a.agent.agentId.localeCompare(b.agent.agentId)); list.forEach(node => sort(node.children));};
 for (const project of projects.values()) sort(project.parents);
 return [...projects.values()].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
}
export function visibleLease(ids: readonly string[], offset: number): string[] {
 const unique = [...new Set(ids)];
 if (unique.length <= 24) return unique;
 return Array.from({length: 24}, (_, i) => unique[(offset + i) % unique.length]);
}
export interface TranscriptState {messages: MessageSlice[]; cursor: string | null; gaps: {beforeId: string; cursor: string}[]; sequence: number; pending: boolean; error: string; loaded: boolean}
export interface ViewState {top: number; left: number; atEnd: boolean; collapsed: boolean; unread: boolean; focus?: 'composer' | 'transcript'; anchorId?: string; anchorOffset?: number}
export interface AgentsWorkspaceState {agents: AgentSummary[]; scope: AgentScope; scopeKey: string; sequence: number; pending: boolean; connected: boolean; error: string; version: number}
const emptyTranscript = (): TranscriptState => ({messages: [], cursor: null, gaps: [], sequence: -1, pending: false, error: '', loaded: false});
const personal = (value: {authority: string}) => {if (value.authority !== 'personal') throw Error('This workspace requires a Personal inventory.');};
function mergeInventory(agents: Map<string, AgentSummary>, matching: Set<string>, update: InventoryUpdates) {
 for (const id of update.removed) {agents.delete(id); matching.delete(id);}
 for (const agent of update.upserts) matching.add(agent.agentId);
 for (const agent of [...update.ancestors, ...update.upserts]) if (!agents.has(agent.agentId) || agents.get(agent.agentId)!.revision <= agent.revision) agents.set(agent.agentId, agent);
 const required = new Set(matching);
 for (const id of required) {const parent = agents.get(id)?.parentId; if (parent && agents.has(parent)) required.add(parent);}
 for (const id of agents.keys()) if (!required.has(id)) agents.delete(id);
}

/** One host-owned instance outlives virtual rows. dispose aborts every reader. */
export class AgentsWorkspaceController {
 private state: AgentsWorkspaceState = {agents: [], scope: {}, scopeKey: '', sequence: 0, pending: false, connected: false, error: '', version: 0};
 private listeners = new Set<() => void>();
 private scopeAbort = new AbortController();
 private streamAbort?: AbortController;
 private histories = new Map<string, AbortController>();
 private transcripts = new Map<string, TranscriptState>();
 private matching = new Set<string>();
 private dirty = new Set<string>();
 private views = new Map<string, ViewState>();
 private visible: string[] = [];
 private leased: string[] = [];
 private offset = 0;
 private rotation?: ReturnType<typeof setInterval>;
 private retry?: ReturnType<typeof setTimeout>;
 private ancestorReload?: ReturnType<typeof setTimeout>;
 private lastAncestorReload = 0;
 private disposed = false;
 private paused = false;
 private streamEpoch = 0;
 private queue = Promise.resolve();
 constructor(private transport: AgentTransport = personalAgentTransport) {}
 getSnapshot = () => this.state;
 subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
 private emit(patch: Partial<AgentsWorkspaceState> = {}) {this.state = {...this.state, ...patch, version: this.state.version + 1}; this.listeners.forEach(listener => listener());}
 view(id: string): ViewState {return this.views.get(id) ?? {top: 0, left: 0, atEnd: true, collapsed: false, unread: false};}
 setView(id: string, patch: Partial<ViewState>, notify = false) {this.views.set(id, {...this.view(id), ...patch}); if (notify) this.emit();}
 transcript(id: string): TranscriptState {if (!this.transcripts.has(id)) this.transcripts.set(id, emptyTranscript()); return this.transcripts.get(id)!;}
 start() {this.paused = false; return this.setScope(this.state.scope);}
 pause() {
  this.paused = true; this.scopeAbort.abort(); this.stopStream();
  this.histories.forEach((value, id) => {value.abort(); this.transcript(id).pending = false;}); this.histories.clear(); this.dirty.clear(); this.leased = [];
  if (this.rotation) clearInterval(this.rotation); this.rotation = undefined;
  this.emit({pending: false, connected: false});
 }
 async setScope(scope: AgentScope): Promise<void> {
  if (this.disposed || this.paused) return;
  this.scopeAbort.abort(); this.stopStream(); this.histories.forEach((value, id) => {value.abort(); this.transcript(id).pending = false;}); this.histories.clear(); this.dirty.clear(); this.leased = [];
  const abort = this.scopeAbort = new AbortController();
  this.emit({scope, pending: true, connected: false, error: ''});
  try {
   // Membership-changing mutations invalidate cursors; progress can advance between pages.
   for (let attempt = 0; attempt < 3; attempt++) {
    const agents = new Map<string, AgentSummary>(), cursors = new Set<string>(), matching = new Set<string>();
    let cursor: string | undefined, checkpoint: {scopeKey: string; sequence: number} | undefined, lastSequence = -1, changed = false;
    do {
     let page;
     try {page = await this.transport.inventory({...scope, limit: 100, ...(cursor ? {cursor} : {})}, abort.signal);}
     catch (cause) {if (cursor && cause instanceof ApiError && cause.code === 'RESYNC_REQUIRED') {changed = true; break;} throw cause;}
     if (abort.signal.aborted || this.disposed) return; personal(page);
     if (checkpoint && (checkpoint.scopeKey !== page.scopeKey || page.sequence < lastSequence)) {changed = true; break;}
     checkpoint ??= page;
     lastSequence = page.sequence;
     for (const agent of [...page.ancestors, ...page.items]) if (!agents.has(agent.agentId) || agents.get(agent.agentId)!.revision <= agent.revision) agents.set(agent.agentId, agent);
     for (const agent of page.items) matching.add(agent.agentId);
     cursor = page.nextCursor ?? undefined;
     if (cursor && cursors.has(cursor)) throw Error('Agent paging did not advance. Retry loading.');
     if (cursor) cursors.add(cursor);
    } while (cursor);
    if (changed) continue;
    const update = await this.transport.updates({...scope, scopeKey: checkpoint!.scopeKey, after: checkpoint!.sequence, visibleAgentIds: []}, abort.signal);
    if (abort.signal.aborted || this.disposed) return; personal(update);
    if (update.resync || update.scopeKey !== checkpoint!.scopeKey || update.fromSequence !== checkpoint!.sequence || update.sequence < lastSequence) continue;
    mergeInventory(agents, matching, update);
    this.matching = matching; this.emit({agents: [...agents.values()], scopeKey: checkpoint!.scopeKey, sequence: update.sequence, pending: false});
    this.updateLease(); return;
   }
   throw Error('Agents changed while loading. Retry loading.');
  } catch (cause) {
   if (!abort.signal.aborted && !this.disposed) this.emit({pending: false, error: cause instanceof Error ? cause.message : 'Agents could not load. Retry loading.'});
  }
 }
 setVisible(ids: readonly string[]) {
  const next = [...new Set(ids)];
  if (JSON.stringify(next) === JSON.stringify(this.visible)) return;
  this.visible = next; this.offset = 0;
  if (this.rotation) clearInterval(this.rotation);
  if (this.paused || this.disposed) return;
  this.rotation = next.length > 24 ? setInterval(() => {this.offset += 24; this.updateLease();}, 2000) : undefined;
  this.updateLease();
 }
 private updateLease() {
  if (this.disposed || this.paused || this.state.pending || !this.state.scopeKey) return;
  const available = new Set(this.state.agents.filter(agent => agent.threadId).map(agent => agent.agentId));
  const previous = this.leased;
  this.leased = visibleLease(this.visible.filter(id => available.has(id)), this.offset);
  for (const [id, abort] of this.histories) if (!this.leased.includes(id)) {abort.abort(); this.histories.delete(id); this.dirty.delete(id); this.transcript(id).pending = false;}
  for (const id of this.leased) void this.loadHistory(id, false, !previous.includes(id));
  this.connect();
 }
 private stopStream() {this.streamEpoch++; this.streamAbort?.abort(); if (this.retry) clearTimeout(this.retry);}
 private connect() {
  this.stopStream(); if (this.disposed || this.paused || this.state.pending) return;
  const abort = this.streamAbort = new AbortController(), epoch = this.streamEpoch;
  const query = {...this.state.scope, scopeKey: this.state.scopeKey, after: this.state.sequence, visibleAgentIds: this.leased};
  const active = () => !abort.signal.aborted && !this.disposed && epoch === this.streamEpoch;
  // Visible-set changes and reconnects first catch up from the shared checkpoint.
  void this.transport.updates(query, abort.signal).then(async update => {
   if (!active()) return; await this.accept(update); if (!active()) return;
   this.emit({connected: true});
   await this.transport.events({...query, after: this.state.sequence}, update => {
    this.queue = this.queue.then(async () => {if (active()) await this.accept(update);}).catch(cause => {if (active()) this.emit({error: String(cause)});});
   }, abort.signal);
  }).catch(cause => {if (active()) this.emit({error: cause instanceof Error ? cause.message : 'Live updates disconnected.'});}).finally(() => {
   if (!active()) return; this.emit({connected: false});
   this.retry = setTimeout(() => this.connect(), 1500);
  });
 }
 async accept(update: InventoryUpdates) {
  if (this.disposed || this.state.pending) return; personal(update);
  const disposition = inventoryUpdateDisposition(this.state, update);
  if (disposition === 'stale') return;
  if (disposition === 'resync') {await this.setScope(this.state.scope); return;}
  const agents = new Map(this.state.agents.map(agent => [agent.agentId, agent]));
  mergeInventory(agents, this.matching, update);
  for (const id of update.removed) if (!this.leased.includes(id)) {this.transcripts.delete(id); this.views.delete(id);}
  this.emit({agents: [...agents.values()], sequence: update.sequence});
  const changed = new Set(update.transcripts.map(item => item.agentId));
  for (const id of this.leased) if (agents.has(id) && changed.has(id)) void this.loadHistory(id, false, true);
  // Filtered parents are containers whose transcript invalidation the API omits;
  // coalesce their reloads instead of refetching on every inventory event.
  if (this.leased.some(id => agents.has(id) && !this.matching.has(id))) {
   const fire = () => {
    this.lastAncestorReload = Date.now();
    const current = new Set(this.state.agents.map(agent => agent.agentId));
    for (const id of this.leased) if (current.has(id) && !this.matching.has(id)) void this.loadHistory(id, false, true);
   };
   if (Date.now() - this.lastAncestorReload >= 10_000) fire();
   else { clearTimeout(this.ancestorReload); this.ancestorReload = setTimeout(fire, 1500); }
  }
 }
 loadEarlier(id: string, beforeId?: string) {return this.loadHistory(id, true, false, beforeId);}
 retryHistory(id: string) {return this.loadHistory(id, false, true);}
 private async complete(message: MessageSlice, id: string, signal: AbortSignal): Promise<MessageSlice> {
  let full = {...message}, points = [...message.content].length; const cursors = new Set<string>();
  if (full.contentOffset !== 0) throw Error('Message content is incomplete. Retry history.');
  while (full.nextContentCursor) {
   const cursor = full.nextContentCursor;
   if (cursors.has(cursor)) throw Error('Message content is incomplete. Retry history.'); cursors.add(cursor);
   const part = await this.transport.content({agentId: id, cursor}, signal);
   if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
   if (part.id !== full.id || part.threadId !== full.threadId || part.contentOffset !== points || part.contentLength !== full.contentLength) throw Error('Message changed while loading. Retry history.');
   points += [...part.content].length;
   full = {...full, content: full.content + part.content, nextContentCursor: part.nextContentCursor};
  }
  if (points !== full.contentLength) throw Error('Message content is incomplete. Retry history.');
  return full;
 }
 private async loadHistory(id: string, earlier = false, force = false, beforeId?: string): Promise<void> {
  if (this.disposed || this.paused || !this.leased.includes(id)) return;
  const state = this.transcript(id);
  if (state.pending) {if (force) this.dirty.add(id); return;}
  const gap = earlier ? beforeId ? state.gaps.find(item => item.beforeId === beforeId) : state.gaps[0] : undefined;
  if (earlier && !gap && !state.cursor || !earlier && state.loaded && !force) return;
  const abort = new AbortController(); this.histories.set(id, abort);
  state.pending = true; state.error = ''; this.emit();
  try {
   const page = await this.transport.history({agentId: id, limit: 40, ...(earlier ? {cursor: gap?.cursor ?? state.cursor!} : {})}, abort.signal);
   personal(page);
   if (page.agentId !== id) throw Error('Conversation changed. Retry history.');
   const messages: MessageSlice[] = [];
   for (const message of page.messages) messages.push(await this.complete(message, id, abort.signal));
   if (abort.signal.aborted || this.disposed) return;
   if (page.sequence < state.sequence) return;
   const ids = new Set(messages.map(message => message.id)), retained = state.messages.filter(message => !ids.has(message.id));
   const changed = messages.some(message => state.messages.find(old => old.id === message.id)?.content !== message.content);
   // Pages already carry canonical row order; equal timestamps and IDs cannot reconstruct it.
   if (gap) {
    const anchor = state.messages.findIndex(message => message.id === gap.beforeId), prefix = state.messages.slice(0, anchor), suffix = state.messages.slice(anchor);
    state.messages = [...prefix.filter(message => !ids.has(message.id)), ...messages, ...suffix.filter(message => !ids.has(message.id))];
    state.gaps = state.gaps.filter(item => item !== gap);
    if (page.nextCursor && messages.length && !prefix.some(message => ids.has(message.id))) state.gaps.push({beforeId: messages[0].id, cursor: page.nextCursor});
   } else {
    if (!earlier && state.loaded && state.messages.length && messages.length && page.nextCursor && !state.messages.some(message => ids.has(message.id))) state.gaps.push({beforeId: messages[0].id, cursor: page.nextCursor});
    state.messages = earlier ? [...messages, ...retained] : [...retained, ...messages];
    state.cursor = earlier || !state.loaded ? page.nextCursor : state.cursor;
   }
   state.gaps.sort((a, b) => state.messages.findIndex(message => message.id === a.beforeId) - state.messages.findIndex(message => message.id === b.beforeId));
   state.sequence = page.sequence; state.loaded = true;
   if (changed && !earlier && !this.view(id).atEnd) this.setView(id, {unread: true});
  } catch (cause) {if (!abort.signal.aborted && !this.disposed) state.error = cause instanceof Error ? cause.message : 'History could not load. Retry history.';}
  finally {if (this.histories.get(id) === abort) {state.pending = false; this.histories.delete(id); if (!this.disposed) {this.emit(); if (this.dirty.delete(id)) void this.loadHistory(id, false, true);}}}
 }
 dispose() {this.disposed = true; this.scopeAbort.abort(); this.stopStream(); clearTimeout(this.ancestorReload); this.histories.forEach(value => value.abort()); this.histories.clear(); if (this.rotation) clearInterval(this.rotation); this.listeners.clear();}
}
