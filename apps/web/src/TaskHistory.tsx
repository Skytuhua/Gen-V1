import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from './task-motion';
import { ArtifactInline } from './task-context';

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
  return <div ref={viewport} className="task-history" role="region" aria-label={label} tabIndex={inline ? undefined : 0} data-scrolled={!inline && scrolled} onWheel={inline ? undefined : manual} onTouchStart={inline ? undefined : manual} onPointerDown={event => { if (!inline && event.target === event.currentTarget) manual(); }} onKeyDown={event => { if (!inline && ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) manual(); }} onScroll={event => {
    const area = event.currentTarget; nearBottom.current = area.scrollHeight - area.clientHeight - area.scrollTop < 40; setScrolled(area.scrollTop > 8);
  }}><div ref={content}>{children}</div></div>;
}
