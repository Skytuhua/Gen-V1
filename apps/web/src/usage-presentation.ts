import type { RuntimeUsage, Thread } from '../../../packages/contracts';

export interface UsageLimitReport { id: string; label: string; usedPercent?: number | null; reset?: string | null }
export interface UsageProviderReport {
  id: string; scopeId: string; scopeLabel: string; providerId: string; providerLabel: string;
  cost?: { amount: number; currency?: string } | null;
  inputTokens?: number | null; outputTokens?: number | null;
  limits?: readonly UsageLimitReport[]; error?: string;
}
const reported = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const number = (value: number) => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 21 }).format(value);
export const usageCount = (value: unknown) => reported(value) && Number.isSafeInteger(value) ? number(value) : 'Not reported';
export const usagePercent = (value: unknown) => reported(value) && value <= 100 ? `${value}%` : 'Not reported';
export function usageCost(value: UsageProviderReport['cost']) {
  if (!value || !reported(value.amount)) return 'Not reported';
  return `${number(value.amount)} ${value.currency?.trim() || '(currency not reported)'}`;
}

/** The snapshot is thread-scoped; it supplies neither currency nor reset timestamps. */
export function runtimeUsageReport(thread: Pick<Thread, 'id' | 'title' | 'modelId'> | undefined, usage: RuntimeUsage | undefined): UsageProviderReport | undefined {
  if (!thread || !usage) return;
  const providerId = thread.modelId?.split('/')[0] || 'unreported-provider';
  return { id: thread.id, scopeId: thread.id, scopeLabel: thread.title, providerId,
    providerLabel: thread.modelId?.split('/')[0] || 'Provider not reported',
    cost: usage.cost == null ? undefined : { amount: usage.cost }, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    limits: [{ id: 'session', label: 'Session limit', usedPercent: usage.sessionPercent }, { id: 'weekly', label: 'Weekly limit', usedPercent: usage.weeklyPercent }],
  };
}
