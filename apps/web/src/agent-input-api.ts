import type {AgentFollowUp, AgentFollowUpTarget, AgentInputTicket} from '../../../packages/contracts/agent-input.ts';
import {authenticated, command, read} from './api.ts';

export const getAgentFollowUpTarget = (parentThreadId: string, jobId: string, signal?: AbortSignal) => authenticated(() => fetch('/api/agents/follow-up-target?' + new URLSearchParams({parentThreadId, jobId}), {credentials: 'same-origin', cache: 'no-store', signal})).then(read<AgentFollowUpTarget>);
/** Reuse commandId after uncertain HTTP delivery. A new ID is a new explicit input. */
export const sendAgentFollowUp = (parentThreadId: string, input: AgentFollowUp, commandId: string) => command('agent.followUp', input, parentThreadId, commandId);
export const getAgentInputTicket = (parentThreadId: string, ticketId: string, signal?: AbortSignal) => authenticated(() => fetch('/api/agents/inputs/' + encodeURIComponent(ticketId) + '?' + new URLSearchParams({parentThreadId}), {credentials: 'same-origin', cache: 'no-store', signal})).then(read<AgentInputTicket>);
