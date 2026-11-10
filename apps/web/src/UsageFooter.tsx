import { Activity } from 'lucide-react';
import type { RuntimeUsage } from '../../../packages/contracts';
import { DockedSummary } from '../../../packages/ui-shell/SummaryDock';
import { usageCost, usageCount, usagePercent } from './usage-presentation';
import './usage-dialog.css';

export function UsageFooter({ usage, visible, threadId, onOpenUsage }: { usage?: RuntimeUsage; visible: boolean; threadId?: string; onOpenUsage?: (threadId?: string) => void }) {
  if (!visible) return null;
  const summary = <><Activity size={12} aria-hidden="true" /><span>{usage?.inputTokens == null ? 'Not reported' : `${usageCount(usage.inputTokens)} input tokens`}</span></>;
  return <DockedSummary id="usage" title="Live usage" ariaLabel="Live usage" defaultCollapsed summary={summary}
    collapsedLabel="Inspect live usage" minimizeLabel="Minimize live usage" className="summary-usage">
    <section className="floating-usage-details" aria-label="Runtime usage details">
      {(!threadId || !onOpenUsage) && <dl><dt>Input tokens</dt><dd>{usageCount(usage?.inputTokens)}</dd><dt>Output tokens</dt><dd>{usageCount(usage?.outputTokens)}</dd>
        <dt>Reported cost</dt><dd>{usageCost(usage?.cost == null ? undefined : { amount: usage.cost })}</dd>
        <dt>Session limit</dt><dd>{usagePercent(usage?.sessionPercent)}</dd><dt>Weekly limit</dt><dd>{usagePercent(usage?.weeklyPercent)}</dd></dl>}
      {onOpenUsage && <button type="button" className="usage-open-details" onClick={() => onOpenUsage(threadId)}>Open Usage</button>}
    </section>
  </DockedSummary>;
}
