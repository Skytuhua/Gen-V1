import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tokens.css';
import './feedback.css';

interface Shown { text: string; target: Element; leaving: boolean }
const FOCUS_DWELL_MS = 100, GAP = 6, GUTTER = 8;
/** Elements whose `title` removal came from `adopt` itself, not a rerender. */
const selfRemoval = new WeakSet<Element>();

/** Reads the tooltip text and silences the native bubble so only one tooltip shows. */
function adopt(target: Element) {
  const title = target.getAttribute('title');
  if (title !== null) {
    selfRemoval.add(target);
    target.removeAttribute('title');
    target.setAttribute('data-tooltip', title);
    target.setAttribute('data-tooltip-adopted', '');
    // A title was the control's only name; keep it reachable for assistive technology.
    if (title && !target.hasAttribute('aria-labelledby') && (!target.hasAttribute('aria-label') || target.hasAttribute('data-tooltip-named')) && !target.textContent?.trim()) {
      target.setAttribute('aria-label', title);
      target.setAttribute('data-tooltip-named', '');
      if (target.hasAttribute('data-tooltip-described')) { target.removeAttribute('aria-description'); target.removeAttribute('data-tooltip-described'); }
    } else if (title && !target.hasAttribute('aria-describedby') && (target.hasAttribute('data-tooltip-described') || !target.hasAttribute('aria-description'))) {
      // Named controls still get the title's help text via aria-description; keep it in sync when the title changes.
      target.setAttribute('aria-description', title);
      target.setAttribute('data-tooltip-described', '');
    }
  }
  const text = target.getAttribute('data-tooltip')?.trim() ?? '';
  return text && text !== target.textContent?.trim() ? text : '';
}
const owner = (node: EventTarget | null) => node instanceof Element ? node.closest('[title],[data-tooltip]') : null;

/** Mount once per window: every `title` or `data-tooltip` in the document gets the shared tooltip. */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null), [position, setPosition] = useState<{ left: number; top: number; side: 'above' | 'below' } | null>(null);
  const bubble = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), current = useRef<Element | null>(null);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); current.current = null; setShown(value => value && !value.leaving ? { ...value, leaving: true } : value); };
    const schedule = (target: Element, delay: number) => {
      if (current.current === target) return;
      const text = adopt(target);
      hide();
      if (!text) return;
      current.current = target;
      timer.current = setTimeout(() => { if (current.current === target && target.isConnected) { setPosition(null); setShown({ text, target, leaving: false }); } }, delay);
    };
    const dwell = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-tooltip-dwell')) || 350;
    const over = (event: PointerEvent) => { if (event.pointerType === 'touch') return; const target = owner(event.target); if (target) schedule(target, dwell()); else if (current.current) hide(); };
    const focus = (event: FocusEvent) => { const target = owner(event.target); if (target && event.target instanceof Element && event.target.matches(':focus-visible')) schedule(target, FOCUS_DWELL_MS); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && current.current) { event.preventDefault(); event.stopPropagation(); hide(); } };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    document.addEventListener('pointerover', over); document.addEventListener('pointerout', leave); document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus); document.addEventListener('focusout', hide); document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type !== 'attributes' || record.attributeName !== 'title' || !(record.target instanceof Element)) continue;
        const element = record.target;
        if (selfRemoval.has(element)) { selfRemoval.delete(element); continue; }
        if (element.hasAttribute('title') || !element.hasAttribute('data-tooltip-adopted')) continue;
        // A rerender removed the source title: drop the mirrored tooltip and generated names.
        element.removeAttribute('data-tooltip'); element.removeAttribute('data-tooltip-adopted');
        if (element.hasAttribute('data-tooltip-named')) { element.removeAttribute('aria-label'); element.removeAttribute('data-tooltip-named'); }
        if (element.hasAttribute('data-tooltip-described')) { element.removeAttribute('aria-description'); element.removeAttribute('data-tooltip-described'); }
        if (current.current === element) hide();
      }
    });
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['title'] });
    return () => {
      observer.disconnect();
      clearTimeout(timer.current);
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', leave); document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide); document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shown || shown.leaving || !bubble.current) return;
    if (!shown.target.isConnected) { setShown(null); return; }
    const anchor = shown.target.getBoundingClientRect(), box = bubble.current.getBoundingClientRect();
    const side = anchor.top - box.height - GAP >= GUTTER ? 'above' : 'below';
    setPosition({ side, top: side === 'above' ? anchor.top - box.height - GAP : anchor.bottom + GAP,
      left: Math.max(GUTTER, Math.min(window.innerWidth - box.width - GUTTER, anchor.left + anchor.width / 2 - box.width / 2)) });
  }, [shown]);

  useEffect(() => {
    if (!shown?.leaving) return;
    const running = bubble.current?.getAnimations?.() ?? [];
    if (!running.length) { setShown(null); return; }
    let cancelled = false;
    void Promise.allSettled(running.map(animation => animation.finished)).then(() => { if (!cancelled) setShown(value => value?.leaving ? null : value); });
    return () => { cancelled = true; };
  }, [shown]);

  if (!shown) return null;
  // The top layer of an open modal dialog would cover a body-level tooltip.
  const root = shown.target.closest('dialog[open]') ?? document.body;
  return createPortal(<div ref={bubble} className="ui-tooltip" role="tooltip" data-state={shown.leaving ? 'closed' : 'open'} data-side={position?.side}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>{shown.text}</div>, root);
}
