import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { isComposing } from './list-navigation';
import './controls.css';

export interface ModalProps { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }

export function Modal({ open, title, onClose, children, className = '' }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef(onClose);
  const titleId = useId(); close.current = onClose;
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
  if (!open) return null;
  return <dialog ref={dialog} aria-labelledby={titleId} className={`ui-modal ${className}`} data-escape-scope
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape' && isComposing(event)) event.preventDefault(); }}>
    <header className="ui-modal-header"><h2 id={titleId}>{title}</h2><button type="button" className="ui-modal-close" aria-label="Close dialog" onClick={onClose}><X size={17} /></button></header>
    {children}
  </dialog>;
}
