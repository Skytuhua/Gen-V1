import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { RuntimeUsage } from '../../../packages/contracts';
import { Popover } from '../../../packages/ui-shell/Popover';
import { isComposing } from '../../../packages/ui-shell/list-navigation';
import './context-inspector.css';

const contextFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const detailFormatter = new Intl.NumberFormat();
export const contextNumber = (tokens: number) => contextFormatter.format(tokens);
export const contextTokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
interface ContextCategoryReport { label: string; tokens: number; subitems?: { label: string; tokens: number }[] }
export type ContextUsage = Omit<RuntimeUsage, 'contextBreakdown'> & { contextBreakdown?: ContextCategoryReport[] };
const labels = ['System', 'Tools & MCP', 'Skills', 'Messages', 'Reserved', 'Free'] as const;
function categoryLabel(label: string) {
  if (/^(tools|mcp|tools & mcp)$/i.test(label)) return 'Tools & MCP';
  if (/^(messages|conversation)$/i.test(label)) return 'Messages';
  return labels.find(value => value.toLowerCase() === label.toLowerCase());
}

export function contextSegments(usage?: ContextUsage) {
  if (!contextTokenCount(usage?.contextTokens) || !contextTokenCount(usage.contextWindow) || usage.contextWindow === 0 || usage.contextTokens > usage.contextWindow) return null;
  const used = usage.contextTokens, total = usage.contextWindow, ratio = used / total * 100;
  const reported = Array.isArray(usage.contextBreakdown) ? usage.contextBreakdown : undefined;
  const mapped = reported?.every(item => item && typeof item === 'object') ? reported.map(item => ({ ...item, label: typeof item.label === 'string' ? categoryLabel(item.label.trim()) : undefined })) : undefined;
  const allocated = mapped?.filter(item => item.label !== 'Free' && item.label !== 'Reserved').reduce((sum, item) => sum + item.tokens, 0) ?? 0;
  const reserved = mapped?.find(item => item.label === 'Reserved')?.tokens ?? 0;
  const free = mapped?.find(item => item.label === 'Free')?.tokens;
  const valid = Boolean(mapped?.length && mapped.length <= 6 && new Set(mapped.map(item => item.label)).size === mapped.length &&
    mapped.every(item => item.label && contextTokenCount(item.tokens)) && allocated <= used && used + reserved + (free ?? 0) <= total);
  const categories = valid ? mapped!.map(item => ({ ...item, label: item.label!, width: item.tokens / total * 100,
    subitems: Array.isArray(item.subitems) && item.subitems.length <= 100 && item.subitems.every(child => child && typeof child.label === 'string' && child.label.trim() && contextTokenCount(child.tokens)) && item.subitems.reduce((sum, child) => sum + child.tokens, 0) <= item.tokens ? item.subitems : undefined,
  })).sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label)) : [];
  return { used, total, ratio, free: valid ? free : undefined, categorized: valid,
    complete: valid && allocated === used && used + reserved + (free ?? 0) === total, categories };
}
function categoryColor(label: string) {
  return `var(--context-${label === 'Tools & MCP' ? 'tools' : label.toLowerCase()})`;
}

function Category({ item, total, id, open, animated, enter, leave, focus, blur, dismiss }: {
  item: ContextCategoryReport & { width: number }; total: number; id: string; open: boolean; animated: boolean;
  enter: () => void; leave: () => void; focus: () => void; blur: () => void; dismiss: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null), detail = useRef<HTMLDivElement>(null);
  return <div className="context-category-entry">
    <button ref={anchor} className="context-category-row" type="button" aria-describedby={open ? id : undefined}
      onPointerEnter={enter} onPointerLeave={leave} onFocus={focus} onBlur={blur}
      onKeyDown={event => {
        if (isComposing(event)) return;
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); dismiss(); }
        if (open && (event.key === 'PageDown' || event.key === 'PageUp')) { event.preventDefault(); detail.current?.scrollBy({ top: event.key === 'PageDown' ? 100 : -100 }); }
      }}>
      <i aria-hidden="true" style={{ '--context-color': categoryColor(item.label) } as CSSProperties} /><span>{item.label}</span><strong>{contextNumber(item.tokens)}</strong>
    </button>
    <Popover anchor={anchor} contentRef={detail} open={open} width={220} height={Math.min(360, 90 + (item.subitems?.length ?? (item.label === 'Reserved' ? 1 : 0)) * 28)}
      role="tooltip" id={id} className="context-category-detail" data-entrance={animated ? 'pointer' : 'focus'} onDismiss={dismiss}>
      <strong>{item.label}</strong><span>{detailFormatter.format(item.tokens)} tokens · {(item.tokens / total * 100).toFixed(1)}%</span>
      <div className="context-subitems">{item.subitems?.map((child, index) => <div className="context-subitem" key={index}><span>{child.label}</span><span>{detailFormatter.format(child.tokens)}</span></div>)}</div>
      {item.label === 'Reserved' && !item.subitems?.length && <span>Capacity reserved by the runtime.</span>}
    </Popover>
  </div>;
}

export function ContextMeter({ usage, busy = false, accepted = false }: { usage?: ContextUsage; busy?: boolean; accepted?: boolean }) {
  const value = contextSegments(usage), id = useId();
  // During compaction the last valid report stays displayed until fresh valid
  // source data arrives; ownership change remounts this component.
  const lastValid = useRef(value);
  if (value) lastValid.current = value;
  const shown = value ?? (busy ? lastValid.current : null);
  const [hoveredId, setHoveredId] = useState<string | null>(null), [focusedId, setFocusedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null), [pointerOpen, setPointerOpen] = useState(false);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null), suppressed = useRef<string | null>(null);
  const cancel = () => { if (dwell.current) { clearTimeout(dwell.current); dwell.current = null; } };
  useEffect(() => cancel, []);
  const show = (key: string, pointer: boolean) => { setOpenId(key); setPointerOpen(pointer); };
  const enter = (key: string) => {
    suppressed.current = null; // a fresh pointer entry lifts Escape suppression
    setHoveredId(key);
    if (focusedId) return; // keyboard focus keeps priority until blur
    if (openId) { cancel(); if (openId !== key) show(key, true); return; }
    cancel(); dwell.current = setTimeout(() => { dwell.current = null; show(key, true); }, 200);
  };
  const leave = (key: string) => setHoveredId(current => current === key ? null : current);
  const gridLeave = () => { cancel(); setHoveredId(null); if (!focusedId) setOpenId(null); };
  const focus = (key: string) => { setFocusedId(key); suppressed.current = null; cancel(); show(key, false); };
  const blur = (key: string) => {
    setFocusedId(current => current === key ? null : current);
    if (openId === key) setOpenId(hoveredId);
  };
  const dismiss = (key: string) => { suppressed.current = key; cancel(); setOpenId(current => current === key ? null : current); };
  if (!shown) return <div className="context-meter"><div className="context-meter-unknown" aria-label="Context measurement not reported" /><p className="context-categories-note">Not reported</p></div>;
  return <div className={`context-meter${accepted ? ' context-measurement-accepted' : ''}`} role="group" aria-label="Reported context breakdown" aria-busy={busy}>
    <progress className="sr-only" aria-label="Context used" value={shown.ratio} max={100} />
    <div className="context-segment-bar" aria-hidden="true">{shown.categories.map(item => <i key={item.label} style={{ width: `${item.width}%`, '--context-color': categoryColor(item.label) } as CSSProperties} className="context-segment" />)}{busy && <span className="context-compaction-shimmer" />}</div>
    <div className="context-category-grid" onPointerLeave={gridLeave}>{shown.categories.map((item, index) => {
      const key = item.label;
      return <Category key={key} item={item} total={shown.total} id={`${id}-${index}`}
        open={openId === key && suppressed.current !== key} animated={pointerOpen}
        enter={() => enter(key)} leave={() => leave(key)} focus={() => focus(key)} blur={() => blur(key)} dismiss={() => dismiss(key)} />;
    })}</div>
    {!shown.categorized && <p className="context-categories-note">Category breakdown not reported</p>}
    {shown.categorized && !shown.complete && <p className="context-categories-note">Partial category breakdown</p>}
  </div>;
}
