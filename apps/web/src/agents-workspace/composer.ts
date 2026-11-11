import type {AgentSummary} from '../../../../packages/contracts/agent-inventory';
import {AgentFollowUpSchema, type AgentInputTicket} from '../../../../packages/contracts/agent-input';
import {ApiError, command} from '../api';
import {journalCompareAndSwap, journalGeneration, journalReadRecord, journalSubscribe, journalWrite} from '../journal';
import type {SkillReference} from '../../../../packages/contracts/skill-catalog';
import {skillBindingSchema, skillBindingsSchema, type SkillBinding} from '../composer-commands';
import {clearAcceptedSkills, readSkillBindings, skillDraftKey} from '../composer-skill-drafts';

export type ChildInputTicket = AgentInputTicket;
export interface AgentSend {agent: AgentSummary; content: string; commandId: string; isCurrent?(): boolean}
/** A real conversation owner can share drafts without joining the agent inventory. */
export interface ConversationComposerTarget {kind: 'conversation'; threadId: string; modelId: string | null; working: boolean}
export type ComposerTarget = AgentSummary | ConversationComposerTarget;
export interface ParentSend {threadId: string; modelId: string | null; thinkingLevel?: string | null; content: string; commandId: string; skills?: SkillReference[]}
const inventoryAgent = (target: ComposerTarget): target is AgentSummary => !('kind' in target);
const identity = (target: ComposerTarget) => target.threadId ?? (inventoryAgent(target) ? target.agentId : '');
/** Parent supplies canonical run/epoch validation and durable receipts. No child message.send fallback. */
export interface ChildFollowUpController {
 canSend(agent: AgentSummary): boolean;
 prepare?(agent: AgentSummary): Promise<void>;
 track?(agent: AgentSummary, ticket: AgentInputTicket): void;
 send(input: AgentSend): Promise<ChildInputTicket>;
 subscribe(listener: (agentId: string, ticket: ChildInputTicket) => void): () => void;
 dispose?(): void;
}
export interface ComposerState {draft: string; ready: boolean; busy: boolean; stopping: boolean; error: string; retry: boolean; thinkingLevel?: string | null; skills?: readonly SkillBinding[]; ticket?: ChildInputTicket}
export interface ComposerSubmission {content: string; generation: string | undefined; skills: readonly SkillBinding[]}
/** Share this exact instance with every conversation view, including the host composer. */
export interface SharedAgentComposers {
 getSnapshot(agent: ComposerTarget): ComposerState;
 subscribe(agent: ComposerTarget, listener: () => void): () => void;
 prepare(agent: ComposerTarget): Promise<void>;
 edit(agent: ComposerTarget, value: string): Promise<void>;
 addSkill(agent: ComposerTarget, binding: SkillBinding): Promise<void>;
 removeSkill(agent: ComposerTarget, id: string): Promise<void>;
 submit(agent: ComposerTarget, options?: {thinkingLevel?: string | null; submission?: ComposerSubmission}): Promise<void>;
 stop(agent: ComposerTarget): Promise<void>;
 canSend(agent: ComposerTarget): boolean;
 supports(agent: ComposerTarget): boolean;
 dispose(): void;
}
interface PendingSend {commandId: string; content: string; generation: string | undefined; modelId?: string | null; thinkingLevel?: string | null; skills?: SkillBinding[]}
interface Entry {agent: ComposerTarget; inventory?: AgentSummary; stopEpoch: number; state: ComposerState; pending?: PendingSend; prepared?: Promise<void>; listeners: Set<() => void>; unsubscribe?: () => void}
export function createSharedAgentComposers(actions: {sendParent(input: ParentSend): Promise<void>; stopParent(agent: ComposerTarget): Promise<void>; followUp?: ChildFollowUpController; ownership?: (agent: ComposerTarget) => unknown}): SharedAgentComposers {
 const entries = new Map<string, Entry>();
 const recoveryError = 'Draft recovery failed. Reopen this workspace to retry.';
 const ownership = (agent: ComposerTarget) => actions.ownership ? actions.ownership(agent) : true;
 const key = (agent: ComposerTarget) => `draft:${identity(agent)}`;
 const pendingKey = (agent: ComposerTarget) => `agents-pending:${identity(agent)}`;
 const ticketKey = (agent: ComposerTarget) => `agents-ticket:${inventoryAgent(agent) ? agent.agentId : agent.threadId}`;
 const entry = (agent: ComposerTarget): Entry => {
  const id = key(agent); if (!entries.has(id)) entries.set(id, {agent, stopEpoch: 0, state: {draft: '', ready: false, busy: false, stopping: false, error: '', retry: false}, listeners: new Set()});
  entries.get(id)!.agent = agent;
  if (inventoryAgent(agent)) entries.get(id)!.inventory = agent;
  return entries.get(id)!;
 };
 const emit = (value: Entry, patch: Partial<ComposerState>) => {value.state = {...value.state, ...patch}; value.listeners.forEach(listener => listener());};
 const supports = (agent: ComposerTarget) => !inventoryAgent(agent) || Boolean(agent.threadId) && !agent.archived && (agent.parentId
  ? agent.status === 'working' && Boolean(agent.jobId) && Boolean(actions.followUp)
  : !agent.readOnly);
 const canSend = (agent: ComposerTarget) => {
  const state = entry(agent).state;
  if (inventoryAgent(agent) && agent.parentId && [...entries.values()].some(value => (value.inventory?.agentId === agent.parentId || value.inventory?.agentId === agent.rootId) && value.state.stopping)) return false;
  return ownership(agent) !== undefined && state.ready && !state.busy && !state.stopping && supports(agent) && (inventoryAgent(agent) && agent.parentId ? Boolean(actions.followUp?.canSend(agent)) : Boolean(agent.modelId));
 };
 const ticketError = (ticket?: ChildInputTicket) => ticket && ['rejected', 'interrupted', 'delivery_uncertain'].includes(ticket.status) ? ticket.error ?? `Follow-up ${ticket.status.replaceAll('_', ' ')}.` : '';
 const unsubscribeTickets = actions.followUp?.subscribe((id, ticket) => {
  for (const value of entries.values()) if (value.state.ticket?.id === ticket.id) emit(value, {ticket, error: value.state.error === ticketError(value.state.ticket) ? ticketError(ticket) : value.state.error});
  void journalWrite(`agents-ticket:${id}`, ticket).catch(() => {});
 });
 const prepare = async (agent: ComposerTarget) => {
  const value = entry(agent);
  await (value.prepared ??= (async () => {
   const draftSubscription = journalSubscribe(key(agent), draft => emit(value, {draft: typeof draft === 'string' ? draft : ''}));
   const thinkingSubscription = journalSubscribe('thinking:' + identity(agent), level => emit(value, {thinkingLevel: typeof level === 'string' ? level || null : undefined}));
   const skillSubscription = journalSubscribe(skillDraftKey(identity(agent)), skills => {try {emit(value, {skills: readSkillBindings(skills)});} catch {emit(value, {ready: false, error: 'Selected skills could not be recovered. Keep this workspace open.'});}});
   value.unsubscribe = () => {draftSubscription(); thinkingSubscription(); skillSubscription();};
   try {
    const [draft, pending, ticket, thinking, skills] = await Promise.all([journalReadRecord<string>(key(agent)), journalReadRecord<PendingSend | null>(pendingKey(agent)), journalReadRecord<ChildInputTicket>(ticketKey(agent)), journalReadRecord<string>('thinking:' + identity(agent)), journalReadRecord(skillDraftKey(identity(agent)))]);
    value.pending = pending?.value ?? undefined;
    if (value.pending?.skills) value.pending.skills = skillBindingsSchema.parse(value.pending.skills);
    emit(value, {draft: draft?.value ?? '', skills: readSkillBindings(skills?.value), ready: true, retry: Boolean(value.pending), ticket: ticket?.value, thinkingLevel: typeof thinking?.value === 'string' ? thinking.value || null : undefined, error: value.state.error === recoveryError ? '' : value.state.error});
    if (ticket?.value && inventoryAgent(agent)) actions.followUp?.track?.(agent, ticket.value);
   } catch {
    value.unsubscribe?.(); value.unsubscribe = undefined; value.prepared = undefined;
    emit(value, {ready: false, error: recoveryError});
   }
  })());
  if (inventoryAgent(agent) && agent.parentId && actions.followUp?.prepare) {
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
  async addSkill(agent, binding) {
   if (inventoryAgent(agent) && agent.parentId) throw Error('Select skills in the parent conversation.');
   const value = entry(agent), skills = skillBindingsSchema.parse([...(value.state.skills ?? []), skillBindingSchema.parse(binding)]);
   emit(value, {skills});
   try {await journalWrite(skillDraftKey(identity(agent)), skills);} catch {emit(value, {error: 'Selected skills could not be saved. Keep this workspace open.'}); throw Error('Selected skills could not be saved.');}
  },
  async removeSkill(agent, id) {
   const value = entry(agent), skills = (value.state.skills ?? []).filter(binding => binding.id !== id); emit(value, {skills, ...(!value.pending ? {error: ''} : {})});
   try {await journalWrite(skillDraftKey(identity(agent)), skills);} catch {emit(value, {error: 'Selected skills could not be saved. Keep this workspace open.'}); throw Error('Selected skills could not be saved.');}
  },
  async submit(agent, options) {
   const value = entry(agent), submission = options?.submission;
   if (!canSend(agent) || !value.pending && !(submission?.content ?? value.state.draft).trim()) return;
   const stopEpoch = value.stopEpoch, owner = ownership(agent);
   if (inventoryAgent(agent) && agent.parentId) {
    const valid = AgentFollowUpSchema.shape.content.safeParse(value.pending?.content ?? (submission?.content ?? value.state.draft).trim());
    if (!valid.success) {
     // This content cannot have passed local admission. Retire old invalid journals too.
     emit(value, {busy: true, error: 'Enter a follow-up within the text limit.', retry: false});
     try {if (value.pending) {await journalWrite(pendingKey(agent), null); value.pending = undefined;}}
     catch {emit(value, {error: 'Draft recovery failed. Reopen this workspace to retry.', retry: true});}
     finally {emit(value, {busy: false});}
     return;
    }
   }
   const thinkingLevel = options?.thinkingLevel === undefined ? value.state.thinkingLevel : options.thinkingLevel;
   const skills = submission?.skills ?? value.state.skills;
   const pending = value.pending ?? {commandId: crypto.randomUUID(), content: (submission?.content ?? value.state.draft).trim(), generation: submission ? submission.generation : journalGeneration(key(agent)), modelId: agent.modelId, ...(thinkingLevel !== undefined ? {thinkingLevel} : {}), ...((skills?.length ?? 0) > 0 ? {skills: skillBindingsSchema.parse(skills)} : {})};
   value.pending = pending; emit(value, {busy: true, error: '', retry: false});
   try {
    // Persist before transport; retries after disconnect/reload keep the same command identity.
    await journalWrite(pendingKey(agent), pending);
    if (ownership(agent) !== owner) {emit(value, {retry: true, error: 'The conversation owner changed. Message retained for retry.'}); return;}
    if (value.stopEpoch !== stopEpoch) {emit(value, {retry: true, error: 'Message retained after Stop. Retry when ready.'}); return;}
    if (inventoryAgent(agent) && agent.parentId) {
     if (pending.skills?.length) throw Error('Select skills in the parent conversation.');
     const ticket = await actions.followUp!.send({agent, content: pending.content, commandId: pending.commandId, isCurrent: () => ownership(agent) === owner && value.stopEpoch === stopEpoch});
     await journalWrite(ticketKey(agent), ticket); emit(value, {ticket});
     if (ticketError(ticket)) emit(value, {error: ticketError(ticket)});
    } else await actions.sendParent({threadId: identity(agent), modelId: pending.modelId === undefined ? agent.modelId : pending.modelId, ...(pending.thinkingLevel !== undefined ? {thinkingLevel: pending.thinkingLevel} : {}), content: pending.content, commandId: pending.commandId, ...(pending.skills?.length ? {skills: pending.skills.map(binding => binding.ref)} : {})});
    await journalCompareAndSwap(key(agent), pending.generation, '');
    await clearAcceptedSkills(skillDraftKey(identity(agent)), pending.skills ?? []);
    await journalWrite(pendingKey(agent), null); value.pending = undefined;
    // journal notifications own the draft; never clear text authored during transport.
    const [draft, skills] = await Promise.all([journalReadRecord<string>(key(agent)), journalReadRecord(skillDraftKey(identity(agent)))]); emit(value, {draft: draft?.value ?? value.state.draft, skills: readSkillBindings(skills?.value)});
   } catch (cause) {
    // Only an authenticated, explicit precommit rejection can retire this input.
    // Network failures and ambiguous/accepted outcomes retain the exact retry.
    const details = cause instanceof ApiError ? cause.details : undefined;
    const rejected = typeof details === 'object' && details !== null && 'sendAccepted' in details && details.sendAccepted === false;
    if (rejected) {
     try {await journalWrite(pendingKey(agent), null); value.pending = undefined;}
     catch {emit(value, {error: 'The rejected message could not be saved locally. Keep this workspace open.', retry: true}); return;}
    }
    emit(value, {error: cause instanceof Error ? cause.message : 'Delivery is uncertain. Retry this message.', retry: !rejected});
   }
   finally {emit(value, {busy: false});}
  },
  async stop(agent) {
   const value = entry(agent), working = inventoryAgent(agent) ? !agent.parentId && Boolean(agent.threadId) && !agent.readOnly && agent.status === 'working' : agent.working;
   if (!working || value.state.stopping || ownership(agent) === undefined) return;
   value.stopEpoch++; emit(value, {stopping: true, error: ''});
   const childOf = (child: Entry) => inventoryAgent(child.agent) && Boolean(value.inventory && (child.agent.parentId === value.inventory.agentId || child.agent.rootId === value.inventory.agentId));
   for (const child of entries.values()) if (child !== value && childOf(child)) {child.stopEpoch++; emit(child, {});}
   try {await actions.stopParent(agent);} catch (cause) {emit(value, {error: cause instanceof Error ? cause.message : 'Stop failed. Retry Stop.'});}
   finally {emit(value, {stopping: false}); for (const child of entries.values()) if (childOf(child)) emit(child, {});}
  },
  dispose() {unsubscribeTickets?.(); actions.followUp?.dispose?.(); for (const value of entries.values()) {value.unsubscribe?.(); value.listeners.clear();}},
 };
}
/** The outer host adopts this owner for both its ordinary composer and agent columns. */
export function createPersonalAgentComposers(followUp?: ChildFollowUpController, ownership?: (agent: ComposerTarget) => unknown): SharedAgentComposers {
 return createSharedAgentComposers({
  sendParent: async ({threadId, modelId, thinkingLevel, content, commandId, skills}) => {
   const target: ConversationComposerTarget = {kind: 'conversation', threadId, modelId, working: false}, owner = ownership?.(target);
   await command('message.send', {content, modelId, ...(thinkingLevel !== undefined ? {thinkingLevel} : {}), ...(skills?.length ? {skills} : {})}, threadId, commandId, () => !ownership || owner !== undefined && ownership(target) === owner);
  },
  stopParent: async agent => {
   const owner = ownership?.(agent);
   await command('run.stop', {}, identity(agent), undefined, () => !ownership || owner !== undefined && ownership(agent) === owner);
  },
  followUp, ownership,
 });
}
