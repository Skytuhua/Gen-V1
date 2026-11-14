import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { placePopover, type PopoverPlacement } from './overlay-position';
import { retainFocus } from './focus-retention';
import './tokens.css';

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  anchor: RefObject<HTMLElement | null>;
  contentRef?: RefObject<HTMLDivElement | null>;
  initialFocus?: RefObject<HTMLElement | null>;
  open: boolean;
  present?: boolean;
  width: number;
  height: number;
  preferredSide?: 'above' | 'below';
  align?: 'start' | 'end';
  layoutRevision?: number;
  onDismiss: () => void;
  onReady?: () => void;
  children: ReactNode;
}

export function Popover({ anchor, contentRef, initialFocus, open, present, width, height, preferredSide, align, layoutRevision,
  onDismiss, onReady, children, className = '', style, onKeyDown, ...attributes }: PopoverProps) {
  const ownRef = useRef<HTMLDivElement>(null), content = contentRef ?? ownRef;
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  const ready = useRef(onReady); ready.current = onReady;
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  // Without an owner-managed `present`, stay mounted until the CSS exit finishes.
  const [exit, setExit] = useState({ open, leaving: false });
  if (exit.open !== open) setExit({ open, leaving: !open && present === undefined });
  const leaving = exit.leaving && !open;
  useLayoutEffect(() => {
    if (!leaving) return;
    const running = content.current?.getAnimations?.() ?? [];
    const done = () => setExit(current => current.leaving ? { ...current, leaving: false } : current);
    if (!running.length) { done(); return; }
    let cancelled = false;
    void Promise.allSettled(running.map(animation => animation.finished)).then(() => { if (!cancelled) done(); });
    return () => { cancelled = true; };
  }, [leaving, content]);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const element = anchor.current, document = element.ownerDocument, window = document.defaultView!;
    // A body portal would be inert behind a native modal, including in a plug-in frame.
    const portalRoot = element.closest<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]') ?? document.body;
    setRoot(portalRoot);
    const place = () => {
      if (!element.isConnected) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, visibleTop = viewport?.offsetTop ?? 0;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const top = Math.max(visibleTop, document.documentElement.dataset.nativeTitlebar === 'true' ? 42 : 0);
      // DOMRects/visualViewport use viewport pixels. Fixed CSS lengths inside a
      // zoomed portal root are scaled again; normalize only that CSS zoom, not
      // native browser zoom (whose viewport coordinates already agree).
      let zoom = 1;
      for (let owner: HTMLElement | null = portalRoot; owner; owner = owner.parentElement) {
        const value = Number.parseFloat(window.getComputedStyle(owner).zoom);
        if (Number.isFinite(value) && value > 0) zoom *= value;
      }
      const physical = placePopover({ anchor: element.getBoundingClientRect(), width: width * zoom, height: height * zoom, preferredSide, align,
        viewport: { left, top, width: viewport?.width ?? window.innerWidth, height: Math.max(0, visibleTop + visibleHeight - top) } });
      const next = {...physical, left: physical.left / zoom, top: physical.top / zoom, width: physical.width / zoom, height: physical.height / zoom};
      setPlacement(previous => previous && Object.keys(next).every(key => previous[key as keyof PopoverPlacement] === next[key as keyof PopoverPlacement]) ? previous : next);
    };
    place();
    const onScroll = (event: Event) => { if (!content.current?.contains(event.target as Node)) place(); };
    const observer = new ResizeObserver(place);
    for (let owner: HTMLElement | null = element; owner; owner = owner.parentElement) observer.observe(owner);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    document.fonts?.addEventListener('loadingdone', place);
    // An ancestor entrance transform (dialog scale-in) temporarily hijacks fixed positioning; re-place when it ends.
    portalRoot.addEventListener('animationend', place);
    portalRoot.addEventListener('transitionend', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      document.fonts?.removeEventListener('loadingdone', place);
      portalRoot.removeEventListener('animationend', place);
      portalRoot.removeEventListener('transitionend', place);
    };
  }, [open, anchor, content, width, height, preferredSide, align, layoutRevision]);

  useLayoutEffect(() => {
    if (open && root) { initialFocus?.current?.focus(); ready.current?.(); }
  }, [open, root, initialFocus]);
  useEffect(() => {
    if (!open || !anchor.current) return;
    const document = anchor.current.ownerDocument;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !content.current?.contains(target)) dismiss.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    // A focused control that disables drops focus to <body>; pull it back inside.
    // Microtask scheduling lets this nested retention win over an owning modal's
    // frame-deferred retention, so focus is not yanked out of the popover.
    const release = retainFocus(document, () => content.current);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); release(); };
  }, [open, anchor, content]);

  if (!(present ?? (open || leaving)) || !root || !placement) return null;
  const { side, ...geometry } = placement;
  return createPortal(<div {...attributes} ref={content} className={`ui-popover ${className}`} data-side={side} data-escape-scope
    data-state={open ? 'open' : 'closed'} aria-hidden={!open} inert={!open}
    style={{ ...style, ...geometry, position: 'fixed' }} onKeyDown={event => {
      onKeyDown?.(event);
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); dismiss.current(); anchor.current?.focus();
      }
    }}>{children}</div>, root);
}
