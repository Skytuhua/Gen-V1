import {useEffect, useState, type ReactNode} from 'react';
import './loading-state.css';

function useDelayedPending(pending: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!pending) { setVisible(false); return; }
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, [pending]);
  return pending && visible;
}

export function Skeleton() {
  return <div className="loading-state-rows" aria-hidden="true">{[0, 1, 2].map(row => <div className="loading-state-row" key={row}><span className="loading-skeleton loading-skeleton-icon"/><span className="loading-skeleton loading-skeleton-line"/></div>)}</div>;
}

/** The caller keeps its last-known data; refresh never replaces mounted children. */
export function LoadingState({pending, hasContent, label, children, skeleton = <Skeleton/>, className = ''}: {pending: boolean; hasContent: boolean; label: string; children?: ReactNode; skeleton?: ReactNode; className?: string}) {
  const visible = useDelayedPending(pending);
  return <div className={`tool-loading-state ${className}`}>
    <div aria-busy={pending}>{pending && !hasContent ? <div className="loading-state-skeleton" data-visible={visible}>{skeleton}</div> : children}</div>
    {visible && <p className="loading-state-status" role="status">{label}</p>}
  </div>;
}

export function PendingStatus({pending, label}: {pending: boolean; label: string}) {
  const visible = useDelayedPending(pending);
  return visible ? <p className="loading-state-status" role="status">{label}</p> : null;
}
