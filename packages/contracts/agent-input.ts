import {z} from 'zod';
import {PlanRunSchema} from './planning.ts';

const id = z.string().min(1).max(160).regex(/^[\w:.-]+$/);
export const AgentFollowUpSchema = z.strictObject({
  jobId: id,
  parentRun: PlanRunSchema,
  childRun: PlanRunSchema.extend({threadId: id}).strict(),
  content: z.string().max(32_768).refine(value => !!value.trim() && new TextEncoder().encode(value).byteLength <= 65_536, 'Enter at most 64 KiB of text'),
});
export type AgentFollowUp = z.infer<typeof AgentFollowUpSchema>;
export interface AgentFollowUpTarget extends Omit<AgentFollowUp, 'content'> {authority: 'personal'; parentThreadId: string}
export type AgentInputStatus = 'queued' | 'processing' | 'handled' | 'rejected' | 'interrupted' | 'delivery_uncertain';
export interface AgentInputTicket extends Omit<AgentFollowUpTarget, 'authority'> {
  id: string; messageId: string; status: AgentInputStatus; createdAt: string; updatedAt: string; error?: string;
}
