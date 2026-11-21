import {Fragment, createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode} from 'react';
import {ChevronDown, ChevronRight, ExternalLink, Search, Send, Square, X} from 'lucide-react';
import {Select} from '../../../../packages/ui-shell/Select';
import {isComposing} from '../../../../packages/ui-shell/list-navigation';
import {agentStatuses, type AgentStatus, type AgentSummary} from '../../../../packages/contracts/agent-inventory';
import {useDesktop, useDetachedSurface, usePendingSurface} from '../desktop-context';
import {ComposerView} from '../ComposerView';
import {ComposerCommands,ComposerSkillBindings,type ComposerCommandsHandle} from '../ComposerCommands';
import {command} from '../api';
import {LoadingState} from '../LoadingState';
import {AgentsSkeleton, ConversationSkeleton} from '../ViewSkeletons';
import {Markdown} from '../Markdown';
import {projectColor} from '../project-colors';
import {groupAgents, type AgentNode, type AgentsWorkspaceController, type ProjectRow} from './controller';
import type {SharedAgentComposers} from './composer';
import {AgentWorkPanel} from './AgentWorkPanel';
import {agentProjectCatalog} from './project-catalog';
import './agents-workspace.css';
import {ErrorState} from '../../../../packages/ui-shell/Feedback';

export interface AgentsWorkspaceProps {
 controller: AgentsWorkspaceController;
 composers: SharedAgentComposers;
 onOpenConversation(threadId: string, intent?: 'model'): void;
 preferences?: {density?: 'compact' | 'comfortable'; projectColors?: Record<string, string>};
 projects?: readonly {id: string; name: string}[];
 hasConversations?: boolean;
}
const Visibility = createContext<(id: string, visible: boolean) => void>(() => {});
const statusLabel = (value: AgentStatus) => value.replaceAll('_', ' ');
export const columnsForWidth = (width: number): number => Math.max(1, Math.floor((width + 10) / 350));
const relativeTime = (value: string) => {
 const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
 return !Number.isFinite(minutes) ? '' : minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

/** Personal-only leaf: the outer host selects compact bootstrap before mounting any legacy App. */
export function AgentsWorkspace({controller, composers, onOpenConversation, preferences, projects = [], hasConversations = false}: AgentsWorkspaceProps) {
 const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [searchOpen, setSearchOpen] = useState(Boolean(state.scope.text)), [text, setText] = useState(state.scope.text ?? '');
 const rows = useMemo(() => groupAgents(state.agents), [state.agents]);
 const catalog = useMemo(() => agentProjectCatalog(projects, state.agents), [projects, state.agents]);
 const viewport = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), latestScope = useRef(state.scope); latestScope.current = state.scope;
 const pushed = useRef(state.scope.text ?? undefined);
 const visible = useMemo(() => {
  const ids = new Set<string>(); let frame = 0;
  return {set: (id: string, value: boolean) => {if (value) ids.add(id); else ids.delete(id); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => controller.setVisible([...ids]));}, dispose: () => {cancelAnimationFrame(frame); controller.setVisible([]);}};
 }, [controller]);
 useEffect(() => () => visible.dispose(), [visible]);
 useEffect(() => {
  if (text === (latestScope.current.text ?? '')) return;
  const timer = setTimeout(() => {const next = text.trim().slice(0, 200) || undefined; pushed.current = next; void controller.setScope({...latestScope.current, text: next});}, 200);
  return () => clearTimeout(timer);
 }, [text, controller]);
 // AUD-13: adopt controller-side scope text (external setScope) unless the search box holds an active edit.
 useEffect(() => {
  if ((state.scope.text ?? '') === (pushed.current ?? '') || document.activeElement === search.current) return;
  pushed.current = state.scope.text ?? undefined;
  setText(state.scope.text ?? '');
 }, [state.scope.text]);
 useEffect(() => {const external = controller.getSnapshot().scope.text ?? undefined; pushed.current = external; setText(external ?? '');}, [controller]);
 useLayoutEffect(() => {if (viewport.current) viewport.current.scrollTop = controller.view('$workspace').top;}, [controller]);
 return <Visibility.Provider value={visible.set}><section className="agents-workspace" aria-label="Agent workspace" data-density={preferences?.density ?? 'comfortable'}>
  <div className="agents-toolbar" role="toolbar" aria-label="Agent filters">
   <Select aria-label="Project filter" value={state.scope.projectId === undefined ? '$all' : state.scope.projectId === null ? '$none' : state.scope.projectId} options={[{value: '$all', label: 'All projects'}, ...[...catalog].map(([value, label]) => ({value, label})), {value: '$none', label: 'No project'}]} onValueChange={value => {void controller.setScope({...state.scope, projectId: value === '$all' ? undefined : value === '$none' ? null : value});}}/>
   <Select aria-label="Status filter" value={state.scope.statuses?.[0] ?? '$all'} options={[{value: '$all', label: 'All statuses'}, ...agentStatuses.map(value => ({value, label: statusLabel(value)}))]} onValueChange={value => {void controller.setScope({...state.scope, statuses: value === '$all' ? undefined : [value as AgentStatus]});}}/>
   <button type="button" className="agents-icon" aria-label={searchOpen ? 'Close agent search' : 'Search agents'} aria-expanded={searchOpen} onClick={() => {setSearchOpen(!searchOpen); if (searchOpen) setText(''); else requestAnimationFrame(() => search.current?.focus());}}>{searchOpen ? <X size={16}/> : <Search size={16}/>}</button>
   {searchOpen && <input ref={search} type="search" aria-label="Filter agents" placeholder="Find agent…" maxLength={200} value={text} onChange={event => setText(event.target.value)}/>}
   <span className="agents-connectivity" role="status" data-connected={state.connected} title={state.pending ? 'Connecting to the agent service' : state.connected ? 'Connected to the agent service' : 'Reconnecting to the agent service'}><span className="agents-connectivity-dot" aria-hidden="true"/>{state.pending ? '' : state.connected ? 'Live' : 'Reconnecting…'}</span>
  </div>
  {state.error && <ErrorState className="agents-error" message={state.error} retryLabel="Retry connection" onRetry={() => {void controller.start();}} />}
  <div className="agents-projects" ref={viewport} onScroll={event => controller.setView('$workspace', {top: event.currentTarget.scrollTop})}>
   <LoadingState pending={state.pending} hasContent={Boolean(state.scopeKey) || rows.length > 0} label="Loading agents…" skeleton={<AgentsSkeleton/>}>
   {Boolean(state.scopeKey) && !rows.length && <p className="agents-empty">{state.scope.text || state.scope.statuses || state.scope.projectId !== undefined ? 'No agents match these filters.' : hasConversations ? 'No active agents. Agents appear here once a conversation starts working.' : 'No agents yet. Open a conversation to begin.'}</p>}
   {rows.map(row => <Project key={row.id ?? '$none'} row={row} controller={controller} composers={composers} onOpenConversation={onOpenConversation} preferences={preferences}/>)}
   </LoadingState>
  </div>
 </section></Visibility.Provider>;
}

function VirtualSlot({children, className, label}: {children: ReactNode; className: string; label: string}) {
 const ref = useRef<HTMLDivElement>(null), [near, setNear] = useState(false), [held, setHeld] = useState(false), [height, setHeight] = useState(180);
 useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {rootMargin: '200px'});
  if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
 }, []);
 const mounted = near || held;
 useLayoutEffect(() => {
  const card = ref.current?.firstElementChild;
  if (!mounted || !card) return;
  const observer = new ResizeObserver(() => setHeight(Math.ceil(card.getBoundingClientRect().height)));
  observer.observe(card); return () => observer.disconnect();
 }, [mounted]);
 useLayoutEffect(() => {
  const slot = ref.current;
  // Arrow navigation and the reveal control can focus the stable slot before its card mounts.
  if (mounted && slot && slot.ownerDocument.activeElement === slot) {
   slot.querySelector<HTMLElement>(':scope > .agents-agent')?.focus({preventScroll: true});
  }
 }, [mounted]);
 const reveal = () => {ref.current?.focus(); setHeld(true);};
 return <div ref={ref} tabIndex={-1} className={className} style={mounted ? undefined : {minHeight: height}} onFocusCapture={() => setHeld(true)} onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);}}>
  {mounted ? children : <button type="button" className="agents-virtual-reveal" onFocus={reveal} onClick={reveal}>Show {label}</button>}
 </div>;
}
function Project({row, controller, ...props}: {row: ProjectRow} & Omit<AgentsWorkspaceProps, 'projects'>) {
 const color = projectColor({kind: 'local'}, row.id ?? undefined, props.preferences?.projectColors);
 const count = (nodes: AgentNode[]): number => nodes.reduce((total, node) => total + Number(node.agent.status === 'working') + count(node.children), 0);
 const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
  if (isComposing(event) || event.altKey || event.metaKey || event.ctrlKey) return;
  const key = event.key;
  if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowUp' && key !== 'ArrowDown') return;
  const target = event.target as HTMLElement;
  if (target.closest('.agents-transcript, textarea, input, select')) return;
  const slots = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':scope > .agents-grid-slot'));
  const current = slots.findIndex(slot => slot === target || slot.contains(target));
  const columns = columnsForWidth(event.currentTarget.clientWidth);
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : key === 'ArrowDown' ? columns : -columns;
  const next = current < 0 ? (step > 0 ? 0 : slots.length - 1) : current + step;
  if (next < 0 || next >= slots.length) return;
  event.preventDefault();
  const destination = slots[next].querySelector<HTMLElement>('.agents-agent') ?? slots[next];
  destination.focus();
  destination.scrollIntoView({block: 'nearest'});
 };
 return <section className="agents-project" role="region" aria-label={`Project ${row.name}`}>
  <header className="agents-project-header"><span className="agents-project-mark" style={{'--project-color': color} as CSSProperties} aria-hidden="true">{row.name.slice(0, 1).toUpperCase()}</span><h2>{row.name}</h2><span>{count(row.parents)} working</span></header>
  <div className="agents-project-slot">
   <div className="agents-agent-grid" role="region" aria-label={`${row.name} agents`} tabIndex={0} onKeyDown={navigate}>
    {row.parents.map(node => <VirtualSlot className="agents-grid-slot" key={node.agent.agentId} label={node.agent.title}><Agent node={node} controller={controller} {...props}/></VirtualSlot>)}
   </div>
  </div>
 </section>;
}
function Agent({node, controller, composers, onOpenConversation, preferences}: {node: AgentNode} & Omit<AgentsWorkspaceProps, 'projects'>) {
 const {agent, children} = node;
 useSyncExternalStore(controller.subscribe, controller.getSnapshot);
 const view = controller.view(agent.agentId), child = Boolean(agent.parentId), groupId = useId(), expandedChildren = view.expandedChildren ?? [];
 const toggle = () => controller.setView(agent.agentId, {childrenExpanded: !view.childrenExpanded}, true);
 const time = relativeTime(agent.updatedAt), meta = [agent.modelId, time].filter(Boolean).join(' · ');
 const status = statusLabel(agent.status), statusText = status.charAt(0).toUpperCase() + status.slice(1), showStatus = !['working', 'ready', 'completed'].includes(agent.status);
 const action = agent.currentAction || (showStatus ? '' : agent.status === 'completed' ? 'Work completed' : statusText);
 return <section className={`agents-agent${child ? ' agents-child' : ''}`} tabIndex={-1} role="group" aria-label={`Agent ${agent.title}`} data-agent-id={agent.agentId}>
  {agent.reportedPercent !== null && <progress className="agents-card-progress" max={100} value={agent.reportedPercent} aria-label={`${agent.title} progress`}/>}
  <header className="agents-agent-header">
   <span className="agents-status-dot" data-state={agent.status} title={statusText} aria-hidden="true"/>
   <div className="agents-agent-title"><h3 title={agent.title}>{agent.title}</h3></div>
   <span className="agents-agent-state sr-only" data-state={agent.status}>{statusText}</span>
   {meta && <span className="agents-meta" title={[agent.modelId, agent.updatedAt].filter(Boolean).join(' · ')}>{agent.modelId}{agent.modelId && time && ' · '}{time && <time dateTime={agent.updatedAt}>{time}</time>}</span>}
   {!child && agent.threadId && <button type="button" className="agents-icon" aria-label={`Open conversation ${agent.title}`} title="Open conversation" onClick={() => onOpenConversation(agent.threadId!)}><ExternalLink size={15}/></button>}
  </header>
  <p className="agents-activity" title={[showStatus && statusText, action].filter(Boolean).join(' · ')}>{showStatus && <span className="agents-action-state">{statusText}{action && ' · '}</span>}{action}</p>
  {agent.threadId ? <Transcript agent={agent} controller={controller}/> : <p className="agents-empty">Transcript unavailable.</p>}
  {!child && agent.threadId && <AgentWorkPanel threadId={agent.threadId}/>}
  {composers.supports(agent) ? <InlineComposer agent={agent} composers={composers} controller={controller} onOpenConversation={onOpenConversation}/> : child && <p className="agents-readonly">{agent.status === 'working' ? 'Follow-up unavailable' : 'Read-only'}</p>}
  {Boolean(children.length) && <footer className="agents-children"><button type="button" className="agents-disclosure" aria-expanded={Boolean(view.childrenExpanded)} aria-controls={groupId} onClick={toggle}>{view.childrenExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}{children.length} {children.length === 1 ? 'subagent' : 'subagents'}</button><div id={groupId} hidden={!view.childrenExpanded}>{children.map(node => {
   const item = node.agent, expanded = expandedChildren.includes(item.agentId), id = groupId + ':' + item.agentId;
   return <div key={item.agentId} className="agents-child-item">
    <button type="button" className="agents-child-row" aria-label={`Inspect subagent ${item.title}`} aria-expanded={expanded} aria-controls={id} onClick={() => controller.setView(agent.agentId, {expandedChildren: expanded ? expandedChildren.filter(value => value !== item.agentId) : [...expandedChildren, item.agentId]}, true)}>
     <span className="agents-status-dot" data-state={item.status} aria-hidden="true"/><strong title={item.title}>{item.title}</strong><span className="agents-child-action" title={item.currentAction ?? undefined}>{item.currentAction}</span><span className="agents-child-status">{statusLabel(item.status)}</span>{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
    </button>
    <div id={id}>{expanded && <Agent node={node} controller={controller} composers={composers} onOpenConversation={onOpenConversation} preferences={preferences}/>}</div>
   </div>;
  })}</div></footer>}
 </section>;
}
function Transcript({agent, controller}: {agent: AgentSummary; controller: AgentsWorkspaceController}) {
 useSyncExternalStore(controller.subscribe, controller.getSnapshot);
 const state = controller.transcript(agent.agentId), view = controller.view(agent.agentId), expanded = Boolean(view.transcriptExpanded), transcriptId = useId(), setVisible = useContext(Visibility), wrapper = useRef<HTMLDivElement>(null), log = useRef<HTMLDivElement>(null), previous = useRef({height: 0, first: '', initialized: false});
 useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => setVisible(agent.agentId, entry.isIntersecting), {rootMargin: '80px'});
  if (wrapper.current) observer.observe(wrapper.current);
  return () => {observer.disconnect(); setVisible(agent.agentId, false);};
 }, [agent.agentId, setVisible]);
 useLayoutEffect(() => {
  const element = log.current; if (!element || !state.loaded || !expanded) return;
  const old = previous.current, first = state.messages[0]?.id ?? '';
  const anchor = view.anchorId && [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === view.anchorId);
  if (view.atEnd) element.scrollTop = element.scrollHeight;
  else if (anchor && view.anchorOffset !== undefined) element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - view.anchorOffset;
  else if (!old.initialized) element.scrollTop = view.top;
  else if (old.first !== first) element.scrollTop = view.top + element.scrollHeight - old.height;
  previous.current = {height: element.scrollHeight, first, initialized: true};
  controller.setView(agent.agentId, {top: element.scrollTop});
 }, [state.messages, state.loaded, controller, agent.agentId, view.atEnd, expanded]);
 const latest = state.messages.at(-1);
 return <div className="agents-transcript-wrap" ref={wrapper} data-expanded={expanded}>
  <div className="agents-preview" hidden={expanded}>{state.error ? <ErrorState className="agents-error" message={state.error} retryLabel="Retry history" onRetry={() => {void controller.retryHistory(agent.agentId);}}/> : <div className="agents-preview-text">{latest ? <span>{latest.content.trimEnd()}</span> : <p className="agents-transcript-empty">{state.pending ? 'Loading messages…' : state.loaded ? 'No messages yet.' : 'Messages load as they come into view.'}</p>}</div>}</div>
  <button type="button" className="agents-transcript-toggle" aria-expanded={expanded} aria-controls={transcriptId} aria-label={expanded ? 'Hide transcript' : 'Show transcript'} onClick={() => controller.setView(agent.agentId, {transcriptExpanded: !expanded}, true)}>{expanded ? 'Hide' : 'Show transcript'}{expanded ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</button>
  <div className="agents-transcript-expansion" data-expanded={expanded} inert={!expanded} aria-hidden={!expanded} id={transcriptId}><div className="agents-transcript-clip"><div className="agents-transcript" role="log" aria-label={`${agent.title} messages`} aria-live="off" tabIndex={0} ref={log} onFocus={() => controller.setView(agent.agentId, {focus: 'transcript'})} onScroll={event => {
  if (!expanded) return;
  const element = event.currentTarget, atEnd = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
  const top = element.getBoundingClientRect().top, anchor = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > top);
  controller.setView(agent.agentId, {top: element.scrollTop, atEnd, anchorId: anchor?.dataset.messageId, anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : undefined, ...(atEnd ? {unread: false} : {})});
 }}>
  {state.cursor && <button type="button" className="agents-earlier" disabled={state.pending} onClick={() => {void controller.loadEarlier(agent.agentId);}}>Load earlier messages</button>}
  <LoadingState pending={state.pending && !state.error} hasContent={state.loaded} label="Loading messages…" skeleton={<ConversationSkeleton/>}>
  {!state.loaded && !state.error && <p className="agents-transcript-empty">Messages load as they come into view.</p>}
  {state.loaded && !state.messages.length && <p className="agents-transcript-empty">No messages yet.</p>}
  {state.messages.map(message => <Fragment key={message.id}>{state.gaps.some(gap => gap.beforeId === message.id) && <button type="button" className="agents-earlier" disabled={state.pending} onClick={() => {void controller.loadEarlier(agent.agentId, message.id);}}>Load missing messages</button>}<article className={`agents-message agents-message-${message.role}`} data-message-id={message.id}><span className="agents-message-role">{message.role}</span><Markdown text={message.content}/></article></Fragment>)}
  </LoadingState>
  {state.error && <ErrorState className="agents-error" message={state.error} retryLabel="Retry history" onRetry={() => {void controller.retryHistory(agent.agentId);}} />}
 </div></div></div>{expanded && view.unread && <button type="button" className="agents-new-output" onClick={() => {controller.setView(agent.agentId, {atEnd: true, unread: false}, true); log.current?.scrollTo({top: log.current.scrollHeight});}}>New output</button>}</div>;
}
function InlineComposer({agent, composers, controller,onOpenConversation}: {agent: AgentSummary; composers: SharedAgentComposers; controller: AgentsWorkspaceController;onOpenConversation:AgentsWorkspaceProps['onOpenConversation']}) {
 const state = useSyncExternalStore(listener => composers.subscribe(agent, listener), () => composers.getSnapshot(agent)), input = useRef<HTMLTextAreaElement>(null), commands=useRef<ComposerCommandsHandle>(null);
 useEffect(() => {void composers.prepare(agent);}, [composers, agent.threadId, agent.agentId, agent.revision]);
 const desktop = useDesktop(), surface = agent.threadId ? {kind: 'thread' as const, threadId: agent.threadId} : null;
 const detached = useDetachedSurface(surface), pending = usePendingSurface(surface), held = Boolean(detached || pending || desktop?.closing);
 const currentHeld = useRef(held); currentHeld.current = held;
 const modeOwner = useRef({held, revision: 0, active: true});
 if (modeOwner.current.held !== held) modeOwner.current = {...modeOwner.current, held, revision: modeOwner.current.revision + 1};
 useEffect(() => {modeOwner.current.active = true; return () => {modeOwner.current.active = false; modeOwner.current.revision++;};}, []);
 const skillsBlocked = !agent.parentId && Boolean(state.skills?.length) && !state.retry;
 const send = () => {if (!currentHeld.current && !skillsBlocked) void composers.submit(agent);};
 return <><div inert={held}><ComposerView className="agents-composer" onSubmit={event => {event.preventDefault(); send();}}>
  <div className="agents-composer-entry"><textarea ref={input} aria-label={`Message to ${agent.title}`} placeholder={agent.parentId ? 'Follow up…' : 'Message…'} rows={1} value={state.draft} disabled={held || !state.ready} onFocus={() => controller.setView(agent.agentId, {focus: 'composer'})} onChange={event => {void composers.edit(agent, event.target.value);}} onKeyDown={event => {if(commands.current?.keyDown(event))return;if (isComposing(event) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return; if (event.key === 'Enter') {event.preventDefault(); send();}}}/>
   <div className="agents-composer-actions">
    {!agent.parentId && agent.status === 'working' && <button type="button" title={state.stopping ? 'Stopping…' : 'Stop'} aria-label={`Stop ${agent.title}`} disabled={held || state.stopping} onClick={() => {if (!currentHeld.current) void composers.stop(agent);}}><Square size={13}/></button>}
    <button type="submit" title={state.retry ? 'Retry send' : 'Send'} aria-label={`${state.retry ? 'Retry send to' : 'Send to'} ${agent.title}`} disabled={held || skillsBlocked || !composers.canSend(agent) || !state.retry && !state.draft.trim()}><Send size={14}/></button>
   </div>
  </div>
  {!agent.parentId&&<><ComposerSkillBindings bindings={state.skills??[]} retry={state.retry} disabled={held} onRemove={id=>{void composers.removeSkill(agent,id).catch(()=>{});}}/><ComposerCommands ref={commands} input={input} draft={state.draft} threadId={agent.threadId??undefined} projectId={agent.projectId??undefined} disabled={held||!state.ready||state.busy||state.stopping} onDraft={text=>{void composers.edit(agent,text);}} onModel={()=>{if(agent.threadId)onOpenConversation(agent.threadId,'model');}} onMode={async mode=>{if(agent.status==='working')throw Error('Wait for the active run to finish to change mode.');const revision=modeOwner.current.revision,owner=desktop?desktop.ownership(surface):0;if(agent.threadId)await command('thread.mode',{mode},agent.threadId,undefined,()=>modeOwner.current.active&&!currentHeld.current&&modeOwner.current.revision===revision&&owner!==undefined&&(!desktop||desktop.ownership(surface)===owner));}}/></>}
  {(state.ticket || state.busy) && <p className="agents-composer-status" role="status">{state.ticket ? `${state.ticket.status.replaceAll('_', ' ')}${state.ticket.error ? ': ' + state.ticket.error : ''}` : 'Sending…'}</p>}
  {!agent.parentId && !agent.modelId && <p className="agents-readonly">Choose a model in this conversation to send.</p>}
  {state.error && <ErrorState className="agents-error" message={state.error} />}
 </ComposerView></div>{detached ? <button type="button" onClick={() => {void desktop?.bridge.focus(detached.id).catch(() => {});}}>Focus existing window</button> : pending && <p role="status">Opening conversation window…</p>}</>;
}
