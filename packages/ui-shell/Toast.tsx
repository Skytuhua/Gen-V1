import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './tokens.css';
import './feedback.css';

export type ToastTone = 'info' | 'success' | 'error';
export interface ToastOptions { tone?: ToastTone; action?: { label: string; onClick: () => void }; durationMs?: number }
interface ToastEntry extends ToastOptions { id: number; message: string; leaving: boolean }

const VISIBLE_MS = 6000, MAX_VISIBLE = 3;
let entries: ToastEntry[] = [], nextId = 1;
const listeners = new Set<() => void>();
const publish = (next: ToastEntry[]) => { entries = next; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Shows a transient notification; repeating the newest message restarts it instead of stacking. */
export function toast(message: string, options: ToastOptions = {}) {
  const text = message.trim();
  if (!text) return 0;
  const id = nextId++;
  publish([...entries.filter(entry => entry.message !== text).slice(-(MAX_VISIBLE - 1)), { ...options, id, message: text, leaving: false }]);
  return id;
}
export function dismissToast(id: number) { publish(entries.map(entry => entry.id === id ? { ...entry, leaving: true } : entry)); }
const remove = (id: number) => publish(entries.filter(entry => entry.id !== id));

const icons = { info: Info, success: CheckCircle2, error: AlertCircle };

function ToastItem({ entry, paused }: { entry: ToastEntry; paused: boolean }) {
  const element = useRef<HTMLDivElement>(null), remaining = useRef(entry.durationMs ?? VISIBLE_MS);
  useEffect(() => {
    if (paused || entry.leaving) return;
    const started = Date.now(), timer = setTimeout(() => dismissToast(entry.id), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(1000, remaining.current - (Date.now() - started)); };
  }, [paused, entry.leaving, entry.id]);
  useEffect(() => {
    if (!entry.leaving) return;
    const running = element.current?.getAnimations?.() ?? [];
    if (!running.length) { remove(entry.id); return; }
    let cancelled = false;
    void Promise.allSettled(running.map(animation => animation.finished)).then(() => { if (!cancelled) remove(entry.id); });
    return () => { cancelled = true; };
  }, [entry.leaving, entry.id]);
  const tone = entry.tone ?? 'info', Icon = icons[tone];
  return <div ref={element} className="ui-toast" data-tone={tone} data-state={entry.leaving ? 'closed' : 'open'} role={tone === 'error' ? 'alert' : 'status'}>
    <Icon size={15} aria-hidden="true" /><span>{entry.message}</span>
    {entry.action && <button type="button" className="ui-toast-action" onClick={() => { entry.action?.onClick(); dismissToast(entry.id); }}>{entry.action.label}</button>}
    <button type="button" className="ui-toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(entry.id)}><X size={14} /></button>
  </div>;
}

/** Mount once per window. Timers pause while the stack is hovered or holds focus. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => entries, () => entries);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  useEffect(() => { if (!list.length) { setHovered(false); setFocused(false); } }, [list.length]);
  return <div className="ui-toaster" role="region" aria-label="Notifications" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {list.map(entry => <ToastItem key={entry.id} entry={entry} paused={hovered || focused} />)}
  </div>;
}
