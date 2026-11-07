import type {AgentSummary} from '../../../../packages/contracts/agent-inventory';
import type {AgentInputTicket} from '../../../../packages/contracts/agent-input';
import {command} from '../api';
import {journalCompareAndSwap, journalGeneration, journalReadRecord, journalSubscribe, journalWrite} from '../journal';

export type ChildInputTicket = AgentInputTicket;
export interface AgentSend {agent: AgentSummary; content: string; commandId: string}
/** Parent supplies canonical run/epoch validation and durable receipts. No child message.send fallback. */
export interface ChildFollowUpController {
 canSend(agent: AgentSummary): boolean;
 prepare?(agent: AgentSummary): Promise<void>;
 track?(agent: AgentSummary, ticket: AgentInputTicket): void;
 send(input: AgentSend): Promise<ChildInputTicket>;
 subscribe(listener: (agentId: string, ticket: ChildInputTicket) => void): () => void;
 dispose?(): void;
}
export interface ComposerState {draft: string; ready: boolean; busy: boolean; stopping: boolean; error: string; retry: boolean; ticket?: ChildInputTicket}
/** Share this exact instance with every conversation view, including the host composer. */
export interface SharedAgentComposers {
 getSnapshot(agent: AgentSummary): ComposerState;
 subscribe(agent: AgentSummary, listener: () => void): () => void;
 prepare(agent: AgentSummary): Promise<void>;
 edit(agent: AgentSummary, value: string): Promise<void>;
 submit(agent: AgentSummary): Promise<void>;
 stop(agent: AgentSummary): Promise<void>;
 canSend(agent: AgentSummary): boolean;
 supports(agent: AgentSummary): boolean;
 dispose(): void;
}
interface PendingSend {commandId: string; content: string; generation: string | undefined}
interface Entry {agent: AgentSummary; stopEpoch: number; state: ComposerState; pending?: PendingSend; prepared?: Promise<void>; listeners: Set<() => void>; unsubscribe?: () => void}
export function createSharedAgentComposers(actions: {sendParent(input: AgentSend): Promise<void>; stopParent(agent: AgentSummary): Promise<void>; followUp?: ChildFollowUpController}): SharedAgentComposers {
 const entries = new Map<string, Entry>();
 const key = (agent: AgentSummary) => `draft:${agent.threadId ?? agent.agentId}`;
 const pendingKey = (agent: AgentSummary) => `agents-pending:${agent.threadId ?? agent.agentId}`;
 const ticketKey = (agent: AgentSummary) => `agents-ticket:${agent.agentId}`;
 const entry = (agent: AgentSummary): Entry => {
  const id = key(agent); if (!entries.has(id)) entries.set(id, {agent, stopEpoch: 0, state: {draft: '', ready: false, busy: false, stopping: false, error: '', retry: false}, listeners: new Set()});
  entries.get(id)!.agent = agent;
  return entries.get(id)!;
 };
 const emit = (value: Entry, patch: Partial<ComposerState>) => {value.state = {...value.state, ...patch}; value.listeners.forEach(listener => listener());};
 const supports = (agent: AgentSummary) => Boolean(agent.threadId) && !agent.archived && (agent.parentId
  ? agent.status === 'working' && Boolean(agent.jobId) && Boolean(actions.followUp)
  : !agent.readOnly);
 const canSend = (agent: AgentSummary) => {
  const state = entry(agent).state;
  if (agent.parentId && [...entries.values()].some(value => (value.agent.agentId === agent.parentId || value.agent.agentId === agent.rootId) && value.state.stopping)) return false;
  return state.ready && !state.busy && !state.stopping && supports(agent) && (agent.parentId ? Boolean(actions.followUp?.canSend(agent)) : Boolean(agent.modelId));
 };
 const ticketError = (ticket?: ChildInputTicket) => ticket && ['rejected', 'interrupted', 'delivery_uncertain'].includes(ticket.status) ? ticket.error ?? `Follow-up ${ticket.status.replaceAll('_', ' ')}.` : '';
 const unsubscribeTickets = actions.followUp?.subscribe((id, ticket) => {
  for (const value of entries.values()) if (value.state.ticket?.id === ticket.id) emit(value, {ticket, error: value.state.error === ticketError(value.state.ticket) ? ticketError(ticket) : value.state.error});
  void journalWrite(`agents-ticket:${id}`, ticket).catch(() => {});
 });
 const prepare = async (agent: AgentSummary) => {
  const value = entry(agent);
  await (value.prepared ??= (async () => {
   value.unsubscribe = journalSubscribe(key(agent), draft => emit(value, {draft: typeof draft === 'string' ? draft : ''}));
   try {
    const [draft, pending, ticket] = await Promise.all([journalReadRecord<string>(key(agent)), journalReadRecord<PendingSend | null>(pendingKey(agent)), journalReadRecord<ChildInputTicket>(ticketKey(agent))]);
    value.pending = pending?.value ?? undefined;
    emit(value, {draft: draft?.value ?? '', ready: true, retry: Boolean(value.pending), ticket: ticket?.value});
    if (ticket?.value) actions.followUp?.track?.(agent, ticket.value);
   } catch {emit(value, {ready: false, error: 'Draft recovery failed. Reopen this workspace to retry.'});}
  })());
  if (agent.parentId && actions.followUp?.prepare) {
   try {await actions.followUp.prepare(agent); emit(value, {});} catch (cause) {emit(value, {error: cause instanceof Error ? cause.message : 'Follow-up is unavailable. Reopen to retry.'});}
  }
 };
 return {
  getSnapshot: agent => entry(agent).state,
  subscribe: (agent, listener) => {const value = entry(agent); value.listeners.add(listener); return () => {value.listeners.delete(listener);};},
  prepare, canSend, supports,
  async edit(agent, draft) {
   const value = entry(agent); emit(value, {draft});
   try {await journalWrite(key(agent), draft);} catch {emit(value, {error: 'Draft could not be saved. Keep this workspace open.'});}
  },
  async submit(agent) {
   const value = entry(agent); if (!canSend(agent) || !value.pending && !value.state.draft.trim()) return;
   const stopEpoch = value.stopEpoch;
   const pending = value.pending ?? {commandId: crypto.randomUUID(), content: value.state.draft.trim(), generation: journalGeneration(key(agent))};
   value.pending = pending; emit(value, {busy: true, error: '', retry: false});
   try {
    // Persist before transport; retries after disconnect/reload keep the same command identity.
    await journalWrite(pendingKey(agent), pending);
    if (value.stopEpoch !== stopEpoch) {emit(value, {retry: true, error: 'Message retained after Stop. Retry when ready.'}); return;}
    if (agent.parentId) {
     const ticket = await actions.followUp!.send({agent, content: pending.content, commandId: pending.commandId});
     await journalWrite(ticketKey(agent), ticket); emit(value, {ticket});
     if (ticketError(ticket)) emit(value, {error: ticketError(ticket)});
    } else await actions.sendParent({agent, content: pending.content, commandId: pending.commandId});
    await journalCompareAndSwap(key(agent), pending.generation, '');
    await journalWrite(pendingKey(agent), null); value.pending = undefined;
    // journal notifications own the draft; never clear text authored during transport.
    const draft = await journalReadRecord<string>(key(agent)); emit(value, {draft: draft?.value ?? value.state.draft});
   } catch (cause) {emit(value, {error: cause instanceof Error ? cause.message : 'Delivery is uncertain. Retry this message.', retry: true});}
   finally {emit(value, {busy: false});}
  },
  async stop(agent) {
   const value = entry(agent); if (agent.parentId || !agent.threadId || agent.readOnly || agent.status !== 'working' || value.state.stopping) return;
   value.stopEpoch++; emit(value, {stopping: true, error: ''});
   for (const child of entries.values()) if (child !== value && (child.agent.parentId === agent.agentId || child.agent.rootId === agent.agentId)) {child.stopEpoch++; emit(child, {});}
   try {await actions.stopParent(agent);} catch (cause) {emit(value, {error: cause instanceof Error ? cause.message : 'Stop failed. Retry Stop.'});}
   finally {emit(value, {stopping: false}); for (const child of entries.values()) if (child.agent.parentId === agent.agentId || child.agent.rootId === agent.agentId) emit(child, {});}
  },
  dispose() {unsubscribeTickets?.(); actions.followUp?.dispose?.(); for (const value of entries.values()) {value.unsubscribe?.(); value.listeners.clear();}},
 };
}
/** The outer host adopts this owner for both its ordinary composer and agent columns. */
export function createPersonalAgentComposers(followUp?: ChildFollowUpController): SharedAgentComposers {
 return createSharedAgentComposers({
  sendParent: async ({agent, content, commandId}) => {await command('message.send', {content, modelId: agent.modelId}, agent.threadId!, commandId);},
  stopParent: async agent => {await command('run.stop', {}, agent.threadId!);},
  followUp,
 });
}
