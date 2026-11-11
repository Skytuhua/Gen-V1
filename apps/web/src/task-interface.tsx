import { Children, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useStateStore, type ComponentRenderProps } from '@json-render/react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { operationStatusData, statusData, WORKFLOW_SCHEMAS } from '../../../packages/ui-catalog/workflow';
import './task-interface.css';

export { ArtifactTitle } from './task-context';
export { RelationshipGraph } from './RelationshipGraph';
import { inputPath, statePath } from './task-context';
import { StatusIcon, type StatusKind } from './task-status';
import { animateTask, reducedMotion, TASK_MOTION } from './task-motion';
import './task-motion.css';
import './document-preview.css';
import {createSpringValue} from './motion-spring';

export function ChoiceList({ element: { props } }: ComponentRenderProps) {
  const { stateKey, label, options, custom, required, disabled } = WORKFLOW_SCHEMAS.ChoiceList.parse(props);
  const store = useStateStore();
  const group = useId();
  const value = store.get(statePath(stateKey));
  const [choosingCustom, setChoosingCustom] = useState(false);
  const customInput = useRef<HTMLInputElement>(null);
  const customSelected = Boolean(custom && (choosingCustom || typeof value === 'string' && !options.some(option => option.value === value)));
  return <fieldset className="task-choices" disabled={disabled}>
    <legend>{label}</legend>
    {options.map(option => <label key={option.value} className={`task-choice ${value === option.value ? 'is-selected' : ''}`}>
      <input type="radio" name={group} value={option.value} checked={!customSelected && value === option.value} required={required} disabled={option.disabled} onChange={() => { setChoosingCustom(false); store.set(statePath(stateKey), option.value); }} />
      <span className="task-choice-copy"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
      {option.detail && <span className="task-choice-detail">{option.detail}</span>}
    </label>)}
    {custom && <div className="task-choice-custom">{customSelected ? <><input className="task-choice-custom-radio" type="radio" name={group} checked required={required} tabIndex={-1} aria-label={custom.label} onChange={() => {}} /><input ref={customInput} className="task-choice-custom-input" aria-label={custom.label} placeholder={custom.placeholder} value={typeof value === 'string' ? value : ''} maxLength={500} required={required} onChange={event => store.set(statePath(stateKey), event.target.value)} /></> : <label className="task-choice"><input type="radio" name={group} checked={false} required={required} onChange={() => { setChoosingCustom(true); store.set(statePath(stateKey), ''); requestAnimationFrame(() => customInput.current?.focus()); }} /><span className="task-choice-copy">{custom.label}</span></label>}</div>}
  </fieldset>;
}

export function Steps({ element: { props }, children }: ComponentRenderProps) {
  const { stateKey, steps, defaultStep } = WORKFLOW_SCHEMAS.Steps.parse(props);
  const store = useStateStore();
  const value = store.get(statePath(stateKey));
  const current = Math.max(0, steps.findIndex(step => step.key === (value ?? defaultStep)));
  const initialStep = defaultStep ?? steps[0].key;
  useEffect(() => {
    let mounted = true;
    // Parent draft subscriptions attach in this commit; initialize afterwards so
    // the visible default is journaled just like a subsequent local step change.
    queueMicrotask(() => { if (mounted && store.get(statePath(stateKey)) === undefined) store.set(statePath(stateKey), initialStep); });
    return () => { mounted = false; };
  }, [store, stateKey, initialStep]);
  const panels = Children.toArray(children);
  const content = useRef<HTMLDivElement>(null), previous = useRef(current);
  const [leaving, setLeaving] = useState<number | null>(null);
  const height = useRef<ReturnType<typeof createSpringValue> | undefined>(undefined), initialized = useRef(false), opacity = useRef(new Map<number,number>());
  useLayoutEffect(() => {
    const from = previous.current; previous.current = current;
    const shell=content.current!,outgoing=shell.children[from] as HTMLElement,incoming=shell.children[current] as HTMLElement;
    if (!outgoing || !incoming) { setLeaving(null); return; }
    if(!height.current)height.current=createSpringValue(shell.getBoundingClientRect().height,value=>{shell.style.height=`${value}px`;},()=>{shell.dataset.heightPhase='settled';});
    const measure=()=>{shell.dataset.heightPhase='moving';height.current!.to(incoming.getBoundingClientRect().height,!initialized.current||reducedMotion());initialized.current=true;};
    measure();const observer=new ResizeObserver(measure);observer.observe(incoming);
    const preference=matchMedia('(prefers-reduced-motion: reduce)');preference.addEventListener('change',measure);
    let active=true;const animations:Animation[]=[];
    if(from!==current){
      const incomingOpacity=opacity.current.get(current)??0,outgoingOpacity=opacity.current.get(from)??1;opacity.current.clear();
      incoming.style.opacity='1';outgoing.style.opacity='0';
      if(reducedMotion())setLeaving(null);
      else{
        setLeaving(from);const direction=current>from?1:-1;
        const enter=animateTask(incoming,[{opacity:incomingOpacity,transform:`translateX(${direction*6}px)`},{opacity:1,transform:'translateX(0)'}],240);
        const exit=animateTask(outgoing,[{opacity:outgoingOpacity,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-direction*3}px)`}],120);
        if(enter)animations.push(enter);if(exit)animations.push(exit);
        void Promise.all(animations.map(animation=>animation.finished)).then(()=>{if(active)setLeaving(null);}).catch(()=>{});
      }
    }
    return()=>{active=false;opacity.current.set(current,Number(getComputedStyle(incoming).opacity));opacity.current.set(from,Number(getComputedStyle(outgoing).opacity));animations.forEach(animation=>animation.cancel());observer.disconnect();preference.removeEventListener('change',measure);};
  }, [current]);
  useLayoutEffect(()=>()=>height.current?.dispose(),[]);
  const id = useId();
  const go = (index: number) => store.set(statePath(stateKey), steps[index].key);
  return <section className="task-steps" aria-label="Current task step">
    <div className="task-step-label" id={`${id}-label`}>{steps[current].label}<span>{current + 1} of {steps.length}</span></div>
    {steps[current].description && <p className="task-step-description">{steps[current].description}</p>}
    <div className="task-step-content" ref={content}>{panels.map((panel, i) => <div key={steps[i]?.key ?? i} hidden={i !== current && i !== leaving} inert={i !== current} aria-hidden={i !== current || undefined} data-phase={i === current ? 'current' : i === leaving ? 'leaving' : 'inactive'} style={{ position:'absolute',left:0,top:0,width:'100%',minWidth:0 }} role="group" aria-label={steps[i]?.label}>{panel}</div>)}</div>
    <nav className="task-step-navigation" aria-label="Task steps">
      <button type="button" className="quiet task-step-back" aria-label="Previous step" disabled={current === 0} onClick={() => go(current - 1)}><ArrowLeft size={13} />Back</button>
      <div className="task-step-markers">{steps.map((step, index) => <button key={step.key} type="button" aria-label={`Go to ${step.label}`} aria-current={current === index ? 'step' : undefined} onClick={() => go(index)}><span /></button>)}</div>
      {current < steps.length - 1 && <button type="button" className="quiet task-step-next" aria-label="Next step" onClick={() => go(current + 1)}>Next<ArrowRight size={13} /></button>}
    </nav>
  </section>;
}

export function Status({ element: { props } }: ComponentRenderProps) {
  const store = useStateStore();
  const raw = typeof props.dataBinding === 'string' ? store.get(inputPath(props.dataBinding)) : { status: props.status, label: props.label, detail: props.detail };
  const parsed = statusData.safeParse(raw);
  const operation = operationStatusData.safeParse(raw);
  if (!parsed.success && !operation.success) return <p className="task-unavailable">Status is unavailable from the connected source.</p>;
  const states: Record<string, StatusKind> = { prepared: 'pending', running: 'running', succeeded: 'success', failed: 'error', cancelled: 'error', unknown: 'pending' };
  const labels: Record<string, string> = { prepared: 'Prepared · not run', running: 'Running', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled', unknown: 'Outcome unknown' };
  const op = operation.success ? operation.data : undefined;
  const receipt = op?.result && typeof op.result === 'object' ? op.result as Record<string, unknown> : undefined;
  const exit = typeof receipt?.exitCode === 'number' && Number.isFinite(receipt.exitCode) ? `Exit code ${receipt.exitCode}` : undefined;
  const sourceDetail = op ? op.error || op.progress?.message || op.message || exit || (op.status === 'prepared' && op.approved === false ? 'Awaiting approval' : op.status === 'succeeded' ? undefined : labels[op.status]) : parsed.success ? parsed.data.detail : undefined;
  const label = typeof props.label === 'string' ? props.label : op?.description || op?.kind || (parsed.success ? parsed.data.label : 'Operation');
  const status = op ? states[op.status] : parsed.success ? parsed.data.status : 'neutral';
  const detail = sourceDetail && sourceDetail.length > 180 ? `${sourceDetail.slice(0, 180)}…` : sourceDetail;
  return <StatusPresentation view={{ label, status, detail }} receipt={props.presentation === 'receipt'} operation={Boolean(op)} raw={raw} />;
}

type StatusView = { label: string; status: StatusKind; detail?: string };
function StatusPresentation({ view, receipt, operation, raw }: { view: StatusView; receipt: boolean; operation: boolean; raw: unknown }) {
  const current = useRef<HTMLDivElement>(null), previousElement = useRef<HTMLDivElement>(null);
  const previous = useRef(view), [leaving, setLeaving] = useState<StatusView | null>(null);
  const signature = JSON.stringify([view.status,operation&&raw&&typeof raw==='object'?(raw as {operationId?:unknown}).operationId:null]);
  const currentOpacity=useRef(1);
  useLayoutEffect(() => {
    const from = previous.current; previous.current = view;
    if (from.status === view.status) return;
    let alive = true, frame = 0;
    const incoming = animateTask(current.current, [{ opacity: Math.min(.65,currentOpacity.current) }, { opacity: 1 }], TASK_MOTION.status);
    if (reducedMotion()) { setLeaving(null); return () => { incoming?.cancel(); }; }
    setLeaving(from);
    let outgoing: Animation | undefined;
    frame = requestAnimationFrame(() => {
      outgoing = animateTask(previousElement.current, [{ opacity: 1 }, { opacity: 0 }], TASK_MOTION.status);
      void Promise.all([incoming?.finished, outgoing?.finished]).then(() => { if (alive) setLeaving(null); }).catch(() => {});
    });
    return () => { alive = false;if(current.current)currentOpacity.current=Number(getComputedStyle(current.current).opacity);cancelAnimationFrame(frame);incoming?.cancel();outgoing?.cancel(); };
  }, [signature]);
  useLayoutEffect(()=>{previous.current=view;});
  const content = (value: StatusView) => <><StatusIcon status={value.status} /><div><span>{value.label}</span>{value.detail && <small>{value.detail}</small>}</div></>;
  return <div className={`task-status-block${receipt ? ' task-status-receipt-view' : ''}`}><div className="task-status-stack">{leaving && <div ref={previousElement} className={`task-status task-status-outgoing status-${leaving.status}`} aria-hidden="true" inert>{content(leaving)}</div>}<div ref={current} className={`task-status status-${view.status}`} role="status">{content(view)}</div></div>{operation && <details className="task-status-receipt"><summary>Operation details</summary><pre>{JSON.stringify(raw, null, 2)}</pre></details>}</div>;
}
