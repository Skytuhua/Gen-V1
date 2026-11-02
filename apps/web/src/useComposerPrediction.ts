import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Snapshot, Thread } from '../../../packages/contracts';
import { getComposerPrediction } from './api';

interface Options {
  thread: Thread | undefined;
  snapshot: Snapshot;
  modelId: string;
  enabled: boolean;
  ready: boolean;
  blocked: boolean;
  draft: string;
  generation: string | undefined;
  input: RefObject<HTMLTextAreaElement | null>;
}
interface Slot { threadId: string; replyId: string; modelId: string; context: string; generation: string | undefined; attempted: boolean }

// Keep this independent of event transport: native windows publish snapshots,
// while browser windows may publish SSE. A mounted composer must witness a run.
export function useComposerPrediction(options: Options) {
  const { thread, snapshot, modelId, enabled, ready, blocked, draft, generation, input } = options;
  const messages = snapshot.messages.filter(message => message.threadId === thread?.id && (message.role === 'user' || message.role === 'assistant'));
  const context = JSON.stringify([thread?.id, thread?.epoch, thread?.accountId, thread?.modelId, modelId, messages]);
  const working = Boolean(thread?.runId) || thread?.status === 'working';
  const gated = snapshot.requests.some(request => request.threadId === thread?.id && request.status === 'pending') || snapshot.operations.some(operation => operation.threadId === thread?.id && ['prepared', 'running', 'unknown'].includes(operation.status));
  const [candidate, setCandidate] = useState('');
  const [editing, setEditing] = useState(false);
  const observedRun = useRef<{ id: string; epoch: number; modelId: string; accountId: string | null | undefined } | null>(null);
  const slot = useRef<Slot | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(options); latest.current = options;
  const contextLatest = useRef(context); contextLatest.current = context;
  const editingNow = () => Boolean(input.current && document.activeElement === input.current && document.hasFocus() && document.visibilityState === 'visible' && !input.current.closest('[inert]') && !document.querySelector('dialog[open], [aria-modal="true"]'));
  const dismiss = useCallback(() => {
    clearTimeout(timer.current); timer.current = undefined;
    controller.current?.abort(); controller.current = null;
    slot.current = null; setCandidate('');
  }, []);
  useEffect(() => {
    const update = () => { const active = editingNow(); setEditing(active); if (!active) dismiss(); };
    const element = input.current;
    element?.addEventListener('focus', update); element?.addEventListener('blur', update);
    window.addEventListener('focus', update); window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => { element?.removeEventListener('focus', update); element?.removeEventListener('blur', update); window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update); };
  }, [dismiss, input]);
  useLayoutEffect(() => {
    if (working) {
      dismiss();
      if (thread?.runId && (observedRun.current?.id !== thread.runId || observedRun.current.epoch !== thread.epoch)) observedRun.current = { id: thread.runId, epoch: thread.epoch, modelId, accountId: thread.accountId };
      return;
    }
    const run = observedRun.current;
    observedRun.current = null;
    if (run) {
      dismiss();
      const reply = messages.at(-1);
      if (enabled && ready && !blocked && !gated && !draft && editingNow() && thread && ['ready', 'completed'].includes(thread.status) && thread.epoch === run.epoch && run.modelId === modelId && run.accountId === thread.accountId && reply?.role === 'assistant' && reply.runId === run.id && reply.content.trim()) {
        slot.current = { threadId: thread.id, replyId: reply.id, modelId, context, generation, attempted: false };
      }
    }
    const current = slot.current;
    if (!current) return;
    if (!enabled || !ready || blocked || gated || draft || !editingNow() || current.context !== context || current.generation !== generation) { dismiss(); return; }
    if (current.attempted || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      const now = latest.current;
      if (slot.current !== current || !editingNow() || !now.enabled || !now.ready || now.blocked || now.draft || now.generation !== current.generation || contextLatest.current !== current.context) { dismiss(); return; }
      current.attempted = true;
      const abort = new AbortController(); controller.current = abort;
      void getComposerPrediction({ threadId: current.threadId, replyId: current.replyId, modelId: current.modelId }, abort.signal).then(result => {
        const now = latest.current;
        if (abort.signal.aborted || slot.current !== current || !editingNow() || now.draft || now.generation !== current.generation || contextLatest.current !== current.context || !now.enabled || now.blocked) return;
        // Text-only, bounded defense in depth; invalid provider output stays quiet.
        if (result.replyId === current.replyId && result.modelId === current.modelId && typeof result.suggestion === 'string' && result.suggestion.trim() && [...result.suggestion].length <= 280 && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(result.suggestion)) setCandidate(result.suggestion);
      }).catch(() => { /* Optional prediction errors never replace composer errors. */ });
    }, 300);
  }, [thread?.runId, thread?.status, thread?.epoch, thread?.accountId, modelId, working, context, enabled, ready, blocked, gated, draft, generation, editing, dismiss]);
  useEffect(() => () => { clearTimeout(timer.current); controller.current?.abort(); }, []);
  // Synchronous checks close the response -> keystroke and render -> effect gaps.
  const take = () => {
    const current = slot.current;
    if (!candidate || !current || !editingNow() || latest.current.draft || latest.current.generation !== current.generation || contextLatest.current !== current.context || !latest.current.enabled || latest.current.blocked) return null;
    const value = candidate; dismiss(); return value;
  };
  return { candidate, dismiss, take };
}
