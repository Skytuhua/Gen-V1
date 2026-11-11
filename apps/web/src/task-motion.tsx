import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Markdown } from './Markdown';
import './task-motion.css';
import {createSpringValue} from './motion-spring';
import {SentenceReveal} from './SentenceReveal';
import {readMotionPolicy,observeMotionPolicy} from './motion-policy';

export const TASK_MOTION = Object.freeze({ step: 180, status: 220, height: 280, branch: 220, chunk: 120, sibling: 60, popover: 140, path: 450, check: 90 });
export const reducedMotion = () => readMotionPolicy() !== 'full';
export function animateTask(element: Element | null, frames: Keyframe[], duration: number, tokens?: { duration: string; easing: string }) {
  if (!element) return;
  const policy = readMotionPolicy();
  if (policy === 'off') return;
  const style = tokens ? getComputedStyle(element) : undefined;
  const tokenDuration = tokens && style?.getPropertyValue(tokens.duration).trim();
  if (tokenDuration) duration = Number.parseFloat(tokenDuration) * (tokenDuration.endsWith('ms') ? 1 : 1000);
  const easing = tokens && style?.getPropertyValue(tokens.easing).trim() || 'cubic-bezier(.22,1,.36,1)';
  duration /= Number(document.documentElement.style.getPropertyValue('--motion-speed')) || 1;
  const travelling = frames.some(frame => Object.keys(frame).some(key => !['opacity','offset','easing','composite'].includes(key)));
  if (policy === 'reduced') {
    if (!frames.some(frame => frame.opacity !== undefined)) return;
    frames = frames.map(frame => ({ ...(frame.opacity !== undefined ? { opacity: frame.opacity } : {}), ...(frame.offset !== undefined ? { offset: frame.offset } : {}) }));
    duration = Math.min(duration, 80);
  }
  const animation = element.animate(frames, { duration, easing: policy === 'reduced' ? 'ease-out' : easing });
  const stopObservingMotion = observeMotionPolicy(next => {
    if (next === 'off' || next === 'reduced' && policy === 'full' && travelling) {
      cleanup();
      // Finish the existing handoff so callers can remove their temporary shells.
      // Default fill:none releases the effect while preserving promise/event completion.
      // A caller's cancel event may still be queued when the policy changes.
      if (animation.playState === 'running' || animation.playState === 'paused') animation.finish();
    }
  });
  const cleanup = () => {
    stopObservingMotion();animation.removeEventListener('finish',cleanup);animation.removeEventListener('cancel',cleanup);
  };
  animation.addEventListener('finish',cleanup);animation.addEventListener('cancel',cleanup);
  return animation;
}

/** The host decides whether publication is new. Restoration and ordinary
 * snapshots never infer an entrance from component mounting alone. */
export function useArtifactEntrance(ref: RefObject<HTMLElement | null>, animateEntry: boolean) {
  const played = useRef(false), cleanup = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!animateEntry || played.current || !element) return;
    played.current = true;
    const previousHeight = element.style.height, previousOverflow = element.style.overflow;
    const fullMotion = !reducedMotion() && element.dataset.artifactInline !== 'false';
    element.dataset.entryPhase = 'entering';
    let finished = false, observer:ResizeObserver|undefined, deadline:ReturnType<typeof setTimeout>|undefined;
    let height:ReturnType<typeof createSpringValue>|undefined;
    const animation = animateTask(element, [{ opacity: .35, transform:'translateY(7px) scale(.992)', filter:'blur(1px)' }, { opacity: 1, transform:'translateY(0) scale(1)', filter:'blur(0)' }], 340);
    const restore = () => {
      if (finished) return; finished = true;
      if(deadline!==undefined)clearTimeout(deadline);observer?.disconnect();height?.dispose();stopObservingMotion();
      element.style.height = previousHeight; element.style.overflow = previousOverflow;
      element.dataset.entryPhase = 'settled';
      element.removeEventListener('pointerdown', stop); element.removeEventListener('focusin', stop);
    };
    const stop = () => { animation?.cancel(); restore(); };
    const stopObservingMotion = observeMotionPolicy(policy => { if (policy === 'off' || policy === 'reduced' && fullMotion) stop(); });
    element.addEventListener('pointerdown', stop); element.addEventListener('focusin', stop);
    if(fullMotion){
      element.style.height='0px';element.style.overflow='clip';
      height=createSpringValue(0,value=>{element.style.height=`${value}px`;},restore);
      const measure=()=>{
        if(finished)return;
        // Journal recovery and lazy task children can arrive after the shell.
        // Measure their natural extent only on a resize, never on each frame.
        const current=element.style.height;element.style.height='auto';
        const target=element.getBoundingClientRect().height;element.style.height=current;
        height!.to(target);
      };
      observer=new ResizeObserver(measure);for(const child of element.children)observer.observe(child);
      deadline=setTimeout(stop,900);
      measure();
    }
    if (animation) void animation.finished.then(()=>{if(!fullMotion)restore();}).catch(restore); else if(!fullMotion)restore();
    cleanup.current = stop;
  }, [animateEntry, ref]);
  useLayoutEffect(() => () => cleanup.current?.(), []);
}

// Measure the content, not the whole artifact: arriving lines can grow one branch
// without replacing any mounted input, selection, focus target or sibling branch.
export function MotionRegion({ open, children, id, duration = TASK_MOTION.height, className = '', animate = true }: { open: boolean; children: ReactNode; id?: string; duration?: number; className?: string; animate?: boolean }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const spring = useRef<ReturnType<typeof createSpringValue> | undefined>(undefined), latestOpen = useRef(open); latestOpen.current=open;
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const shell = outer.current!, content = inner.current!;
    if(!spring.current)spring.current=createSpringValue(shell.getBoundingClientRect().height,value=>{shell.style.height=`${value}px`;},()=>{content.style.visibility=latestOpen.current?'visible':'hidden';shell.dataset.motionPhase=latestOpen.current?'open':'closed';});
    const measure = () => {
      const after = open ? content.getBoundingClientRect().height : 0;
      if(after!==spring.current!.value||spring.current!.active){content.style.visibility='visible';shell.dataset.motionPhase=open?'opening':'closing';}
      spring.current!.to(after,!initialized.current||!animate||reducedMotion());initialized.current=true;
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(content);
    const stopObservingMotion = observeMotionPolicy(policy => { if (policy !== 'full') measure(); });
    // Leave the current animation alive until the next measure has read its
    // actual geometry. Cancelling here would snap interrupted closes to zero.
    return () => { observer.disconnect(); stopObservingMotion(); };
  }, [open, duration, animate]);
  useLayoutEffect(() => () => spring.current?.dispose(), []);
  return <div ref={outer} id={id} className={`task-motion-region ${className}`} data-open={open} aria-hidden={!open} inert={!open}><div ref={inner} className="task-motion-inner">{children}</div></div>;
}

export function IncomingAnswer({ text, pending=false }: { text: string; pending?:boolean }) {
  const content=useRef<HTMLDivElement>(null),active=pending&&Boolean(text);
  useLayoutEffect(()=>{
    const element=content.current!;
    if(!active){delete element.dataset.answerVisible;return;}
    let visible=false;
    const paint=()=>{element.dataset.answerVisible=String(visible&&document.visibilityState!=='hidden'&&!element.closest('[inert],[aria-hidden="true"]'));};
    const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting===true&&entries[0].intersectionRatio>0;paint();});
    const visibility=new MutationObserver(paint);
    for(let parent=element.parentElement;parent;parent=parent.parentElement)visibility.observe(parent,{attributes:true,attributeFilter:['inert','aria-hidden','data-open']});
    observer.observe(element);document.addEventListener('visibilitychange',paint);
    return()=>{observer.disconnect();visibility.disconnect();document.removeEventListener('visibilitychange',paint);delete element.dataset.answerVisible;};
  },[active]);
  return <div ref={content} className="task-incoming-answer" data-answer-pending={active}><SentenceReveal text={text} animate revealClassName="task-answer-reveal"><Markdown text={text} /></SentenceReveal>{active&&<span className="task-answer-tail-fallback" aria-hidden="true"/>}</div>;
}
