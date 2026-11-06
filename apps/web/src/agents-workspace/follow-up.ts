import type {AgentSummary} from '../../../../packages/contracts/agent-inventory';
import {AgentFollowUpSchema, type AgentFollowUpTarget, type AgentInputTicket} from '../../../../packages/contracts/agent-input';
import {getAgentFollowUpTarget, getAgentInputTicket, sendAgentFollowUp} from '../agent-input-api';
import {journalReadRecord, journalWrite} from '../journal';
import type {ChildFollowUpController} from './composer';

/** A target is pinned durably per command. Recovery never steers a replacement run. */
export function createPersonalChildFollowUp(parentThreadId: (agent: AgentSummary) => string | undefined): ChildFollowUpController {
 const targets = new Map<string, {revision: number; target: AgentFollowUpTarget}>(), listeners = new Set<(id: string, ticket: AgentInputTicket) => void>();
 const tickets = new Map<string, {agentId: string; ticket: AgentInputTicket}>(), abort = new AbortController();
 let timer: ReturnType<typeof setTimeout> | undefined, polling = false;
 const active = (ticket: AgentInputTicket) => ['queued', 'processing', 'delivery_uncertain'].includes(ticket.status);
 const schedule = () => {if (!timer && !abort.signal.aborted && [...tickets.values()].some(value => active(value.ticket))) timer = setTimeout(() => {timer = undefined; void poll();}, 1500);};
 const poll = async () => {
  if (polling || abort.signal.aborted) return; polling = true;
  try {
   for (const [id, value] of tickets) {
    if (!active(value.ticket)) continue;
    try {
     const ticket = await getAgentInputTicket(value.ticket.parentThreadId, id, abort.signal);
     if (abort.signal.aborted) return;
     tickets.set(id, {...value, ticket}); listeners.forEach(listener => listener(value.agentId, ticket));
    } catch {if (abort.signal.aborted) return; /* A failed read never fabricates delivery state. */}
   }
  } finally {polling = false; schedule();}
 };
 const validate = (agent: AgentSummary, target: AgentFollowUpTarget) => {
  if (target.authority !== 'personal' || target.parentThreadId !== parentThreadId(agent) || target.jobId !== agent.jobId || target.childRun.threadId !== agent.threadId) throw Error('The active child target changed. Reopen the conversation.');
 };
 return {
  canSend: agent => agent.status === 'working' && targets.has(agent.agentId),
  async prepare(agent) {
   if (agent.status !== 'working' || !agent.jobId || !agent.threadId) {targets.delete(agent.agentId); return;}
   if (targets.get(agent.agentId)?.revision === agent.revision) return;
   const parent = parentThreadId(agent); if (!parent) throw Error('The parent conversation is unavailable.');
   targets.delete(agent.agentId);
   const target = await getAgentFollowUpTarget(parent, agent.jobId, abort.signal); validate(agent, target);
   if (!abort.signal.aborted) targets.set(agent.agentId, {revision: agent.revision, target});
  },
  track(agent, ticket) {tickets.set(ticket.id, {agentId: agent.agentId, ticket}); if (active(ticket)) {void poll();}},
  async send({agent, content, commandId}) {
   const saved = await journalReadRecord<AgentFollowUpTarget>('agent-followup-target:' + commandId);
   const target = saved?.value ?? targets.get(agent.agentId)?.target;
   if (!target) throw Error('The active child target is unavailable. Reopen to retry.');
   validate(agent, target);
   const input = AgentFollowUpSchema.parse({jobId: target.jobId, parentRun: target.parentRun, childRun: target.childRun, content});
   if (!saved) await journalWrite('agent-followup-target:' + commandId, target);
   const receipt = await sendAgentFollowUp(target.parentThreadId, input, commandId);
   const ticketId = (receipt.result as {ticketId?: unknown} | undefined)?.ticketId;
   if (typeof ticketId !== 'string') throw Error('Follow-up receipt is unavailable. Retry delivery.');
   // The immutable admission receipt always says queued; only this read reports current state.
   const ticket = await getAgentInputTicket(target.parentThreadId, ticketId, abort.signal);
   tickets.set(ticket.id, {agentId: agent.agentId, ticket}); schedule(); return ticket;
  },
  subscribe(listener) {listeners.add(listener); return () => {listeners.delete(listener);};},
  dispose() {abort.abort(); if (timer) clearTimeout(timer); listeners.clear(); targets.clear(); tickets.clear();},
 };
}
