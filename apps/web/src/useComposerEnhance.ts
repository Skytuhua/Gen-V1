import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError, postComposerEnhance } from './api';
import { journalCompareAndSwap, journalGeneration, journalSubscribe } from './journal';

export const ENHANCE_MAX_DRAFT_BYTES = 8 * 1024;
export const ENHANCE_UNAVAILABLE_TEXT = 'Enhance is unavailable for this model. You can still send your draft.';

export const enhanceText = {
  pending: 'Enhancing draft…',
  applied: 'Draft enhanced. Review or edit before sending.',
  unchanged: 'No changes suggested. Draft kept.',
  cancelled: 'Enhancement cancelled. Draft kept.',
  failed: "Couldn't enhance this draft. Try again.",
  timeout: 'Enhancement timed out. Try again.',
  busy: 'Enhance is busy. Try again.',
  unavailable: ENHANCE_UNAVAILABLE_TEXT,
} as const;

export type EnhancePhase = 'idle' | 'pending' | 'applied' | 'unchanged' | 'error' | 'cancelled';
export type ComposerEnhanceTarget = { kind: 'thread'; threadId: string; modelId?: string } | { kind: 'new'; modelId: string };

interface EnhanceOptions {
  journalKey: string;
  owner: () => string;
  text: () => string;
  target: () => ComposerEnhanceTarget;
  eligible: () => boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  button: RefObject<HTMLButtonElement | null>;
}

interface Slot { key: string; owner: string; generation: string | undefined; text: string; abort: AbortController }
interface Undo { key: string; owner: string; generation: string | undefined; original: string; applied: string }

const utf8 = (value: string) => new TextEncoder().encode(value).length;
export const validEnhancement = (value: string) => Boolean(value.trim()) && utf8(value) <= ENHANCE_MAX_DRAFT_BYTES && !/[\x00-\x08\x0B-\x1F\x7F-\x9F]/.test(value);

export function failureText(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'ENHANCE_TIMEOUT') return enhanceText.timeout;
    if (cause.code === 'ENHANCE_UNSUPPORTED' || cause.code === 'ENHANCE_UNAVAILABLE') return enhanceText.unavailable;
    if (cause.code === 'ENHANCE_BUSY' || cause.code === 'ENHANCE_STALE' || cause.code === 'ENHANCE_CANCELLED' || cause.code === 'STALE_REQUEST_CONTEXT' || cause.code.startsWith('ACCOUNT_')) return enhanceText.busy;
  }
  return enhanceText.failed;
}

// One explicit request slot per composer. Any newer journal generation, owner
// change or stale closure makes a late reply inert; success applies through the
// same conditional journal write every other draft edit uses.
export function useComposerEnhance(options: EnhanceOptions) {
  const latest = useRef(options);
  latest.current = options;
  const slot = useRef<Slot | null>(null);
  const finishing = useRef<Slot | null>(null);
  const undo = useRef<Undo | null>(null);
  const [phase, setPhase] = useState<EnhancePhase>('idle');
  const [message, setMessage] = useState('');

  const invalidate = useCallback(() => {
    const pendingSlot = slot.current;
    slot.current = null;
    finishing.current = null;
    pendingSlot?.abort.abort();
    undo.current = null;
    setPhase('idle');
    setMessage('');
  }, []);

  const cancel = useCallback(() => {
    const pendingSlot = slot.current;
    slot.current = null;
    finishing.current = null;
    pendingSlot?.abort.abort();
    undo.current = null;
    pendingSlot?.abort.abort();
    setPhase('cancelled');
    setMessage(enhanceText.cancelled);
  }, []);

  const finish = (nextPhase: EnhancePhase, text: string) => {
    slot.current = null;
    setPhase(nextPhase);
    setMessage(text);
  };

  const applyResult = (pendingSlot: Slot, result: { draft: string; usedProjectContext: boolean }) => {
    const now = latest.current;
    if (pendingSlot.abort.signal.aborted || slot.current !== pendingSlot || now.journalKey !== pendingSlot.key || now.owner() !== pendingSlot.owner || now.text() !== pendingSlot.text || journalGeneration(pendingSlot.key) !== pendingSlot.generation || !now.eligible()) return;
    if (result.draft.trim() === pendingSlot.text.trim()) { finish('unchanged', enhanceText.unchanged); return; }
    if (!validEnhancement(result.draft)) { finish('error', enhanceText.failed); return; }
    // The conditional write bumps the journal generation the same way a remote
    // edit would; move the slot aside first so our own write stays untouched
    // while a genuine external edit still fails the compare.
    slot.current = null;
    finishing.current = pendingSlot;
    void journalCompareAndSwap(pendingSlot.key, pendingSlot.generation, result.draft).then(committed => {
      const current = latest.current;
      if (pendingSlot.abort.signal.aborted || finishing.current !== pendingSlot) return;
      finishing.current = null;
      if (!committed || current.journalKey !== pendingSlot.key || current.owner() !== pendingSlot.owner) { finish('idle', ''); return; }
      undo.current = { key: pendingSlot.key, owner: pendingSlot.owner, generation: journalGeneration(pendingSlot.key), original: pendingSlot.text, applied: result.draft };
      setPhase('applied');
      setMessage(enhanceText.applied);
      const textarea = current.input.current;
      if (current.button.current && document.activeElement === current.button.current) {
        textarea?.focus();
      }
      if (textarea && document.activeElement === textarea) textarea.setSelectionRange(result.draft.length, result.draft.length);
    }, () => { if (!pendingSlot.abort.signal.aborted && finishing.current === pendingSlot) { finishing.current = null; finish('error', enhanceText.failed); } });
  };

  const start = useCallback(() => {
    const now = latest.current;
    if (slot.current || !now.eligible()) return;
    const text = now.text();
    if (!text.trim() || utf8(text) > ENHANCE_MAX_DRAFT_BYTES) return;
    undo.current = null;
    const pendingSlot: Slot = { key: now.journalKey, owner: now.owner(), generation: journalGeneration(now.journalKey), text, abort: new AbortController() };
    slot.current = pendingSlot;
    setPhase('pending');
    setMessage(enhanceText.pending);
    postComposerEnhance({ draft: text, target: now.target() }, pendingSlot.abort.signal)
      .then(result => { if (!pendingSlot.abort.signal.aborted && slot.current === pendingSlot) applyResult(pendingSlot, result); })
      .catch(cause => { if (!pendingSlot.abort.signal.aborted && slot.current === pendingSlot) finish('error', failureText(cause)); });
  }, []);

  const restore = useCallback(() => {
    const prior = undo.current;
    const now = latest.current;
    if (!prior || prior.key !== now.journalKey || prior.owner !== now.owner() || now.text() !== prior.applied || journalGeneration(prior.key) !== prior.generation) { undo.current = null; setPhase('idle'); setMessage(''); return; }
    undo.current = null;
    void journalCompareAndSwap(prior.key, prior.generation, prior.original).then(committed => {
      if (committed) {
        const textarea = latest.current.input.current;
        textarea?.focus();
        textarea?.setSelectionRange(prior.original.length, prior.original.length);
      }
    }).catch(() => {});
    setPhase('idle');
    setMessage('');
  }, []);

  // A newer generation from any window/owner revokes pending and undo state.
  useEffect(() => journalSubscribe(options.journalKey, () => {
    if (slot.current && journalGeneration(slot.current.key) !== slot.current.generation) invalidate();
    else if (undo.current && journalGeneration(undo.current.key) !== undo.current.generation) { undo.current = null; setPhase('idle'); setMessage(''); }
  }), [options.journalKey, invalidate]);

  useEffect(() => () => { slot.current?.abort.abort(); slot.current = null; }, []);

  return { phase, message, start, cancel, invalidate, restore, pending: phase === 'pending' };
}
