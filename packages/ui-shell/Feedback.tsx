import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import './tokens.css';
import './feedback.css';

/** A retry button already says what to do, so the sentence should not repeat it. */
export const withoutRetryHint = (message: string) => message.replace(/([.!?])\s*(?:Retry|Try again|Please try again)\.?\s*$/i, '$1').trim() || message;

export function Spinner({ size = 14 }: { size?: number }) { return <LoaderCircle className="ui-spinner" size={size} aria-hidden="true" />; }

export function EmptyState({ title, children, icon, action, compact, className = '' }: { title?: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode; compact?: boolean; className?: string }) {
  return <div className={`ui-empty ${className}`.trim()} data-compact={compact || undefined}>
    {icon}{title ? <strong>{title}</strong> : null}{children !== undefined && children !== null && children !== false ? <p>{children}</p> : null}{action}
  </div>;
}

export function ErrorState({ message, onRetry, retryLabel = 'Retry', busy, live = 'alert', className = '', children, retryRef }: {
  message: string; onRetry?: () => void; retryLabel?: string; busy?: boolean; live?: 'alert' | 'status'; className?: string; children?: ReactNode; retryRef?: Ref<HTMLButtonElement>;
}) {
  return <div className={`ui-error ${className}`.trim()} role={live}>
    <AlertCircle size={14} aria-hidden="true" /><p>{onRetry ? withoutRetryHint(message) : message}</p>
    {onRetry && <BusyButton ref={retryRef} className="ui-error-retry" busy={busy} onClick={onRetry}>{retryLabel}</BusyButton>}{children}
  </div>;
}

/** Keeps its label and width while busy; the spinner replaces nothing the user needs to read. */
export function BusyButton({ busy, disabled, children, className = '', type = 'button', ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return <button {...rest} ref={ref} type={type} className={`ui-busy-button ${className}`.trim()} disabled={disabled || busy} aria-busy={busy || undefined} data-busy={busy || undefined}>
    {busy && <Spinner />}<span>{children}</span>
  </button>;
}
