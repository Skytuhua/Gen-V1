import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FocusEvent, type ReactNode, type RefObject} from 'react';
import {GitPullRequest} from 'lucide-react';
import {Popover} from '../../../../packages/ui-shell/Popover';
import {projectColor} from '../project-colors';
import {createThreadHoverCache, createThreadHoverDataController, type ThreadHoverCache, type ThreadHoverDataState, type ThreadHoverLoad} from './data';
import {hoverScopeKey, scopedThreadHoverFacts, type ThreadHoverFacts, type ThreadHoverScope} from './facts';
import {createThreadHoverInteraction} from './interaction';
import './thread-hover.css';

export type ThreadHoverTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {ref: RefObject<HTMLButtonElement | null>};
export interface ThreadHoverCardProps<Target = unknown> {
  facts: ThreadHoverFacts<Target>;
  loadFacts?: ThreadHoverLoad<Target>;
  cache?: ThreadHoverCache<Target>;
  /** Parent owns drag/menu/modal availability; no global inventory is consulted. */
  blocked?: boolean;
  projectColors?: Record<string, string>;
  onOpenPR?: (target: Target, owner: ThreadHoverScope) => void;
  children: (trigger: ThreadHoverTriggerProps) => ReactNode;
}

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]';
const controls = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(focusable))
  .filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[inert], [hidden]'));

export function ThreadHoverCard<Target>({facts, loadFacts, cache: suppliedCache, blocked = false, projectColors, onOpenPR, children}: ThreadHoverCardProps<Target>) {
  const anchor = useRef<HTMLButtonElement>(null), content = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const id = useId(), [open, setOpen] = useState(false), [present, setPresent] = useState(false), [height, setHeight] = useState(282);
  const [dragging, setDragging] = useState(false), [state, setState] = useState<ThreadHoverDataState<Target>>({status: 'idle'});
  const [localCache] = useState(createThreadHoverCache<Target>);
  const interaction = useMemo(() => createThreadHoverInteraction(setOpen), []);
  const controller = useMemo(() => loadFacts ? createThreadHoverDataController({load: loadFacts, cache: suppliedCache ?? localCache, onChange: setState}) : null, [loadFacts, suppliedCache, localCache]);
  const scopeKey = hoverScopeKey(facts.scope), visible = open && !blocked && !dragging;
  const available = useRef(!blocked && !dragging); available.current = !blocked && !dragging;

  useLayoutEffect(() => {interaction.setBlocked(blocked || dragging);}, [interaction, blocked, dragging]);
  useEffect(() => () => interaction.dispose(), [interaction]);
  useEffect(() => {
    const document = anchor.current?.ownerDocument;
    if (!document) return;
    const start = () => {interaction.setBlocked(true); setDragging(true);};
    const end = () => setDragging(false);
    document.addEventListener('dragstart', start, true); document.addEventListener('dragend', end, true); document.addEventListener('drop', end, true);
    return () => {document.removeEventListener('dragstart', start, true); document.removeEventListener('dragend', end, true); document.removeEventListener('drop', end, true);};
  }, [interaction]);
  useEffect(() => {
    if (!visible || !controller) return;
    controller.activate(facts.scope);
    return () => controller.deactivate();
    // Scope identity, rather than a parent's newly allocated facts object, owns reads.
  }, [controller, visible, scopeKey]);
  useEffect(() => {
    if (visible) {setPresent(true); return;}
    const timer = setTimeout(() => setPresent(false), 120);
    return () => clearTimeout(timer);
  }, [visible]);

  const current = state.status !== 'idle' && hoverScopeKey(state.scope) === scopeKey ? state : null;
  const details = scopedThreadHoverFacts(current?.status === 'ready' ? {...facts, ...current.facts, scope: facts.scope, title: facts.title} : facts);
  const loading = Boolean(controller && (!current || current.status === 'loading'));
  const error = current?.status === 'error';

  useLayoutEffect(() => {
    if (!visible || !body) return;
    const element = body;
    const measure = () => setHeight(element.offsetHeight + 26);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [visible, body]);

  const within = (target: EventTarget | null) => Boolean(target && (anchor.current?.contains(target as Node) || content.current?.contains(target as Node)));
  const blur = (event: FocusEvent) => {if (!within(event.relatedTarget)) interaction.focus(false);};
  const canOpen = () => available.current && !anchor.current?.disabled && !anchor.current?.closest('[role="menu"], [role="listbox"]');
  const dismiss = () => interaction.dismiss();
  const enterCard = () => {
    const element = content.current;
    if (element) (controls(element)[0] ?? element).focus();
  };
  const rows: [string, ReactNode][] = [
    ['Machine', details.machine], ['Environment', details.environment], ['Working copy', details.workingCopy], ['Branch', details.branch],
    ['Runtime', details.runtime], ['Model', details.model], ['Reasoning', details.reasoning], ['Activity', details.activity],
    ['Last activity', details.lastActivity && <time dateTime={details.lastActivity.at}>{details.lastActivity.label}</time>],
    ['Source / handoff', details.sourceHandoff], ['Parent', details.parent && (details.parent.title ? `${details.parent.title} (${details.parent.threadId})` : details.parent.threadId)],
    ['Subagents', details.childCount !== undefined && Number.isSafeInteger(details.childCount) && details.childCount >= 0 ? String(details.childCount) : undefined],
  ];
  const knownRows = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');

  return <>
    {children({ref: anchor, 'aria-haspopup': 'dialog', 'aria-expanded': visible, 'aria-controls': visible ? id : undefined,
      onPointerEnter: event => {if (event.pointerType !== 'touch' && canOpen()) interaction.pointerEnter('trigger');},
      onPointerLeave: () => interaction.pointerLeave('trigger'),
      onPointerDown: dismiss,
      onContextMenu: dismiss,
      onFocus: event => {if (canOpen() && event.currentTarget.matches(':focus-visible')) interaction.focus(true);},
      onBlur: blur,
      onKeyDown: event => {
        if (!visible || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); dismiss();}
        else if ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown') {event.preventDefault(); enterCard();}
      },
    })}
    <Popover anchor={anchor} contentRef={content} open={visible} present={visible || present} width={304} height={height} align="start" preferredSide="below"
      id={id} className="thread-hover-card" role="dialog" aria-modal="false" aria-label={`Thread details: ${details.title}`} tabIndex={-1}
      onDismiss={dismiss} onPointerEnter={() => interaction.pointerEnter('card')} onPointerLeave={() => interaction.pointerLeave('card')}
      onFocus={() => interaction.focus(true)} onBlur={blur}
      onKeyDown={event => {
        if (event.key !== 'Tab' || event.nativeEvent.isComposing || !content.current) return;
        const items = controls(content.current), active = content.current.ownerDocument.activeElement;
        if (event.shiftKey && (active === items[0] || active === content.current)) {event.preventDefault(); anchor.current?.focus();}
        else if (!event.shiftKey && (active === items.at(-1) || !items.length)) {
          const next = controls(content.current.ownerDocument.body).find(node => !content.current?.contains(node) && anchor.current &&
            Boolean(anchor.current.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
          dismiss(); if (next) {event.preventDefault(); next.focus();}
        }
      }}>
      <div ref={setBody} className="thread-hover-body">
        <h2 className="thread-hover-title">{details.title}</h2>
        {details.project?.name && <div className="thread-hover-project">
          <span className={details.project.monogram ? 'thread-hover-monogram' : 'thread-hover-dot'} aria-hidden="true"
            style={{color: projectColor(details.scope.authority, details.scope.projectId ?? undefined, projectColors)}}>{details.project.monogram}</span>
          <span>{details.project.name}</span>
        </div>}
        {knownRows.length > 0 && <dl className="thread-hover-facts">{knownRows.map(([label, value]) => <div className="thread-hover-fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        {details.pullRequests && details.pullRequests.length > 0 && <ul className="thread-hover-prs" aria-label="Linked pull requests">
          {details.pullRequests.map(pr => <li key={pr.id}>
            {onOpenPR ? <button type="button" className="thread-hover-pr" aria-label={`Open PR ${pr.label}`} onClick={() => onOpenPR(pr.target, details.scope)}>
              <GitPullRequest size={14} aria-hidden="true"/><span><span className="thread-hover-pr-title">{pr.label}</span>
                {(pr.state || pr.checks) && <span className="thread-hover-pr-status">{[pr.state, pr.checks].filter(Boolean).join(' · ')}</span>}</span>
            </button> : <div className="thread-hover-pr"><GitPullRequest size={14} aria-hidden="true"/><span>{pr.label}
              {(pr.state || pr.checks) && <span className="thread-hover-pr-status">{[pr.state, pr.checks].filter(Boolean).join(' · ')}</span>}</span></div>}
          </li>)}
        </ul>}
        {details.pullRequestError && <div className="thread-hover-error"><p className="thread-hover-message" role="status">{details.pullRequestError}</p><button type="button" onClick={() => controller?.activate(facts.scope)}>Retry pull requests</button></div>}
        {loading && <p className="thread-hover-message" role="status">Loading details…</p>}
        {error && <div className="thread-hover-error"><p className="thread-hover-message" role="status">Details unavailable.</p><button type="button" onClick={() => controller?.activate(facts.scope)}>Retry</button></div>}
        {!loading && !error && !knownRows.length && !details.pullRequests?.length && <p className="thread-hover-message">No additional details.</p>}
      </div>
    </Popover>
  </>;
}
