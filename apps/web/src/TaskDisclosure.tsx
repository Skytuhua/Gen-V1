import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { disclosureData } from '../../../packages/ui-catalog/workflow';
import { inputPath, mapActionPayload, statePath, useTaskAction } from './task-context';
import { animateTask, IncomingAnswer, MotionRegion, reducedMotion, TASK_MOTION, type TaskEffectCause } from './task-motion';
import {useSecureArtifact} from './secure-artifact-context';

function FollowupBranch({ pending, children }: { pending: boolean; children: ReactNode }) {
  const branch = useRef<HTMLDivElement>(null), placeholder = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'resolving'>(pending ? 'pending' : 'idle');
  const reserved = useRef({ top: 0, width: 0, height: 0, existing: 0 });
  const wasPending = useRef(false), seen = useRef<Set<Element> | undefined>(undefined);
  // Snapshot direct-child DOM identities while open. A newly inserted real child
  // after an independent publication reveals once; repeats and pending-to-real
  // replacements keep immediate content.
  useLayoutEffect(() => {
    const shell = branch.current; if (!shell) return;
    const kids = Array.from(shell.children).filter(child => child !== placeholder.current);
    const first = seen.current === undefined; if (first) seen.current = new Set();
    const settled = shell.closest('.task-motion-region')?.getAttribute('data-motion-phase') === 'open';
    for (const kid of kids) {
      if (seen.current!.has(kid)) continue; seen.current!.add(kid);
      if (!first && settled && phase === 'idle' && !pending) animateTask(kid as HTMLElement, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], 180, { duration: '--ui-motion-insert', easing: '--ui-ease-enter' });
    }
    for (const kid of Array.from(seen.current!)) if (!kids.includes(kid)) seen.current!.delete(kid);
  });
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
    animation = animateTask(row, [{ opacity: Number.parseFloat(getComputedStyle(row).opacity) || 1 }, { opacity: 0 }], 180, { duration: '--ui-motion-insert', easing: '--ui-ease-enter' });
    if (animation) void animation.finished.then(() => { if (alive) setPhase('idle'); }).catch(() => {}); else setPhase('idle');
    return () => { alive = false; animation?.cancel(); };
  }, [pending]);
  return <div ref={branch} className="disclosure-children" data-followup-arrival={pending ? 'pending' : phase}>{children}{(pending || phase !== 'idle') && <div ref={placeholder} className="disclosure-followups-pending" data-phase={pending ? 'pending' : phase} role={pending ? 'status' : undefined} aria-label={pending ? 'Preparing related questions' : undefined} aria-hidden={!pending || undefined} inert={!pending}><span className="disclosure-loading-mark" aria-hidden="true" /><span className="disclosure-skeleton-line" aria-hidden="true" /></div>}</div>;
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
  const requested = useRef(false), chevron = useRef<HTMLSpanElement>(null);
  const [motionCause, setMotionCause] = useState<TaskEffectCause>('restore');
  const id = useId();
  const error = action.error || (data?.status === 'error' ? data.error || 'The answer could not be prepared. Try again.' : '') || (source && !source.success ? 'The connected answer is unavailable.' : '');
  const ready = data?.status === 'ready' || (!bound && Boolean(text));
  const pending = !ready && (action.busy || data?.status === 'pending' || (requested.current && !error));
  const request = () => {
    if (!active || !props.onOpenActionId || pending || ready) return;
    requested.current = true;
    void action.run(String(props.onOpenActionId), mapActionPayload(props, store.getSnapshot().values));
  };
  const toggle = (event: { detail: number }) => {
    setMotionCause(event.detail > 0 ? 'pointer' : 'keyboard');
    if (props.stateKey) store.set(field, !open); else setLocal(!open);
    if (!open && !requested.current && !error) request();
  };
  useEffect(() => { if (open && !requested.current && !error) request(); }, [open, ready, pending, props.onOpenActionId, active]);
  useLayoutEffect(() => {
    const el = chevron.current;
    if (!el || motionCause !== 'pointer') return;
    animateTask(el, [{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)' }, { transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }], 140, { duration: '--ui-motion-tab', easing: '--ui-ease-move' });
  }, [open]);
  return <div className="disclosure-node" data-answer-state={error ? 'error' : pending ? 'pending' : ready ? 'ready' : 'idle'}>
    <div className="disclosure">
      <button type="button" className="disclosure-trigger" aria-expanded={open} aria-controls={`${id}-answer ${id}-branches`} onClick={toggle}><span className="disclosure-question-mark" aria-hidden="true"><svg viewBox="0 0 12 12" width="12" height="12">{Array.from({ length: 9 }, (_, index) => <rect key={index} x={index % 3 * 4} y={Math.floor(index / 3) * 4} width="3" height="3" rx=".45" opacity={.35 + index % 3 * .3} />)}</svg></span><span className="disclosure-question-title">{String(props.title ?? props.label ?? '')}</span><span ref={chevron} className={`disclosure-chevron${open ? ' rotated' : ''}`}><ChevronDown size={14} /></span></button>
      <MotionRegion open={open} animate={motionCause === 'pointer'} id={`${id}-answer`}>
        <div className="disclosure-body">
          <IncomingAnswer text={text} pending={pending} />
          {pending && <span className={`disclosure-pending${text ? ' has-answer' : ''}`} role="status">{!text && <span className="disclosure-loading-mark" aria-hidden="true" />}<span className="sr-only">{text ? 'Updating answer…' : 'Preparing an answer…'}</span></span>}
          {error && <div className="disclosure-error" role="status"><span>{error}</span>{Boolean(props.onOpenActionId) && <button type="button" className="quiet" disabled={pending} onClick={request}><RotateCcw size={12} />Try again</button>}</div>}
        </div>
      </MotionRegion>
    </div>
    <MotionRegion open={open} animate={motionCause === 'pointer'} id={`${id}-branches`} duration={TASK_MOTION.branch} className="disclosure-branch-region"><FollowupBranch pending={data?.followupsPending === true}>{children}</FollowupBranch></MotionRegion>
  </div>;
}
