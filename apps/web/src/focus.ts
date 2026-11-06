import { useLayoutEffect, useRef, type RefObject } from 'react';

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, iframe, [tabindex="0"]';

// Apply modal behavior to the existing DOM branch, preserving artifact identity.
export function useModalRegion(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void, initial: string, companion?: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close); closeRef.current = close;
  useLayoutEffect(() => {
    const region = ref.current;
    if (!active || !region) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = new Map<HTMLElement, boolean>();
    const obscure = () => {
      for (let branch: HTMLElement = region; branch.parentElement && branch !== document.body; branch = branch.parentElement) {
        // Native dialogs own their top-layer modality. Marking the dialog
        // itself inert would disable it even after showModal().
        for (const sibling of branch.parentElement.children) if (sibling !== branch && sibling !== companion?.current && sibling instanceof HTMLElement && !(sibling instanceof HTMLDialogElement) && !siblings.has(sibling)) {
          siblings.set(sibling, sibling.inert); sibling.inert = true;
        }
      }
    };
    obscure();
    const observer = new MutationObserver(obscure); observer.observe(document.body, { childList: true, subtree: true });
    const controls = () => Array.from(region.querySelectorAll<HTMLElement>(focusable)).filter(element => element.getClientRects().length && !element.closest('[inert], [hidden]'));
    const nativeModal = () => document.querySelector('dialog:modal') !== null;
    const focus = () => { if (!nativeModal()) (region.querySelector<HTMLElement>(initial) ?? controls()[0] ?? region).focus(); };
    focus();
    const key = (event: KeyboardEvent) => {
      if (nativeModal()) return;
      if (event.key === 'Escape') {
        const child=event.target instanceof Element?event.target.closest('[data-escape-scope]'):null;
        if(child&&child!==region&&region.contains(child))return;
        event.preventDefault(); event.stopPropagation(); closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const contain = (event: FocusEvent) => { if (!nativeModal() && !region.contains(event.target as Node)) focus(); };
    document.addEventListener('keydown', key, true); document.addEventListener('focusin', contain);
    return () => {
      observer.disconnect(); document.removeEventListener('keydown', key, true); document.removeEventListener('focusin', contain);
      siblings.forEach((wasInert, element) => { element.inert = wasInert; });
      if (previous?.isConnected) previous.focus();
    };
  }, [ref, active, initial, companion]);
}
