// Shared focus-retention guard for overlay primitives. When a focused control
// disables or unmounts, the browser drops focus to <body> and the focus trap
// breaks; pull focus back to the first usable control inside the overlay.
const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, iframe, [tabindex="0"]';

export function usableFocusable(root: HTMLElement): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>(focusable)).find(element => element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[inert], [hidden], [aria-hidden="true"]'));
}

/** Refocus only when focus has dropped to <body> (a disabled or removed control),
 * never stealing a deliberate focus move to another control. */
export function refocusWithin(root: HTMLElement): void {
  const document = root.ownerDocument;
  if (document.activeElement !== document.body) return;
  (usableFocusable(root) ?? root).focus();
}

/** Watch for focus escaping `root` to <body>. A drop caused by a control
 * disabling/unmounting has a null `relatedTarget`; a deliberate move to another
 * control carries a real `relatedTarget` and is left untouched. This is
 * event-driven (no per-render polling), so it cannot steal focus mid-click while
 * the browser is still transitioning focus to the clicked control.
 *
 * `schedule` defers the re-check until focus has settled. The outer modal defers
 * a frame so a nested popover's own (microtask) retention claims focus first and
 * is not yanked back out to the modal's first control. Returns a cleanup. */
export function retainFocus(document: Document, getRoot: () => HTMLElement | null, schedule: (callback: () => void) => void = callback => queueMicrotask(callback)): () => void {
  let active = true;
  const focusout = (event: FocusEvent) => {
    const root = getRoot();
    if (!root || event.relatedTarget || !root.contains(event.target as Node)) return;
    schedule(() => { if (active && getRoot() === root && root.isConnected) refocusWithin(root); });
  };
  document.addEventListener('focusout', focusout);
  return () => { active = false; document.removeEventListener('focusout', focusout); };
}
