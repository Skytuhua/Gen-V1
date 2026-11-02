import { useId, useState, type CSSProperties } from 'react';
import type { RuntimeUsage } from '../../../packages/contracts';
import './context-inspector.css';

const contextFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const contextNumber = (tokens: number) => contextFormatter.format(tokens);

export function contextSegments(usage?: RuntimeUsage) {
  if (usage?.contextTokens == null || usage.contextWindow == null || usage.contextWindow <= 0 || !Number.isFinite(usage.contextTokens) || !Number.isFinite(usage.contextWindow) || usage.contextTokens < 0) return null;
  const used = usage.contextTokens, total = usage.contextWindow, ratio = Math.min(100, used / total * 100);
  const reported = usage.contextBreakdown;
  const valid = reported && reported.length > 0 && reported.length <= 20 && reported.every(item => typeof item.label === 'string' && item.label.trim() && Number.isFinite(item.tokens) && item.tokens >= 0) && reported.reduce((sum, item) => sum + item.tokens, 0) <= used;
  const categories = valid ? reported.map(item => ({ ...item })) : [{ label: 'Used', tokens: used }];
  const classified = categories.reduce((sum, item) => sum + item.tokens, 0);
  if (valid && classified < used) categories.push({ label: 'Other used context', tokens: used - classified });
  return { used, total, ratio, free: Math.max(0, total - used), categorized: Boolean(valid), categories: categories.map(item => ({ ...item, width: used > 0 ? item.tokens / used * ratio : 0 })) };
}
function categoryColor(label: string) {
  if (/^system$/i.test(label)) return 'var(--context-system)';
  if (/^(mcp|tools)$/i.test(label)) return 'var(--context-tools)';
  if (/^skills$/i.test(label)) return 'var(--context-skills)';
  if (/^(messages|conversation)$/i.test(label)) return 'var(--context-messages)';
  return 'var(--context-other)';
}

export function ContextMeter({ usage, busy = false }: { usage?: RuntimeUsage; busy?: boolean }) {
  const value = contextSegments(usage), id = useId();
  const [inspected, setInspected] = useState<string | null>(null);
  if (!value) return <div className="context-meter"><div className="context-meter-unknown" aria-label="Context measurement unavailable" /><p className="context-categories-note">Category breakdown unavailable</p></div>;
  const entries = [...value.categories, { label: 'Free', tokens: value.free, width: Math.max(0, 100 - value.ratio) }];
  return <div className="context-meter" role="group" aria-label="Reported context breakdown" aria-busy={busy}>
    <progress className="sr-only" aria-label="Context used" value={value.ratio} max={100} />
    <div className="context-segment-bar">{entries.filter(item => item.tokens > 0).map(item => <button key={item.label} type="button" style={{ width: `${item.width}%`, '--context-color': item.label === 'Free' ? 'var(--context-free)' : categoryColor(item.label) } as CSSProperties} className={`context-segment${item.label === 'Free' ? ' context-free' : ''}`} aria-label={`${item.label}: ${contextNumber(item.tokens)} tokens`} data-tooltip={`${item.label} · ${contextNumber(item.tokens)} tokens`}><span className="sr-only">{item.label}</span></button>)}{busy && <span className="context-compaction-shimmer" aria-hidden="true" />}</div>
    <div className="context-category-grid">{entries.map(item => <div className="context-category-entry" key={item.label}>
      <button className="context-category-row" type="button" aria-describedby={inspected === item.label ? `${id}-${item.label}` : undefined} onPointerEnter={() => setInspected(item.label)} onPointerLeave={() => setInspected(null)} onFocus={() => setInspected(item.label)} onBlur={() => setInspected(null)}><i style={{ '--context-color': item.label === 'Free' ? 'var(--context-free)' : categoryColor(item.label) } as CSSProperties} /><span>{item.label}</span><strong>{contextNumber(item.tokens)}</strong></button>
      {inspected === item.label && <div id={`${id}-${item.label}`} role="tooltip" className="context-category-detail"><strong>{item.label}</strong><span>{contextNumber(item.tokens)} of {contextNumber(value.total)} context tokens</span><span>{(item.tokens / value.total * 100).toFixed(1)}% of context capacity</span></div>}
    </div>)}</div>
    {!value.categorized && <p className="context-categories-note">Category breakdown unavailable</p>}
  </div>;
}
