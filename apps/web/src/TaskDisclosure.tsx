import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { disclosureData } from '../../../packages/ui-catalog/workflow';
import { inputPath, mapActionPayload, statePath, useTaskAction } from './task-context';
import { animateTask, IncomingAnswer, MotionRegion, reducedMotion, TASK_MOTION } from './task-motion';
import {useSecureArtifact} from './secure-artifact-context';

function FollowupBranch({ pending, children }: { pending: boolean; children: ReactNode }) {
  const branch = useRef<HTMLDivElement>(null), placeholder = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'resolving'>(pending ? 'pending' : 'idle');
  const reserved = useRef({ top: 0, width: 0, height: 0, existing: 0 });
  const wasPending = useRef(false);
  useLayoutEffect(() => {
    const shell = branch.current!, row = placeholder.current;
    let animation: Animation | undefined, alive = true;
    if (pending && row) {
      for (const property of ['position', 'top', 'left', 'width', 'height', 'min-height', 'pointer-events']) row.style.removeProperty(property);
      wasPending.current = true; setPhase('pending');
      const measure = () => { reserved.current = { top: row.offsetTop, width: row.getBoundingClientRect().width, height: row.getBoundingClientRect().height, existing: Array.from(shell.children).filter(child => child !== row).length }; };
      measure(); const observer = new ResizeObserver(measure); observer.observe(row);
      return () => { alive = false; observer.disconnect(); };
    }
    if (!wasPending.current || !row) return;
    wasPending.current = false;
    if (reducedMotion()) { setPhase('idle'); return; }
    setPhase('resolving');
    const before = reserved.current;
    const target = Array.from(shell.children).filter(child => child !== row)[before.existing] as HTMLElement | undefined;
    const after = target ? { top: target.offsetTop, width: target.getBoundingClientRect().width, height: target.getBoundingClientRect().height } : { top: before.top, width: before.width, height: 0 };
    // The real question already owns its DOM and state. Retain only the old
    // visual shell above it for this bounded handoff; never clone its controls.
    Object.assign(row.style, { position: 'absolute', top: `${after.top}px`, left: '0', width: `${after.width}px`, height: `${after.height}px`, minHeight: '0', pointerEvents: 'none' });
    animation = animateTask(row, [{ top: `${before.top}px`, width: `${before.width}px`, height: `${before.height}px`, opacity: 1 }, { top: `${after.top}px`, width: `${after.width}px`, height: `${after.height}px`, opacity: 0 }], TASK_MOTION.branch);
    if (animation) void animation.finished.then(() => { if (alive) setPhase('idle'); }).catch(() => {}); else setPhase('idle');
    return () => { alive = false; animation?.cancel(); };
  }, [pending]);
  return <div ref={branch} className="disclosure-children" data-followup-arrival={pending ? 'pending' : phase}>{children}{(pending || phase !== 'idle') && <div ref={placeholder} className="disclosure-followups-pending" data-phase={pending ? 'pending' : phase} role={pending ? 'status' : undefined} aria-label={pending ? 'Preparing related questions' : undefined} aria-hidden={!pending || undefined}><span className="disclosure-loading-mark" aria-hidden="true" /><span className="disclosure-skeleton-line" aria-hidden="true" /></div>}</div>;
}

export function Disclosure({ element: { props }, children, bindings }: ComponentRenderProps) {
  const store = useStateStore(), action = useTaskAction(), active = useSecureArtifact()?.active !== false;
  const [local, setLocal] = useState(props.defaultOpen === true);
  const field = bindings?.value ?? statePath(props.stateKey);
  const value = store.get(field);
  const open = props.stateKey ? (value ?? props.defaultOpen) === true : local;
  const bound = typeof props.dataBinding === 'string';
  const source = bound ? disclosureData.safeParse(store.get(inputPath(String(props.dataBinding)))) : undefined;
  const data = source?.success ? source.data : undefined;
  const text = data?.answer ?? (typeof props.text === 'string' ? props.text : typeof props.content === 'string' ? props.content : '');
  const requested = useRef(false);
  const id = useId();
  const error = action.error || (data?.status === 'error' ? data.error || 'The answer could not be prepared. Try again.' : '') || (source && !source.success ? 'The connected answer is unavailable.' : '');
  const ready = data?.status === 'ready' || (!bound && Boolean(text));
  const pending = action.busy || data?.status === 'pending' || (requested.current && !ready && !error);
  const request = () => {
    if (!active || !props.onOpenActionId || pending || ready) return;
    requested.current = true;
    void action.run(String(props.onOpenActionId), mapActionPayload(props, store.getSnapshot().values));
  };
  const toggle = () => {
    if (props.stateKey) store.set(field, !open); else setLocal(!open);
    if (!open && !requested.current && !error) request();
  };
  useEffect(() => { if (open && !requested.current && !error) request(); }, [open, ready, pending, props.onOpenActionId, active]);
  return <div className="disclosure-node" data-answer-state={error ? 'error' : pending ? 'pending' : ready ? 'ready' : 'idle'}>
    <div className="disclosure">
      <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={`${id}-answer ${id}-branches`} onClick={toggle}><span className="disclosure-question-mark" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12">{Array.from({ length: 9 }, (_, index) => <rect key={index} x={index % 3 * 4} y={Math.floor(index / 3) * 4} width="3" height="3" rx=".45" opacity={.35 + index % 3 * .3} />)}</svg></span><span className="disclosure-question-title">{String(props.title ?? props.label ?? '')}</span><ChevronDown size={14} className={open ? 'rotated' : ''} /></button>
      <MotionRegion open={open} id={`${id}-answer`}>
        <div className="disclosure-body">
          <IncomingAnswer text={text} pending={pending} />
          {pending && <span className={`disclosure-pending${text ? ' has-answer' : ''}`} role="status">{!text && <span className="disclosure-loading-mark" aria-hidden="true" />}<span className="sr-only">{text ? 'Updating answer…' : 'Preparing an answer…'}</span></span>}
          {error && <div className="disclosure-error" role="alert"><span>{error}</span>{Boolean(props.onOpenActionId) && <button type="button" className="quiet" disabled={pending} onClick={request}><RotateCcw size={12} />Try again</button>}</div>}
        </div>
      </MotionRegion>
    </div>
    <MotionRegion open={open} id={`${id}-branches`} duration={TASK_MOTION.branch} className="disclosure-branch-region"><FollowupBranch pending={data?.followupsPending === true}>{children}</FollowupBranch></MotionRegion>
  </div>;
}
