import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RuntimeUsage, Thread } from '../../../packages/contracts';
import { command } from './api';
import { ContextMeter, contextNumber, contextSegments } from './ContextMeter';
import { reducedMotion } from './task-motion';
import { unavailableCompaction } from './runtime-presentation';
import './context-inspector.css';

type Receipt = { before: number; after: number; window: number };
type SessionView = { requested?: { tokens: number; window: number }; receipt?: Receipt };
// Presentation feedback only. Host usage and operation records remain authoritative.
const sessions = new Map<string, SessionView>();
function sessionView(key: string) {
  let view = sessions.get(key);
  if (!view) { view = {}; sessions.set(key, view); if (sessions.size > 32) sessions.delete(sessions.keys().next().value!); }
  return view;
}

function useAcceptedMeasurement(usage: RuntimeUsage | undefined, identity: string) {
  const [displayed, setDisplayed] = useState(usage);
  const current = useRef(usage), previousIdentity = useRef(identity);
  const measurement = JSON.stringify([usage?.contextTokens, usage?.contextWindow, usage?.contextBreakdown]);
  useEffect(() => {
    const before = current.current, target = usage;
    if (previousIdentity.current !== identity || !before || !target || reducedMotion() || before.contextWindow !== target.contextWindow || before.contextTokens == null || target.contextTokens == null || before.contextTokens === target.contextTokens) {
      previousIdentity.current = identity; current.current = target; setDisplayed(target); return;
    }
    const started = performance.now();
    let frame = 0;
    const advance = (now: number) => {
      const progress = Math.min(1, (now - started) / 1800), eased = progress < .5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      let contextTokens = before.contextTokens! + (target.contextTokens! - before.contextTokens!) * eased;
      const matching = before.contextBreakdown?.length === target.contextBreakdown?.length && target.contextBreakdown?.every((item, index) => item.label === before.contextBreakdown?.[index]?.label);
      const contextBreakdown = matching ? target.contextBreakdown?.map((item, index) => ({ ...item, tokens: before.contextBreakdown![index]!.tokens + (item.tokens - before.contextBreakdown![index]!.tokens) * eased })) : undefined;
      // Floating-point interpolation must not briefly invalidate a complete
      // source breakdown because its independently summed parts differ by epsilon.
      if (contextBreakdown) contextTokens = Math.max(contextTokens, contextBreakdown.reduce((sum, item) => sum + item.tokens, 0));
      const next = progress === 1 ? target : { ...target, contextTokens, contextBreakdown };
      current.current = next; setDisplayed(next);
      if (progress < 1) frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [measurement, identity]);
  return displayed;
}

function Quota({ label, value }: { label: string; value: number | null | undefined }) {
  const valid = value != null && Number.isFinite(value) && value >= 0 && value <= 100;
  return <div className="context-quota"><div><span>{label}</span><strong>{valid ? `${Math.round(value)}%` : 'Unavailable'}</strong></div>{valid && <div className="context-quota-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${value}%` }} /></div>}</div>;
}

export function ContextInspector({ usage, thread, close, refresh, onError }: { usage: RuntimeUsage | undefined; thread: Thread | undefined; close: () => void; refresh: () => Promise<void>; onError?: (message: string) => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement|null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const identity = `${thread?.id ?? 'none'}:${thread?.sessionPath ?? 'none'}`;
  const displayed = useAcceptedMeasurement(usage, identity), measured = contextSegments(displayed);
  const [error, setError] = useState(''), [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState(() => sessionView(identity).receipt);
  const unavailable = unavailableCompaction(thread);
  useLayoutEffect(() => {
    const element = panel.current!;
    const align = () => {
      element.style.setProperty('--context-edge-shift', '0px');
      const bounds = element.getBoundingClientRect();
      const shift = bounds.left < 12 ? 12 - bounds.left : bounds.right > innerWidth - 12 ? innerWidth - 12 - bounds.right : 0;
      element.style.setProperty('--context-edge-shift', `${shift}px`);
    };
    align(); window.addEventListener('resize', align);
    const observer = new ResizeObserver(align); observer.observe(element);
    return () => { observer.disconnect(); window.removeEventListener('resize', align); };
  }, []);
  useEffect(() => {
    const view = sessionView(identity), accepted = contextSegments(usage);
    if (view.requested && accepted && usage?.activity !== 'compacting' && accepted.total === view.requested.window && accepted.used < view.requested.tokens) {
      view.receipt = { before: view.requested.tokens, after: accepted.used, window: accepted.total }; delete view.requested;
    }
    setReceipt(view.receipt);
  }, [usage, identity]);
  const compact = async () => {
    if (!thread || submitting || unavailable) return;
    setSubmitting(true); setError('');
    const accepted = contextSegments(usage), view = sessionView(identity);
    if (accepted) view.requested = { tokens: accepted.used, window: accepted.total };
    try { await command('run.compact', {}, thread.id); await refresh(); }
    catch (cause) { delete view.requested; const message = cause instanceof Error ? cause.message : 'Context could not be compacted. Try again.'; setError(message); onError?.(message); }
    finally { setSubmitting(false); }
  };
  const compacting = usage?.activity === 'compacting';
  const countersSettled = displayed?.contextTokens === usage?.contextTokens && displayed?.contextWindow === usage?.contextWindow;
  const activity = compacting ? 'Summarizing messages' : !unavailable && receipt ? countersSettled ? `Freed ${contextNumber(receipt.before - receipt.after)} tokens` : '' : usage?.activity === 'running' ? 'Agent working' : usage?.activity === 'retrying' ? 'Retrying' : unavailable?.status ?? 'Context ready';
  return <div ref={panel} className="context-popover context-inspector" role="dialog" aria-label="Context inspector" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();if(opener.current?.isConnected)opener.current.focus({preventScroll:true});}}}>
    <header><strong>Context <span>{measured ? `${Math.round(measured.ratio)}%` : 'Unavailable'}</span></strong>{measured&&<span className="context-inspector-total">{contextNumber(measured.used)} of {contextNumber(measured.total)}</span>}</header>
    <div className="context-inspector-breakdown">{measured?<div className="context-inspector-track" role="progressbar" aria-label="Context used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={measured.ratio} aria-valuetext={`${contextNumber(measured.used)} of ${contextNumber(measured.total)} tokens`}><i style={{width:`${measured.ratio}%`}}/>{compacting&&<span className="context-compaction-shimmer" aria-hidden="true"/>}</div>:<div className="context-meter-unknown" aria-label="Context measurement unavailable"/>}</div>
    <div className="context-inspector-quotas"><Quota label="Session limit" value={usage?.sessionPercent} /><Quota label="Weekly limit" value={usage?.weeklyPercent} /></div>
    <details className="context-inspector-details"><summary>Usage details</summary><ContextMeter usage={displayed} busy={compacting}/><dl><dt>Input tokens</dt><dd>{usage?.inputTokens == null ? 'Unavailable' : contextNumber(usage.inputTokens)}</dd><dt>Output tokens</dt><dd>{usage?.outputTokens == null ? 'Unavailable' : contextNumber(usage.outputTokens)}</dd><dt>Cost</dt><dd>{usage?.cost == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(usage.cost)}</dd></dl></details>
    <footer><span role="status" aria-live="polite">{activity}</span><button className="accent-button" disabled={!thread?.sessionPath || Boolean(thread.runId) || compacting || submitting || Boolean(unavailable)} title={unavailable?.reason ?? (!thread?.sessionPath ? 'Start a session before compacting context.' : undefined)} aria-description={unavailable?.reason} onClick={() => void compact()}>{compacting ? 'Compacting…' : 'Compact now'}</button></footer>
    {error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
