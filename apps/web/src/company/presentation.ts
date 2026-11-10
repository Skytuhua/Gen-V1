import type {CompanyProject, CompanyStatus} from './api';
import {z} from 'zod';

const label = z.string().max(16000);
const campaignProjection = z.object({id: label, state: label, goal: label.nullable().optional(), audience: label.nullable().optional(), production_approval: z.object({status: label}).optional()});
const contentProjection = z.object({content_id: label, channel: label, revision: z.number().int().nonnegative(), approval_state: label});
const marketingProjection = z.object({
  status: z.literal('available'),
  campaigns: z.array(campaignProjection).max(50).optional().default([]),
  content_queue: z.array(contentProjection).max(200).optional().default([]),
  exceptions: z.array(z.object({campaign_id: label, state: label})).max(1000).optional().default([]),
  truncated: z.boolean().optional().default(false),
});
export function companyMarketing(project: CompanyProject) {
  const parsed = marketingProjection.safeParse(project.marketing);
  return parsed.success ? {...parsed.data, unavailable: false} : {campaigns: [], content_queue: [], exceptions: [], truncated: false, unavailable: true};
}

export const COMPANY_VIEWS = ['manager', 'portfolio', 'communications', 'people', 'plan', 'review', 'campaigns', 'budget', 'exceptions', 'source'] as const;
export type CompanyView = typeof COMPANY_VIEWS[number];
export interface CompanySelection {view: CompanyView; projectId: string; filter: string}
export function recoverCompanySelection(value: unknown): CompanySelection {
  const item = value && typeof value === 'object' ? value as Partial<CompanySelection> : {};
  return {view: COMPANY_VIEWS.includes(item.view as CompanyView) ? item.view as CompanyView : 'manager', projectId: typeof item.projectId === 'string' ? item.projectId.slice(0, 200) : '', filter: typeof item.filter === 'string' ? item.filter.slice(0, 200) : ''};
}
export function companyCount(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : 'Unavailable';
}
export function taskCounts(project: CompanyProject): {state: string; count: number}[] {
  return Object.entries(project.task_counts ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0).map(([state, count]) => ({state, count}));
}
export function projectTaskTotal(project: CompanyProject): string {
  const entries = Object.entries(project.task_counts ?? {});
  if (!entries.length || entries.some(([, count]) => typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)) return 'Unavailable';
  return companyCount(entries.reduce((total, [, count]) => total + count, 0));
}
export function companyBlockers(status: CompanyStatus | undefined, connectionBlockers: string[]): string[] {
  return [...new Set([...connectionBlockers, ...(Array.isArray(status?.blockers) ? status.blockers.filter((item): item is string => typeof item === 'string') : [])])];
}
/** The current manager contract supports local proposals, never company chat.
 * Neither owner authentication nor planning configuration grants delivery. */
export function companyManagerAccess(availability: {configured?: boolean; mode?: string} | undefined) {
  return {
    canSend: false as const,
    title: "Your manager isn't connected yet",
    reason: availability?.configured && availability.mode === 'shadow_proposals'
      ? 'This connection supports local plan drafts. It cannot deliver messages to your company manager. You can prepare a draft in Plan.'
      : 'A manager connection has not been made available to this app. You can write and save a draft while setup is completed.',
  };
}
export function companyRecordLabel(scope: string | undefined) {
  if (scope === 'synthetic_only') return 'Test evidence only';
  if (scope === 'company_records') return 'Company records';
  return 'Record source unverified';
}
export function stateLabel(value: string | null | undefined): string {return value ? value.replaceAll('_', ' ') : 'Unavailable';}
export function sourceTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}) : 'Unavailable';
}
