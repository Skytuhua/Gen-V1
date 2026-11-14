import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { isComposing } from './list-navigation';
import './controls.css';

export interface ModalProps { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }

export function Modal({ open, title, onClose, children, className = '' }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef(onClose), pressedBackdrop = useRef(false);
  const titleId = useId(); close.current = onClose;
  // The closed dialog stays mounted, showing its last open content, until the CSS exit finishes.
  const shown = useRef({ title, children });
  if (open) shown.current = { title, children };
  const [exit, setExit] = useState({ open, leaving: false });
  if (exit.open !== open) setExit({ open, leaving: !open });
  const leaving = exit.leaving && !open;
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const previous = element.ownerDocument.activeElement as HTMLElement | null;
    element.showModal();
    const closed = () => close.current();
    element.addEventListener('close', closed);
    return () => {
      element.removeEventListener('close', closed); element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!leaving) return;
    const running = dialog.current?.getAnimations?.() ?? [];
    const done = () => setExit(current => current.leaving ? { ...current, leaving: false } : current);
    if (!running.length) { done(); return; }
    let cancelled = false;
    void Promise.allSettled(running.map(animation => animation.finished)).then(() => { if (!cancelled) done(); });
    return () => { cancelled = true; };
  }, [leaving]);
  if (!open && !leaving) return null;
  const onBackdrop = (event: { target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number }) => {
    if (event.target !== event.currentTarget) return false;
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  };
  return <dialog ref={dialog} aria-labelledby={titleId} className={`ui-modal ${className}`} data-escape-scope inert={!open}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onPointerDown={event => { pressedBackdrop.current = onBackdrop(event); }}
    onClick={event => { if (pressedBackdrop.current && onBackdrop(event)) onClose(); pressedBackdrop.current = false; }}
    onKeyDown={event => { if (event.key === 'Escape' && isComposing(event)) event.preventDefault(); }}>
    <header className="ui-modal-header"><h2 id={titleId}>{shown.current.title}</h2><button type="button" className="ui-modal-close" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>
    {shown.current.children}
  </dialog>;
}
