import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from './task-motion';
import { ArtifactInline } from './task-context';

const scrollKeys=new Set(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown']);
const keyboardControls='input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="listbox"], [role="combobox"], [role="menu"], [role="tablist"]';

export function isTaskHistoryScrollKey(event:{
  key:string;defaultPrevented:boolean;ctrlKey:boolean;metaKey:boolean;altKey:boolean;
  nativeEvent:{isComposing:boolean};target:unknown;
}):boolean {
  const target=event.target as Element|null;
  return !event.defaultPrevented&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.nativeEvent.isComposing
    &&scrollKeys.has(event.key)&&!target?.closest?.(keyboardControls);
}

export function TaskHistory({ children, label }: { children: ReactNode; label: string }) {
  const inline = useContext(ArtifactInline);
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), nearBottom = useRef(true);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    if (inline) return;
    const area = viewport.current!;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current) area.scrollTo({ top: area.scrollHeight, behavior: reducedMotion() ? 'instant' : 'smooth' });
    });
    observer.observe(content.current!); return () => observer.disconnect();
  }, [inline]);
  const manual = () => {
    nearBottom.current = false;
    const area = viewport.current!; area.scrollTo({ top: area.scrollTop, behavior: 'instant' });
  };
  return <div ref={viewport} className="task-history" role="region" aria-label={label} tabIndex={inline ? undefined : 0} data-scrolled={!inline && scrolled} onWheel={inline ? undefined : manual} onTouchStart={inline ? undefined : manual} onPointerDown={event => { if (!inline && event.target === event.currentTarget) manual(); }} onKeyDown={event => { if (!inline && isTaskHistoryScrollKey(event)) manual(); }} onScroll={event => {
    const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 40; setScrolled(area.scrollTop > 8);
  }}><div ref={content}>{children}</div></div>;
}
