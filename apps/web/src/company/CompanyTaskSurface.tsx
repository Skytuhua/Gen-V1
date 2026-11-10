import {useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {ExternalLink, PanelRight, PanelsTopLeft, X} from 'lucide-react';
import type {DesktopWindowInfo} from '../../../../packages/desktop-contract';
import {FloatingWindow} from '../FloatingWindow';
import {journalRead, journalWrite} from '../journal';
import './task-surface.css';

type Placement = 'docked' | 'floating';
interface TaskSurfaceState {open: boolean; placement: Placement}
const initial: TaskSurfaceState = {open: false, placement: 'docked'};

/** Presentation preferences only; project records and permission remain elsewhere. */
export function useCompanyTaskSurface(projectId: string) {
  const key = `company:leo-company:task-surface:${encodeURIComponent(projectId)}:v1`;
  const [saved, setSaved] = useState<{key: string; state?: TaskSurfaceState}>();
  const [error, setError] = useState('');
  const activeKey = useRef(key); activeKey.current = key;
  useEffect(() => {
    let alive = true; setError('');
    const inherited = saved?.state ?? initial;
    void journalRead<Partial<TaskSurfaceState>>(key).then(value => {
      if (alive) setSaved({key, state: value && typeof value.open === 'boolean' && (value.placement === 'docked' || value.placement === 'floating') ? {open: value.open, placement: value.placement} : inherited});
    }).catch(() => {if (alive) {setSaved({key}); setError('Task panel recovery is unavailable. Reload to retry; your saved work has not been replaced.');}});
    return () => {alive = false;};
  }, [key]);
  const recovered = saved?.key === key, ready = recovered && saved.state !== undefined;
  const state = recovered && saved.state ? saved.state : initial;
  const update = (patch: Partial<TaskSurfaceState>) => {
    if (!ready) return;
    const next = {...state, ...patch}; setSaved({key, state: next});
    void journalWrite(key, next).catch(() => {if (activeKey.current === key) setError('Task panel layout could not be saved. Keep this window open and retry.');});
  };
  return {state, ready, recovered, error, update};
}

/** One mounted task body, moved between existing in-page window presentations. */
export function CompanyTaskSurface({projectId, open, placement, onClose, onPlacement, opener, children, native}: {
  projectId: string; open: boolean; placement: Placement; onClose: () => void;
  onPlacement: (placement: Placement) => void; opener: RefObject<HTMLButtonElement | null>; children: ReactNode;
  native?: {detached?: DesktopWindowInfo; pending: boolean; canDetach: boolean; detach: () => void; focus: () => void};
}) {
  const [body] = useState(() => document.createElement('div'));
  const dock = useRef<HTMLDivElement>(null), floating = useRef<HTMLDivElement>(null);
  const floatButton = useRef<HTMLButtonElement>(null), dockButton = useRef<HTMLButtonElement>(null);
  const visited = useRef(false), previous = useRef({open: false, placement, detached: false});
  if (open) visited.current = true;
  useLayoutEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = placement === 'floating' ? floating.current : dock.current;
    const move = target && body.parentElement !== target;
    const retainFocus = active && body.contains(active);
    if (move) target.append(body);
    if (open && move && retainFocus) active.focus({preventScroll: true});
    else if (open && (!previous.current.open || previous.current.placement !== placement || previous.current.detached)) (placement === 'floating' ? dockButton.current : floatButton.current)?.focus({preventScroll: true});
    previous.current = {open, placement, detached: Boolean(native?.detached)};
  }, [body, open, placement, native?.detached?.id]);
  useLayoutEffect(() => () => body.remove(), [body]);
  const close = () => {onClose(); opener.current?.focus({preventScroll: true});};
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {event.preventDefault(); event.stopPropagation(); close();}
  };
  // Remounting the hidden shell can overwrite its saved size with a viewport clamp.
  return <>
    {native?.detached && open && <aside id="company-task-panel" className="company-task-panel" aria-label="Current task and plan"><h2>Task & plan is in its own window</h2><button onClick={native.focus}>Focus task window</button><button onClick={close}>Hide this panel</button></aside>}
    <aside id={native?.detached ? undefined : 'company-task-panel'} hidden={!open || placement !== 'docked' || Boolean(native?.detached)} className="company-task-panel company-task-surface-docked" aria-label="Current task and plan" onKeyDown={escape}>
      <div className="company-task-panel-heading"><h2>Task & plan</h2><div className="company-task-surface-actions">
        {native && <button className="company-open" aria-label="Detach task into separate window" title={native.canDetach ? 'Open task in a separate window' : 'A saved task for this project is required'} disabled={!native.canDetach || native.pending} onClick={native.detach}><ExternalLink size={17}/></button>}
        <button ref={floatButton} className="company-open" aria-label="Float task panel" title="Float within this window" onClick={() => onPlacement('floating')}><PanelsTopLeft size={17}/></button>
        <button className="company-open" aria-label="Close task panel" onClick={close}><X size={17}/></button>
      </div></div><div ref={dock}/>
    </aside>
    <FloatingWindow id={`company:leo-company:task-plan:${projectId}`} title="Task & plan" ariaLabel="Floating task and plan" open={open && placement === 'floating' && !native?.detached} onClose={close} onDetach={native?.canDetach && !native.pending ? native.detach : undefined} defaultSize={{width: 440, height: 620}} minSize={{width: 280, height: 240}} focusOnOpen={false} resetPosition className="company-task-surface-floating">
      <div className="company-task-surface-toolbar"><button ref={dockButton} className="company-open" onClick={() => onPlacement('docked')}><PanelRight size={15}/>Dock task panel</button><span>Within this window</span></div>
      <div ref={floating} className="company-task-panel"/>
    </FloatingWindow>
    {visited.current && !native?.detached && createPortal(<div onKeyDown={escape} inert={native?.pending}>{children}</div>, body)}
  </>;
}
