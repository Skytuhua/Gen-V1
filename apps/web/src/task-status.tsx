import { AlertCircle, Check, Circle, GitMerge, LoaderCircle, TriangleAlert } from 'lucide-react';
export type StatusKind = 'neutral' | 'pending' | 'running' | 'success' | 'error' | 'merged';
export function StatusIcon({ status }: { status: StatusKind }) {
  const Icon = status === 'success' ? Check : status === 'merged' ? GitMerge : status === 'error' ? AlertCircle : status === 'pending' ? TriangleAlert : status === 'running' ? LoaderCircle : Circle;
  return <Icon size={13} aria-hidden="true" className={status === 'running' ? 'spinning' : undefined} />;
}
