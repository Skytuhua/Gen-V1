import {authenticated, command, read} from './api.ts';

export type WorkState = 'QUEUED' | 'RUNNING' | 'WAITING_HUMAN' | 'COMPLETED_REPORTED' | 'VERIFIED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED';
export interface AgentWorkRow {
  workId: string; role: 'PLAN_READ' | 'RESEARCH_READ' | 'CODE_WORKTREE' | 'QA'; state: WorkState;
  failureReason: string | null; blockedReason: string | null; steerSupported: boolean;
  owner: {threadId: string; runId: string | null; epoch: number};
  worktree: string | null; grants: {id: string; label: string; writable: boolean}[];
  budget: {tokens: number | null; ms: number | null}; outputRef: {id: string; revision: number} | null;
  repairAttempts: number; evidence: {refs: number; stale: number; outputRevision: number | null};
  updatedAt: string; revision: number;
}
export interface AgentWorkList {
  enabled: boolean; works: AgentWorkRow[]; budget: {reservedTokens: number; spentTokens: number; admitted: number; completed: number; failed: number; cancelled: number; interrupted: number};
  roles: Record<string, {available: boolean; reason?: string}>;
}
export interface AgentInputRow {
  inputId: string; workId?: string; targetOwner: {threadId: string}; kind: 'STEER' | 'FOLLOW_UP' | 'MESSAGE';
  order: number; delivery: 'ACCEPTED' | 'ENTERED_RUNTIME' | 'HANDLED' | 'REJECTED' | 'UNKNOWN'; error?: string; text: string | null; editable: boolean; createdAt: string;
}
export interface AgentMessageRow {
  messageId: string; taskId: string; senderOwner: {threadId: string}; recipientOwner: {threadId: string};
  senderTitle: string; recipientTitle: string; topic: string; text?: string;
  receipt: {status: 'POSTED' | 'DELIVERED'; at: string}; createdAt: string;
}
export interface PlanProgress {
  extension: boolean; planId: string;
  progress?: {completed: number; pending: number; unknown: number; total: number};
}

const get = <T>(path: string) => authenticated(() => fetch(path, {credentials: 'same-origin', cache: 'no-store'})).then(read<T>);
export const getAgentWork = (taskId: string) => get<AgentWorkList>(`/api/agent-work?taskId=${encodeURIComponent(taskId)}`);
export const getAgentWorkInputs = (taskId: string, targetThreadId: string) => get<{inputs: AgentInputRow[]}>(`/api/agent-work/inputs?taskId=${encodeURIComponent(taskId)}&targetThreadId=${encodeURIComponent(targetThreadId)}`);
export const getAgentWorkMessages = (taskId: string) => get<{messages: AgentMessageRow[]}>(`/api/agent-work/messages?taskId=${encodeURIComponent(taskId)}`);
export const getAgentWorkOutput = (taskId: string, workId: string) => get<{workId: string; output: unknown; lateArtifacts: number}>(`/api/agent-work/output?taskId=${encodeURIComponent(taskId)}&workId=${encodeURIComponent(workId)}`);
export const getAgentWorkPlan = (taskId: string) => get<PlanProgress>(`/api/agent-work/plan?taskId=${encodeURIComponent(taskId)}`);

export const sendAgentInput = (threadId: string, args: {workId: string; kind: 'STEER' | 'FOLLOW_UP'; text: string; inputId?: string; dedupeKey?: string}) =>
  command('agentWork.input', {...args, inputId: args.inputId ?? crypto.randomUUID(), dedupeKey: args.dedupeKey ?? crypto.randomUUID()}, threadId);
export const stopAgentWork = (threadId: string, workId: string) => command('agentWork.stop', {workId}, threadId);
export const resumeAgentWork = (threadId: string, workId: string) => command('agentWork.resume', {workId}, threadId);
export const cancelAgentInput = (threadId: string, targetThreadId: string, inputId: string) => command('agentWork.input.cancel', {targetThreadId, inputId}, threadId);
export const postAgentMessage = (threadId: string, args: {recipientThreadId: string; topic: string; text: string; messageId?: string}) =>
  command('agentWork.message', {...args, messageId: args.messageId ?? crypto.randomUUID()}, threadId);
