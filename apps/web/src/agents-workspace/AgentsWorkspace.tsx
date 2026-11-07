import {Fragment, createContext, useContext, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode} from 'react';
import {ChevronDown, ChevronRight, ExternalLink, Search, Send, Square, X} from 'lucide-react';
import {Select} from '../../../../packages/ui-shell/Select';
import {isComposing} from '../../../../packages/ui-shell/list-navigation';
import {agentStatuses, type AgentStatus, type AgentSummary} from '../../../../packages/contracts/agent-inventory';
import {ComposerView} from '../ComposerView';
import {ComposerCommands,ComposerSkillBindings,type ComposerCommandsHandle} from '../ComposerCommands';
import {command} from '../api';
import {PendingStatus} from '../LoadingState';
import {Markdown} from '../Markdown';
import {projectColor} from '../project-colors';
import {groupAgents, type AgentNode, type AgentsWorkspaceController, type ProjectRow} from './controller';
import type {SharedAgentComposers} from './composer';
import './agents-workspace.css';

export interface AgentsWorkspaceProps {
 controller: AgentsWorkspaceController;
 composers: SharedAgentComposers;
 onOpenConversation(threadId: string, intent?: 'model'): void;
 preferences?: {density?: 'compact' | 'comfortable'; projectColors?: Record<string, string>};
 projects?: readonly {id: string; name: string}[];
}
const Visibility = createContext<(id: string, visible: boolean) => void>(() => {});
const statusLabel = (value: AgentStatus) => value.replaceAll('_', ' ');

/** Personal-only leaf: the outer host selects compact bootstrap before mounting any legacy App. */
export function AgentsWorkspace({controller, composers, onOpenConversation, preferences, projects = []}: AgentsWorkspaceProps) {
 const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [searchOpen, setSearchOpen] = useState(Boolean(state.scope.text)), [text, setText] = useState(state.scope.text ?? '');
 const rows = useMemo(() => groupAgents(state.agents), [state.agents]);
 const catalog = useRef(new Map<string, string>());
 for (const project of projects) catalog.current.set(project.id, project.name);
 for (const agent of state.agents) if (agent.projectId) catalog.current.set(agent.projectId, agent.projectName ?? agent.projectId);
 const viewport = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null), latestScope = useRef(state.scope); latestScope.current = state.scope;
 const visible = useMemo(() => {
  const ids = new Set<string>(); let frame = 0;
  return {set: (id: string, value: boolean) => {if (value) ids.add(id); else ids.delete(id); cancelAnimationFrame(frame); frame = requestAnimationFrame(() => controller.setVisible([...ids]));}, dispose: () => {cancelAnimationFrame(frame); controller.setVisible([]);}};
 }, [controller]);
 useEffect(() => () => visible.dispose(), [visible]);
 useEffect(() => {
  if (text === (latestScope.current.text ?? '')) return;
  const timer = setTimeout(() => {void controller.setScope({...latestScope.current, text: text.trim().slice(0, 200) || undefined});}, 200);
  return () => clearTimeout(timer);
 }, [text, controller]);
 useLayoutEffect(() => {if (viewport.current) viewport.current.scrollTop = controller.view('$workspace').top;}, [controller]);
 return <Visibility.Provider value={visible.set}><section className="agents-workspace" aria-label="Agent workspace" data-density={preferences?.density ?? 'comfortable'}>
  <div className="agents-toolbar" role="toolbar" aria-label="Agent filters">
   <Select aria-label="Project filter" value={state.scope.projectId === undefined ? '$all' : state.scope.projectId === null ? '$none' : state.scope.projectId} options={[{value: '$all', label: 'All projects'}, ...[...catalog.current].map(([value, label]) => ({value, label})), {value: '$none', label: 'No project'}]} onValueChange={value => {void controller.setScope({...state.scope, projectId: value === '$all' ? undefined : value === '$none' ? null : value});}}/>
   <Select aria-label="Status filter" value={state.scope.statuses?.[0] ?? '$all'} options={[{value: '$all', label: 'All statuses'}, ...agentStatuses.map(value => ({value, label: statusLabel(value)}))]} onValueChange={value => {void controller.setScope({...state.scope, statuses: value === '$all' ? undefined : [value as AgentStatus]});}}/>
   <button type="button" className="agents-icon" aria-label={searchOpen ? 'Close agent search' : 'Search agents'} aria-expanded={searchOpen} onClick={() => {setSearchOpen(!searchOpen); if (searchOpen) setText(''); else requestAnimationFrame(() => search.current?.focus());}}>{searchOpen ? <X size={16}/> : <Search size={16}/>}</button>
   {searchOpen && <input ref={search} type="search" aria-label="Filter agents" placeholder="Find agent…" maxLength={200} value={text} onChange={event => setText(event.target.value)}/>}
   <span className="agents-connectivity" role="status">{state.pending ? 'Loading…' : state.connected ? 'Live' : 'Reconnecting…'}</span>
  </div>
  {state.error && <div className="agents-error" role="alert">{state.error}<button type="button" onClick={() => {void controller.start();}}>Retry connection</button></div>}
  <PendingStatus pending={state.pending} label="Loading agents…"/>
  <div className="agents-projects" ref={viewport} onScroll={event => controller.setView('$workspace', {top: event.currentTarget.scrollTop})}>
   {!state.pending && !rows.length && <p className="agents-empty">{state.scope.text || state.scope.statuses || state.scope.projectId !== undefined ? 'No agents match these filters.' : 'No agents yet. Open a conversation to begin.'}</p>}
   {rows.map(row => <Project key={row.id ?? '$none'} row={row} controller={controller} composers={composers} onOpenConversation={onOpenConversation} preferences={preferences}/>)}
  </div>
 </section></Visibility.Provider>;
}

function VirtualSlot({children, className, label}: {children: ReactNode; className: string; label: string}) {
 const ref = useRef<HTMLDivElement>(null), [near, setNear] = useState(false), [held, setHeld] = useState(false);
 useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {rootMargin: '200px'});
  if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
 }, []);
 return <div ref={ref} className={className} onFocusCapture={() => setHeld(true)} onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);}}>
  {near || held ? children : <button type="button" className="agents-virtual-reveal" onFocus={() => setHeld(true)} onClick={() => setHeld(true)}>Show {label}</button>}
 </div>;
}
function ColumnScroll({controller, id, children}: {controller: AgentsWorkspaceController; id: string; children: ReactNode}) {
 const restore = useCallback((element: HTMLDivElement | null) => {if (element) element.scrollTop = controller.view('$column:' + id).top;}, [controller, id]);
 return <div className="agents-column-scroll" ref={restore} onScroll={event => controller.setView('$column:' + id, {top: event.currentTarget.scrollTop})}>{children}</div>;
}
function Project({row, controller, ...props}: {row: ProjectRow} & Omit<AgentsWorkspaceProps, 'projects'>) {
 const id = '$project:' + (row.id ?? '$none'), color = projectColor({kind: 'local'}, row.id ?? undefined, props.preferences?.projectColors);
 const restoreStrip = useCallback((element: HTMLDivElement | null) => {if (element) element.scrollLeft = controller.view(id).left;}, [controller, id]);
 const count = (nodes: AgentNode[]): number => nodes.reduce((total, node) => total + Number(node.agent.status === 'working') + count(node.children), 0);
 return <section className="agents-project" role="region" aria-label={`Project ${row.name}`}>
  <header className="agents-project-header"><span className="agents-project-mark" style={{'--project-color': color} as CSSProperties} aria-hidden="true">{row.name.slice(0, 1).toUpperCase()}</span><h2>{row.name}</h2><span>{count(row.parents)} working</span></header>
  <VirtualSlot className="agents-project-slot" label={`${row.name} agents`}>
   <div className="agents-parent-strip" ref={restoreStrip} role="region" aria-label={`${row.name} agents`} tabIndex={0} onScroll={event => controller.setView(id, {left: event.currentTarget.scrollLeft})} onKeyDown={event => {
    if (event.target !== event.currentTarget || isComposing(event) || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {event.preventDefault(); event.currentTarget.scrollBy({left: event.key === 'ArrowRight' ? 476 : -476, behavior: 'instant'});}
   }}>
    {row.parents.map(node => <VirtualSlot className="agents-column-slot" key={node.agent.agentId} label={node.agent.title}><ColumnScroll controller={controller} id={node.agent.agentId}><Agent node={node} controller={controller} {...props}/></ColumnScroll></VirtualSlot>)}
   </div>
  </VirtualSlot>
 </section>;
}
function Agent({node, controller, composers, onOpenConversation, preferences}: {node: AgentNode} & Omit<AgentsWorkspaceProps, 'projects'>) {
 const {agent, children} = node;
 useSyncExternalStore(controller.subscribe, controller.getSnapshot);
 const view = controller.view(agent.agentId), child = Boolean(agent.parentId), groupId = useId();
 const toggle = () => controller.setView(agent.agentId, {collapsed: !view.collapsed}, true);
 return <section className={`agents-agent${child ? ' agents-child' : ''}`} role="group" aria-label={`Agent ${agent.title}`}>
  <header className="agents-agent-header"><div className="agents-agent-title"><h3>{agent.title}</h3><span className="agents-agent-state" data-state={agent.status}>{statusLabel(agent.status)}</span></div>
   {!child && agent.threadId && <button type="button" className="agents-icon" aria-label={`Open conversation ${agent.title}`} onClick={() => onOpenConversation(agent.threadId!)}><ExternalLink size={15}/></button>}
  </header>
  <div className="agents-activity">{agent.modelId && <span className="agents-model">{agent.modelId}</span>}<p>{agent.currentAction || (agent.status === 'completed' ? 'Work completed' : statusLabel(agent.status))}</p>{agent.reportedPercent !== null && <progress max={100} value={agent.reportedPercent} aria-label={`${agent.title} progress`}/>}</div>
  {agent.threadId ? <Transcript agent={agent} controller={controller}/> : <p className="agents-empty">Transcript unavailable.</p>}
  {composers.supports(agent) ? <InlineComposer agent={agent} composers={composers} controller={controller} onOpenConversation={onOpenConversation}/> : child && <p className="agents-readonly">{agent.status === 'working' ? 'Follow-up unavailable' : 'Read-only'}</p>}
  {Boolean(children.length) && <div className="agents-children"><button type="button" className="agents-disclosure" aria-expanded={!view.collapsed} aria-controls={groupId} onClick={toggle}>{view.collapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}Subagents · {children.length}</button><div id={groupId} hidden={view.collapsed}>{children.map(child => <Agent key={child.agent.agentId} node={child} controller={controller} composers={composers} onOpenConversation={onOpenConversation} preferences={preferences}/>)}</div></div>}
 </section>;
}
function Transcript({agent, controller}: {agent: AgentSummary; controller: AgentsWorkspaceController}) {
 useSyncExternalStore(controller.subscribe, controller.getSnapshot);
 const state = controller.transcript(agent.agentId), view = controller.view(agent.agentId), setVisible = useContext(Visibility), log = useRef<HTMLDivElement>(null), previous = useRef({height: 0, first: '', initialized: false});
 useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => setVisible(agent.agentId, entry.isIntersecting), {rootMargin: '80px'});
  if (log.current) observer.observe(log.current);
  return () => {observer.disconnect(); setVisible(agent.agentId, false);};
 }, [agent.agentId, setVisible]);
 useLayoutEffect(() => {
  const element = log.current; if (!element || !state.loaded) return;
  const old = previous.current, first = state.messages[0]?.id ?? '';
  const anchor = view.anchorId && [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.dataset.messageId === view.anchorId);
  if (view.atEnd) element.scrollTop = element.scrollHeight;
  else if (anchor && view.anchorOffset !== undefined) element.scrollTop += anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - view.anchorOffset;
  else if (!old.initialized) element.scrollTop = view.top;
  else if (old.first !== first) element.scrollTop = view.top + element.scrollHeight - old.height;
  previous.current = {height: element.scrollHeight, first, initialized: true};
  controller.setView(agent.agentId, {top: element.scrollTop});
 }, [state.messages, state.loaded, controller, agent.agentId, view.atEnd]);
 return <div className="agents-transcript-wrap"><div className="agents-transcript" role="log" aria-label={`${agent.title} messages`} aria-live="off" tabIndex={0} ref={log} onFocus={() => controller.setView(agent.agentId, {focus: 'transcript'})} onScroll={event => {
  const element = event.currentTarget, atEnd = element.scrollHeight - element.clientHeight - element.scrollTop < 24;
  const top = element.getBoundingClientRect().top, anchor = [...element.querySelectorAll<HTMLElement>('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > top);
  controller.setView(agent.agentId, {top: element.scrollTop, atEnd, anchorId: anchor?.dataset.messageId, anchorOffset: anchor ? anchor.getBoundingClientRect().top - top : undefined, ...(atEnd ? {unread: false} : {})});
 }}>
  {state.cursor && <button type="button" className="agents-earlier" disabled={state.pending} onClick={() => {void controller.loadEarlier(agent.agentId);}}>Load earlier messages</button>}
  {!state.loaded && !state.error && <p className="agents-transcript-empty">{state.pending ? 'Loading messages…' : 'Messages load as they come into view.'}</p>}
  {state.loaded && !state.messages.length && <p className="agents-transcript-empty">No messages yet.</p>}
  {state.messages.map(message => <Fragment key={message.id}>{state.gaps.some(gap => gap.beforeId === message.id) && <button type="button" className="agents-earlier" disabled={state.pending} onClick={() => {void controller.loadEarlier(agent.agentId, message.id);}}>Load missing messages</button>}<article className={`agents-message agents-message-${message.role}`} data-message-id={message.id}><span className="agents-message-role">{message.role}</span><Markdown text={message.content}/></article></Fragment>)}
  {state.error && <div className="agents-error" role="alert">{state.error}<button type="button" onClick={() => {void controller.retryHistory(agent.agentId);}}>Retry history</button></div>}
 </div>{view.unread && <button type="button" className="agents-new-output" onClick={() => {controller.setView(agent.agentId, {atEnd: true, unread: false}, true); log.current?.scrollTo({top: log.current.scrollHeight});}}>New output</button>}</div>;
}
function InlineComposer({agent, composers, controller,onOpenConversation}: {agent: AgentSummary; composers: SharedAgentComposers; controller: AgentsWorkspaceController;onOpenConversation:AgentsWorkspaceProps['onOpenConversation']}) {
 const state = useSyncExternalStore(listener => composers.subscribe(agent, listener), () => composers.getSnapshot(agent)), input = useRef<HTMLTextAreaElement>(null), commands=useRef<ComposerCommandsHandle>(null);
 useEffect(() => {void composers.prepare(agent);}, [composers, agent.threadId, agent.agentId, agent.revision]);
 const send = () => {void composers.submit(agent);};
 return <ComposerView className="agents-composer" onSubmit={event => {event.preventDefault(); send();}}>
  <textarea ref={input} aria-label={`Message to ${agent.title}`} placeholder={agent.parentId ? 'Follow up…' : 'Message…'} rows={2} value={state.draft} disabled={!state.ready} onFocus={() => controller.setView(agent.agentId, {focus: 'composer'})} onChange={event => {void composers.edit(agent, event.target.value);}} onKeyDown={event => {if(commands.current?.keyDown(event))return;if (isComposing(event) || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return; if (event.key === 'Enter') {event.preventDefault(); send();}}}/>
  {!agent.parentId&&<><ComposerSkillBindings bindings={state.skills??[]} onRemove={id=>{void composers.removeSkill(agent,id).catch(()=>{});}}/><ComposerCommands ref={commands} input={input} draft={state.draft} threadId={agent.threadId??undefined} projectId={agent.projectId??undefined} disabled={!state.ready||state.busy||state.stopping} onDraft={text=>{void composers.edit(agent,text);}} onSkill={binding=>composers.addSkill(agent,binding)} onModel={()=>{if(agent.threadId)onOpenConversation(agent.threadId,'model');}} onMode={async mode=>{if(agent.status==='working')throw Error('Wait for the active run to finish to change mode.');if(agent.threadId)await command('thread.mode',{mode},agent.threadId);}}/></>}
  <div className="agents-composer-actions"><span role="status">{state.ticket ? `${state.ticket.status.replaceAll('_', ' ')}${state.ticket.error ? ': ' + state.ticket.error : ''}` : state.busy ? 'Sending…' : ''}</span>
   {!agent.parentId && agent.status === 'working' && <button type="button" aria-label={`Stop ${agent.title}`} disabled={state.stopping} onClick={() => {void composers.stop(agent);}}><Square size={13}/>{state.stopping ? 'Stopping…' : 'Stop'}</button>}
   <button type="submit" aria-label={`${state.retry ? 'Retry send to' : 'Send to'} ${agent.title}`} disabled={!composers.canSend(agent) || !state.retry && !state.draft.trim()}><Send size={14}/>{state.retry ? 'Retry send' : 'Send'}</button>
  </div>
  {!agent.parentId && !agent.modelId && <p className="agents-readonly">Choose a model in this conversation to send.</p>}
  {state.error && <p className="agents-error" role="alert">{state.error}</p>}
 </ComposerView>;
}
