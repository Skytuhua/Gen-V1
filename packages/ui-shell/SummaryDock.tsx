import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './summary-dock.css';

interface SummaryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const keyFor = (id: string) => `harness:summary:${id}:v1`;
function browserStorage(): SummaryStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
export function readSummaryCollapsed(id: string, fallback: boolean, storage = browserStorage()): boolean {
  try {
    for (const key of [keyFor(id), `harness:floating:${id}:v1`]) {
      const raw = storage?.getItem(key);
      if (!raw || raw.length > 1024) continue;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { continue; }
      if (value && typeof value === 'object' && !Array.isArray(value) && 'collapsed' in value && typeof value.collapsed === 'boolean') return value.collapsed;
    }
  } catch { /* Collapse remains usable when local preference storage is blocked. */ }
  return fallback;
}
export function writeSummaryCollapsed(id: string, collapsed: boolean, storage = browserStorage()): void {
  try { storage?.setItem(keyFor(id), JSON.stringify({ collapsed })); } catch { /* Keep the current disclosure state in memory. */ }
}

export interface DockedSummaryProps {
  id: string; title: string; children: ReactNode; open?: boolean; defaultCollapsed?: boolean;
  summary?: ReactNode; collapsedLabel?: string; minimizeLabel?: string; ariaLabel?: string;
  className?: string; focusOnOpen?: boolean; expandRequest?: number;
}
export function DockedSummary({ id, title, children, open = true, defaultCollapsed = true, summary, collapsedLabel,
  minimizeLabel, ariaLabel, className = '', focusOnOpen = false, expandRequest }: DockedSummaryProps) {
  const [collapsed, setCollapsed] = useState(() => readSummaryCollapsed(id, defaultCollapsed));
  const panel = useRef<HTMLElement>(null), disclosure = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null);
  const previousOpen = useRef<boolean | undefined>(undefined), bodyId = useId();
  const appliedExpansion = useRef<number | undefined>(undefined);
  const change = (next: boolean) => { setCollapsed(next); writeSummaryCollapsed(id, next); };
  useEffect(() => {
    const timer = setTimeout(() => writeSummaryCollapsed(id, collapsed), 120);
    return () => clearTimeout(timer);
  }, [id, collapsed]);
  useLayoutEffect(() => {
    const previous = previousOpen.current; previousOpen.current = open;
    if (!open) {
      if (previous && panel.current?.contains(document.activeElement) && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      return;
    }
    if (previous === false) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (focusOnOpen) disclosure.current?.focus({ preventScroll: true });
    }
  }, [open, focusOnOpen]);
  useLayoutEffect(() => {
    // A publication can expand the summary without taking focus or undoing a later manual collapse.
    if (expandRequest === undefined || !open || appliedExpansion.current === expandRequest) return;
    appliedExpansion.current = expandRequest; change(false);
  }, [expandRequest, open]);
  return <section ref={panel} className={`docked-summary ${className}`} aria-label={ariaLabel ?? `${title} window`}
    hidden={!open} data-collapsed={collapsed} data-summary-id={id} onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || collapsed) return;
      event.preventDefault(); event.stopPropagation(); change(true); disclosure.current?.focus({ preventScroll: true });
    }}>
    <header className="docked-summary-header"><button ref={disclosure} type="button" className="docked-summary-toggle"
      aria-label={collapsed ? collapsedLabel ?? `Expand ${title}` : minimizeLabel ?? `Collapse ${title}`}
      aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => change(!collapsed)}>
      <strong>{title}</strong>{summary != null && collapsed && <span className="docked-summary-caption" aria-hidden="true">{summary}</span>}
      <ChevronDown size={14} aria-hidden="true" />
    </button></header>
    <div id={bodyId} className="docked-summary-content" hidden={collapsed} inert={collapsed || !open} aria-hidden={collapsed || !open}>{children}</div>
  </section>;
}

export function SummaryDock({ children }: { children: ReactNode }) {
  return <aside className="summary-dock" aria-label="Conversation summaries">{children}</aside>;
}
export function SummaryLayout({ children, summaries, active }: { children: ReactNode; summaries: ReactNode; active: boolean }) {
  return <div className="summary-layout-owner"><div className="summary-layout" data-summaries={active}>{children}{summaries}</div></div>;
}
