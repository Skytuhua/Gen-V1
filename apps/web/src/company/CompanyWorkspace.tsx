import './validation-policy';
import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowLeft, ArrowUpRight, BriefcaseBusiness, ChevronRight, CircleAlert, FileCheck2, Layers3, ListFilter, MessageSquare, NotebookPen, PanelRight, RefreshCw, Search, ShieldCheck, Users, Wallet, Waypoints} from 'lucide-react';
import {journalRead, journalWrite} from '../journal';
import {getCompanyConnection, getCompanyStatus, isCompanyAccessDenied, type CompanyConnection, type CompanyObservation, type CompanyProject, type CompanySnapshot, type CompanyStatus} from './api';
import {COMPANY_VIEWS, companyBlockers, companyCount, companyMarketing, companyRecordLabel, projectTaskTotal, recoverCompanySelection, sourceTime, stateLabel, taskCounts, type CompanySelection, type CompanyView} from './presentation';
import './company.css';
import {ManagerPanel} from './ManagerPanel';
import {ContextDossier} from './ContextDossier';
import {CommunicationWorkspace} from './CommunicationWorkspace';
import {CompanyTaskPanel} from './CompanyTaskPanel';
import {CompanyTaskSurface, useCompanyTaskSurface} from './CompanyTaskSurface';
import {parseDesktopSurface, desktopSurfaceKey, type DesktopBridge, type DesktopContext} from '../../../../packages/desktop-contract';
import type {ApprovedJobRead} from '../../../../packages/company-contracts/approved-job-read';
import {DetachedCompanyTask} from './DetachedCompanyTask';
import {companyTaskSurface, flushCompanyTaskHandoff, resolveCompanyTaskSurface, type CompanyTaskDesktopSurface} from './company-task-desktop';

const selectionKey = 'company:leo-company:workspace:v1';
const notesKey = 'company:leo-company:owner-notes:v1';
const views = [
  {id: 'manager', label: 'Company manager', icon: MessageSquare},
  {id: 'portfolio', label: 'Projects', icon: Layers3}, {id: 'people', label: 'People', icon: Users},
  {id: 'communications', label: 'Communications', icon: NotebookPen},
  {id: 'plan', label: 'Plan', icon: NotebookPen},
  {id: 'review', label: 'Review desk', icon: FileCheck2}, {id: 'campaigns', label: 'Campaigns', icon: Waypoints},
  {id: 'budget', label: 'Budget & access', icon: Wallet}, {id: 'exceptions', label: 'Needs attention', icon: CircleAlert},
  {id: 'source', label: 'Source inspector', icon: ShieldCheck},
] as const;
const message = (error: unknown) => error instanceof Error ? error.message : 'The company service could not be reached. Try refreshing.';
function entryView(): CompanyView {
  const route = location.pathname.slice('/company/'.length);
  return route === 'projects' ? 'portfolio' : COMPANY_VIEWS.includes(route as CompanyView) ? route as CompanyView : 'manager';
}

function Empty({title, children}: {title: string; children: ReactNode}) {
  return <div className="company-empty"><h3>{title}</h3><p>{children}</p></div>;
}
function Section({title, detail, children}: {title: string; detail?: string; children: ReactNode}) {
  return <section className="company-section"><div className="company-section-heading"><h3>{title}</h3>{detail && <span>{detail}</span>}</div>{children}</section>;
}
function ValueList({rows}: {rows: {label: string; value: ReactNode}[]}) {
  return <dl className="company-values">{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>;
}
function State({value}: {value: string}) {return <span className="company-state">{stateLabel(value)}</span>;}
function Observation({title, value}: {title: string; value: CompanyObservation | undefined}) {
  return <Section title={title} detail="Trusted observation"><ValueList rows={[
    {label: 'Status', value: stateLabel(value?.status)}, {label: 'Evidence', value: stateLabel(value?.evidence_scope)},
    {label: 'Observed', value: sourceTime(value?.observed_at)}, {label: 'Expires', value: sourceTime(value?.expires_at)},
  ]}/></Section>;
}
function ProjectList({projects, open}: {projects: CompanyProject[]; open: (id: string) => void}) {
  if (!projects.length) return <Empty title="No projects returned">The service has not returned any projects in this owner scope. No sample projects are shown.</Empty>;
  return <div className="company-table-wrap"><table className="company-table"><caption className="sr-only">Projects returned by the company service</caption><thead><tr><th>Project</th><th>State</th><th>Tasks</th><th>Scheduler</th><th><span className="sr-only">Open project</span></th></tr></thead><tbody>{projects.map(project => <tr key={project.id}><td><button className="company-record-button" onClick={() => open(project.id)}>{project.name}<ChevronRight size={14}/></button><small className="company-id">{project.id}</small></td><td><State value={project.state}/></td><td className="company-number">{projectTaskTotal(project)}</td><td>{project.scheduler_paused ? 'Paused' : 'Not paused'}</td><td><button className="company-open" aria-label={`Focus ${project.name}`} onClick={() => open(project.id)}><ArrowUpRight size={16}/></button></td></tr>)}</tbody></table></div>;
}
function Portfolio({status, projects, project, open}: {status: CompanyStatus; projects: CompanyProject[]; project: CompanyProject | undefined; open: (id: string) => void}) {
  return <>
    <div className="company-introduction"><p>Your projects and the work approved for them.</p></div>
    {project ? <Section title={project.name}><ValueList rows={[
      {label: 'Project state', value: stateLabel(project.state)}, {label: 'Scheduling', value: project.scheduler_paused ? 'Paused' : 'Not paused'},
    ]}/><div className="company-task-counts" aria-label="Task counts by state">{taskCounts(project).length ? taskCounts(project).map(item => <div key={item.state}><span>{stateLabel(item.state)}</span><strong>{companyCount(item.count)}</strong></div>) : <p>Task activity is unavailable.</p>}</div><details className="company-record-details"><summary>Project details</summary><ValueList rows={[{label: 'Project ID', value: project.id}, {label: 'Simulated occupied slots', value: companyCount(project.occupied_synthetic_slots)}]}/></details></Section> : <Section title="Projects"><ProjectList projects={projects} open={open}/></Section>}
    <Section title="Team setup"><p className="company-description">Planned roles and test checks do not show employees working.</p><details className="company-source-details"><summary>Team configuration and test evidence</summary><div className="company-table-wrap"><table className="company-table"><caption className="sr-only">Target employees compared with service-reported actual live employees</caption><thead><tr><th>Runtime</th><th>Planned</th><th>Reported live</th></tr></thead><tbody>{(['hermes', 'codex'] as const).map(runtime => <tr key={runtime}><th scope="row">{runtime === 'hermes' ? 'Hermes' : 'Codex'}</th><td className="company-number">{companyCount(status.targets?.[runtime])}</td><td className="company-number">{companyCount(status.actual_live?.[runtime])}</td></tr>)}<tr className="company-total"><th scope="row">All employees</th><td className="company-number">{companyCount(status.targets?.employees)}</td><td className="company-number">{companyCount(status.actual_live?.employees)}</td></tr></tbody></table></div><p className="company-footnote">{companyCount(status.targets?.departments)} planned departments. {companyRecordLabel(status.evidence_scope)}.</p></details></Section>
  </>;
}
function People({status, filter}: {status: CompanyStatus; filter: string}) {
  const employees = status.employees.filter(employee => `${employee.id} ${employee.department} ${employee.target_runtime} ${employee.required_model}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <><p className="company-description">Permanent employee profiles. Required configuration and reported effective configuration remain separate.</p>{employees.length ? <div className="company-table-wrap"><table className="company-table"><caption className="sr-only">Company employee profiles</caption><thead><tr><th>Employee / department</th><th>Runtime</th><th>Model / reasoning</th><th>Qualification</th></tr></thead><tbody>{employees.map(employee => <tr key={employee.id}><th scope="row">{employee.id}<small className="company-id">{employee.department}</small></th><td><span>{stateLabel(employee.target_runtime)} required</span><small className="company-id">{employee.effective_runtime ? `${employee.effective_runtime} effective` : 'Effective runtime unavailable'}</small></td><td><span>{employee.required_model}</span><small className="company-id">{employee.required_reasoning} required</small><small className="company-id">{employee.effective_model ?? 'Effective model unavailable'}</small></td><td><State value={employee.state}/><details className="company-record-details"><summary>Profile evidence</summary><ValueList rows={[
    {label: 'Profile version', value: employee.configured_profile_version}, {label: 'Synthetic admission', value: employee.synthetic_admission?.present ? employee.synthetic_admission.expired ? 'Expired · synthetic only' : 'Present · synthetic only' : 'Unavailable'},
    {label: 'Playbooks', value: employee.playbooks?.active ? 'Reported active' : 'Inactive pending evaluation'}, {label: 'Profile digest', value: employee.configured_profile_digest},
  ]}/></details></td></tr>)}</tbody></table></div> : <Empty title={filter ? 'No matching employees' : 'No employee profiles returned'}>{filter ? 'Try an employee ID, department, runtime or model.' : 'The roster will appear when the owner service supplies it.'}</Empty>}</>;
}
function Campaigns({projects, filter}: {projects: CompanyProject[]; filter: string}) {
  const records = projects.map(project => ({...project, marketing: companyMarketing(project)}));
  const campaigns = records.flatMap(project => project.marketing.campaigns.map(campaign => ({project, campaign}))).filter(({campaign, project}) => `${campaign.id} ${campaign.goal ?? ''} ${project.name}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  return <><p className="company-description">Local draft records from the owner service. Connected accounts, external schedules and publication receipts are unavailable.</p>{campaigns.length ? <div className="company-table-wrap"><table className="company-table"><caption className="sr-only">Campaign draft records</caption><thead><tr><th>Campaign</th><th>Project</th><th>State</th><th>Production approval</th></tr></thead><tbody>{campaigns.map(({campaign, project}) => <tr key={`${project.id}:${campaign.id}`}><td><strong>{campaign.goal ?? campaign.id}</strong><small className="company-id">{campaign.id}</small>{campaign.audience && <small className="company-id">{campaign.audience}</small>}</td><td>{project.name}</td><td><State value={campaign.state}/></td><td>{stateLabel(campaign.production_approval?.status)}</td></tr>)}</tbody></table></div> : <Empty title={filter ? 'No matching campaigns' : 'No campaign drafts returned'}>{filter ? 'Try a campaign ID, goal or project name.' : 'Campaigns will appear here when they exist in the company service. No campaigns are created by this view.'}</Empty>}
    {records.some(project => project.marketing.unavailable) && <p className="company-footnote">Marketing details are unavailable for one or more projects. This view does not treat missing or incompatible records as an empty campaign ledger.</p>}
    {records.some(project => project.marketing.truncated) && <p className="company-footnote">The service reports a truncated marketing result. This is a partial view.</p>}
    {records.some(project => project.marketing.content_queue.length) && <Section title="Content review queue" detail="Draft metadata only"><div className="company-table-wrap"><table className="company-table"><thead><tr><th>Content</th><th>Channel</th><th>Revision</th><th>Approval</th></tr></thead><tbody>{records.flatMap(project => project.marketing.content_queue.map(content => <tr key={`${project.id}:${content.content_id}`}><td>{content.content_id}<small className="company-id">{project.name}</small></td><td>{content.channel}</td><td>{companyCount(content.revision)}</td><td>{stateLabel(content.approval_state)}</td></tr>))}</tbody></table></div><p className="company-footnote">HTML previews are not loaded by the status view.</p></Section>}
  </>;
}
function ReviewDesk({connection}: {connection: CompanyConnection | undefined}) {
  return <><p className="company-description">Inspect evidence before making a decision. A status snapshot is not an execution receipt or company acceptance.</p><Section title="Evidence available"><ValueList rows={[
    {label: 'Company and project status', value: connection?.capabilities.status ? 'Read-only status snapshots' : 'Unavailable'},
    {label: 'Artifact preview', value: 'Unavailable · no artifact reference supplied by this status view'},
    {label: 'Review package', value: 'Unavailable · no work order reference supplied by this status view'},
    {label: 'Approval and publication', value: 'Unavailable in this read-only connection'},
  ]}/></Section><Empty title="No review package loaded">Individual evidence, work orders and review decisions need their own verified service references. Company status does not supply a task DAG, memory search or event timeline.</Empty></>;
}

export function CompanyWorkspace() {
  const bridge = window.harnessDesktop;
  const [context, setContext] = useState<DesktopContext>(), [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const unsubscribe = bridge.onState?.(state => setContext(current => current ? {...state, windowId: current.windowId, surface: current.surface} : current));
    void (async () => bridge.getContext())().then(value => {
      const surface = parseDesktopSurface(value.surface);
      if (surface.kind !== 'main' && surface.kind !== 'company-task') throw Error('Unsupported company surface');
      if (alive) setContext({...value, surface});
    }).catch(() => {if (alive) setFailed(true);});
    return () => {alive = false; unsubscribe?.();};
  }, [bridge]);
  if (bridge && !context) return <main className="company-workspace company-detached-task"><p role="status">{failed ? 'This company window could not be verified. Reopen it from the company workspace.' : 'Opening the company window…'}</p></main>;
  if (bridge && context?.surface.kind === 'company-task') return <DetachedCompanyTask bridge={bridge} context={context}/>;
  return <CompanyWorkspaceMain desktop={bridge && context ? {bridge, context} : undefined}/>;
}

function CompanyWorkspaceMain({desktop}: {desktop?: {bridge: DesktopBridge; context: DesktopContext}}) {
  const [selection, setSelection] = useState<CompanySelection>({view: 'manager', projectId: '', filter: ''});
  const [managerRecovered, setManagerRecovered] = useState(false);
  const taskSurface = useCompanyTaskSurface(selection.projectId), taskOpener = useRef<HTMLButtonElement>(null);
  const taskPanelOpen = taskSurface.ready && taskSurface.state.open;
  const [taskBinding, setTaskBinding] = useState<ApprovedJobRead>(), [movingTask, setMovingTask] = useState(false), [taskMoveError, setTaskMoveError] = useState('');
  const [dockTarget, setDockTarget] = useState<CompanyTaskDesktopSurface>();
  const taskBindingChanged = useCallback((binding: ApprovedJobRead | undefined) => setTaskBinding(binding), []);
  const taskIdentity = taskBinding?.projectId === selection.projectId ? companyTaskSurface(taskBinding) : undefined;
  const detachedTask = taskIdentity && desktop?.context.windows.find(item => item.id !== desktop.context.windowId && item.ready && desktopSurfaceKey(item.surface) === desktopSurfaceKey(taskIdentity));
  const [notes, setNotes] = useState(''), [notesStatus, setNotesStatus] = useState('Recovering local notes…');
  const [notesReady, setNotesReady] = useState(false);
  const [ready, setReady] = useState(false), [connection, setConnection] = useState<CompanyConnection>();
  const [notesRecovered, setNotesRecovered] = useState(false), [communicationsRecovered, setCommunicationsRecovered] = useState(false);
  const [snapshot, setSnapshot] = useState<CompanySnapshot>(), [focused, setFocused] = useState<CompanySnapshot>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [journalError, setJournalError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const request = useRef(0), controller = useRef<AbortController | undefined>(undefined), noteVersion = useRef(0), returnVersion = useRef(0);
  useEffect(() => {
    let alive = true;
    void journalRead(selectionKey).then(value => {
      if (alive) setSelection({...recoverCompanySelection(value), view: entryView()});
    }).catch(() => {if (alive) {setSelection({...recoverCompanySelection(undefined), view: entryView()}); setJournalError('View selection could not be recovered. The current view is shown.');}}).finally(() => {if (alive) setReady(true);});
    void journalRead<string>(notesKey).then(value => {
      if (!alive) return;
      setNotes(typeof value === 'string' ? value : ''); setNotesStatus('Saved on this device'); setNotesReady(true);
    }).catch(() => {if (alive) setNotesStatus('Notes recovery unavailable · reload to retry');}).finally(() => {if (alive) setNotesRecovered(true);});
    return () => {alive = false;};
  }, []);
  // The isolated company entry does not mount personal DesktopProvider/layout.
  // Register close custody first; saved work must settle before native close.
  useEffect(() => window.harnessDesktop?.onCloseRequested(async () => {
    try {await flushCompanyTaskHandoff(); return true;}
    catch {setJournalError('Saved work could not be flushed. Keep this window open and retry closing after saving.'); return false;}
  }), []);
  useEffect(() => {
    if (ready && notesRecovered && (selection.view !== 'communications' || communicationsRecovered) && (selection.view !== 'manager' || managerRecovered && taskSurface.recovered)) void window.harnessDesktop?.ready().catch(() => setJournalError('The company window could not confirm readiness. Your saved work remains on this device.'));
  }, [ready, notesRecovered, selection.view, communicationsRecovered, managerRecovered, taskSurface.recovered]);
  const recoverCommunications = useCallback(() => setCommunicationsRecovered(true), []);
  const recoverManager = useCallback(() => setManagerRecovered(true), []);
  const invalidateAccess = useCallback((cause: Error) => {
    controller.current?.abort(); request.current++;
    setSnapshot(undefined); setFocused(undefined); setConnection(undefined);
    setBusy(false); setError(message(cause));
  }, []);
  const refresh = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const generation = ++request.current; setBusy(true); setError('');
    try {
      const current = await getCompanyConnection(abort.signal);
      if (generation !== request.current || abort.signal.aborted) return;
      setConnection(current);
      if (!current.configured || !current.capabilities.status) {setError('Company records are not connected. Check the company connection and refresh.'); return;}
      const all = await getCompanyStatus({kind: 'company', id: 'leo-company'}, abort.signal);
      if (generation !== request.current || abort.signal.aborted) return;
      setSnapshot(all); setConnection({...current, ownerAuthenticated: true});
      const project = selection.projectId ? await getCompanyStatus({kind: 'project', id: selection.projectId}, abort.signal) : undefined;
      if (generation !== request.current || abort.signal.aborted) return;
      setFocused(project);
    } catch (cause) {
      if (generation !== request.current || abort.signal.aborted) return;
      if (isCompanyAccessDenied(cause)) {invalidateAccess(cause); return;}
      setError(message(cause)); setConnection(value => value ? {...value, ownerAuthenticated: false} : value);
    } finally {if (generation === request.current && !abort.signal.aborted) setBusy(false);}
  }, [selection.projectId, invalidateAccess]);
  useEffect(() => {
    if (!ready) return;
    void refresh(); const reconnect = () => {setOnline(true); void refresh();};
    const disconnect = () => {setOnline(false); controller.current?.abort(); request.current++; setBusy(false);};
    window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect);
    return () => {window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect); controller.current?.abort();};
  }, [ready, refresh]);
  const choose = (patch: Partial<CompanySelection>) => {
    returnVersion.current++;
    const next = {...selection, ...patch}; setSelection(next);
    if (patch.view && !window.harnessDesktop) {const url = new URL(location.href); url.pathname = next.view === 'manager' ? '/company' : `/company/${next.view === 'portfolio' ? 'projects' : next.view}`; history.replaceState(history.state, '', url);}
    void journalWrite(selectionKey, next).catch(() => setJournalError('View selection could not be saved locally.'));
  };
  useEffect(() => {
    const surface = desktop?.context.focusSurface;
    if (surface?.kind !== 'company-task') return;
    const version = ++returnVersion.current;
    void resolveCompanyTaskSurface(surface).then(({binding}) => {
      if (version !== returnVersion.current) return;
      setTaskBinding(binding); setDockTarget(companyTaskSurface(binding)); choose({view: 'manager', projectId: binding.projectId});
    }).catch(() => setTaskMoveError('The returned task could not be verified with the current company connection.'));
  }, [desktop?.context.focusSurface]);
  useEffect(() => () => {returnVersion.current++;}, []);
  useEffect(() => {
    if (dockTarget?.projectId === selection.projectId && taskSurface.ready) {taskSurface.update({open: true, placement: 'docked'}); setDockTarget(undefined);}
  }, [dockTarget, selection.projectId, taskSurface.ready]);
  const detachTask = () => {
    if (!desktop || !taskIdentity || movingTask) return;
    const requested = taskIdentity; setMovingTask(true); setTaskMoveError('');
    void flushCompanyTaskHandoff().then(() => desktop.bridge.detach(requested)).then(info => {
      if (desktopSurfaceKey(info.surface) !== desktopSurfaceKey(requested) || !info.ready) throw Error('Task window was not ready');
    }).catch(() => setTaskMoveError('The task could not move yet. Wait for its read or save to finish, then try again.')).finally(() => setMovingTask(false));
  };
  const editNotes = (value: string) => {
    setNotes(value); setNotesStatus('Saving locally…'); const version = ++noteVersion.current;
    void journalWrite(notesKey, value).then(() => {if (version === noteVersion.current) setNotesStatus('Saved on this device');}).catch(() => {if (version === noteVersion.current) setNotesStatus('Save failed · keep this window open');});
  };
  const status = snapshot?.data, source = selection.projectId ? focused?.data.project?.id === selection.projectId ? focused : undefined : snapshot;
  const projects = status?.projects ?? [], project = focused?.data.project?.id === selection.projectId ? focused.data.project : undefined;
  const visibleProjects = projects.filter(item => `${item.name} ${item.id} ${item.state}`.toLocaleLowerCase().includes(selection.filter.toLocaleLowerCase()));
  const scopedProjects = selection.projectId ? project ? [project] : [] : projects;
  const scopedMarketing = scopedProjects.map(item => ({...item, marketing: companyMarketing(item)}));
  const blockers = companyBlockers(status, connection?.blockers ?? []);
  const view = views.find(item => item.id === selection.view)!;
  const connected = Boolean(online && connection?.configured && connection.ownerAuthenticated && !busy && !error);
  const managerView = selection.view === 'manager';
  const filterable = ['portfolio', 'people', 'campaigns'].includes(selection.view);
  return <div className="company-workspace">
    <a className="company-skip" href="#company-content">Skip to company content</a>
    <aside className="company-sidebar" aria-label="Company workspace navigation">
      <div className="company-brand"><span className="company-brand-mark"><BriefcaseBusiness size={19}/></span><div><strong>Gen V1</strong><span>Company workspace</span></div></div>
      <nav aria-label="Company views">{views.filter(item => ['manager', 'portfolio', 'people'].includes(item.id)).map(item => <button key={item.id} className={item.id === selection.view ? 'is-selected' : ''} aria-current={item.id === selection.view ? 'page' : undefined} disabled={!ready} onClick={() => choose({view: item.id})}><item.icon size={16}/><span>{item.label}</span></button>)}
        <details className="company-more" open={!['manager', 'portfolio', 'people'].includes(selection.view) || undefined}><summary>More tools</summary>{views.filter(item => !['manager', 'portfolio', 'people'].includes(item.id)).map(item => <button key={item.id} className={item.id === selection.view ? 'is-selected' : ''} aria-current={item.id === selection.view ? 'page' : undefined} disabled={!ready} onClick={() => choose({view: item.id})}><item.icon size={16}/><span>{item.label}</span></button>)}</details>
      </nav>
      <div className="company-project-threads"><h2>Project conversations</h2>{projects.length ? projects.map(item => <button key={item.id} className={managerView && selection.projectId === item.id ? 'is-selected' : ''} disabled={!ready} onClick={() => choose({view: 'manager', projectId: item.id})}><MessageSquare size={14}/><span>{item.name}</span></button>) : <p>{busy ? 'Reading projects…' : 'Choose a project when records are available.'}</p>}</div>
      <div className="company-sidebar-bottom"><span className="company-readonly"><ShieldCheck size={14}/>Company workspace</span><p>Company access is separate from your personal workspace.</p></div>
    </aside>
    <main className="company-main" id="company-content" tabIndex={-1}>
      <header className="company-topbar"><div className="company-breadcrumb"><span>{project?.name ?? 'Company workspace'}</span><ChevronRight size={13}/><span>{view.label}</span></div><div className="company-connection" role="status"><span className={connected ? 'company-dot is-connected' : 'company-dot'}/>{!online ? 'Offline · saved records' : busy ? 'Checking records…' : connected ? 'Company records connected' : 'Company records unavailable'}</div></header>
      <div className={managerView ? `company-manager-layout${taskPanelOpen && taskSurface.state.placement === 'docked' ? ' has-work-panel' : ''}` : ''}><div className={managerView ? 'company-content company-home-content' : 'company-content'}>
        {!managerView && <>
        <div className="company-page-heading"><div><h1>{view.label}</h1><p>{selection.view === 'communications' ? 'Project rooms, linked task threads and addressed inboxes.' : selection.projectId ? project?.name ?? selection.projectId : 'Company overview'}</p></div><button className="company-refresh" disabled={busy || !ready} onClick={() => void refresh()}><RefreshCw size={15} className={busy ? 'company-refreshing' : ''}/>{busy ? 'Refreshing…' : 'Refresh status'}</button></div>
        <section className="company-trust-strip" aria-label="Company setup"><span><ShieldCheck size={14}/>Employee setup is not verified</span><span>{companyRecordLabel(status?.evidence_scope)}</span></section>
        {selection.view !== 'communications' && <div className="company-freshness"><span>{source ? <>Received <time dateTime={source.receivedAt}>{sourceTime(source.receivedAt)}</time>{error && ' · previous snapshot'}</> : 'No status received'}</span><span>Explicit refresh · no event stream</span></div>}
        </>}
        {error && (selection.view === 'communications' ? <p className="company-footnote" role="status">Company records could not be refreshed. Communication records use the separate source shown below.</p> : <div className="company-alert" role="alert"><CircleAlert size={17}/><div><strong>Company records could not be refreshed</strong><p>Check the connection, then try again. Your local drafts are kept.</p><details><summary>Details</summary><p>{error}</p></details>{snapshot && <p>The previous snapshot remains visible. It does not establish current readiness.</p>}</div></div>)}
        {journalError && <p className="company-local-error" role="alert">{journalError}</p>}
        {managerView && taskSurface.error && <p className="company-local-error" role="alert">{taskSurface.error}</p>}
        {managerView && taskMoveError && <p className="company-local-error" role="alert">{taskMoveError}</p>}
        {selection.view !== 'communications' && <div className="company-toolbar"><label className="company-project-select"><ListFilter size={15}/>{managerView && <span>Project</span>}<select aria-label="Project scope" value={selection.projectId} disabled={!ready} onChange={event => choose({projectId: event.target.value})}><option value="">{managerView ? 'Choose a project' : 'All projects'}</option>{selection.projectId && !projects.some(item => item.id === selection.projectId) && <option value={selection.projectId}>Saved project · records unavailable</option>}{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{managerView ? <div className="company-home-tools"><button className="company-refresh" disabled={busy || !ready} onClick={() => void refresh()} aria-label="Refresh company records"><RefreshCw size={15} className={busy ? 'company-refreshing' : ''}/><span>Refresh</span></button><button ref={taskOpener} className="company-refresh" disabled={!taskSurface.ready} aria-expanded={taskPanelOpen} aria-controls="company-task-panel" onClick={() => taskSurface.update({open: !taskPanelOpen})}><PanelRight size={15}/>Task & plan</button></div> : filterable && <label className="company-search"><Search size={15}/><span className="sr-only">Filter company records</span><input aria-label="Filter company records" value={selection.filter} disabled={!ready} maxLength={200} placeholder={selection.view === 'people' ? 'Find an employee or department' : selection.view === 'campaigns' ? 'Find a campaign' : 'Find a project'} onChange={event => choose({filter: event.target.value})}/></label>}</div>}
        <div className="company-view" aria-busy={busy}>
          {managerView ? ready && <ManagerPanel projectId={selection.projectId || null} experience="conversation" onRecovered={recoverManager} onAccessDenied={invalidateAccess}/> : selection.view === 'communications' ? <CommunicationWorkspace onRecovered={recoverCommunications}/> : !status ? <Empty title={busy ? 'Reading company records' : 'Company records unavailable'}>{busy ? 'Waiting for the company connection.' : 'Check the company connection, then refresh to see your projects and team.'}</Empty> : <>
            {selection.projectId && !project && <Empty title="Focused project unavailable">{busy ? 'Reading the selected project scope.' : 'This project has not returned a status snapshot. Choose another project or retry the refresh.'}</Empty>}
            {selection.view === 'portfolio' && (!selection.projectId || project) && <><Portfolio status={status} projects={visibleProjects} project={project} open={id => choose({projectId: id})}/><ContextDossier key={project?.id ?? 'none'} projectId={project?.id ?? null} onAccessDenied={invalidateAccess}/></>}
            {selection.view === 'people' && <People status={status} filter={selection.filter}/>}
            {selection.view === 'plan' && <ManagerPanel key={selection.projectId || 'no-project'} projectId={project?.id ?? null} planningAllowed={connected} onAccessDenied={invalidateAccess}/>}
            {selection.view === 'review' && <ReviewDesk connection={connection}/>}
            {selection.view === 'campaigns' && <Campaigns projects={scopedProjects} filter={selection.filter}/>}
            {selection.view === 'budget' && <><p className="company-description">Observation metadata only. Status does not expose a spending ledger, employee spend or fresh account entitlement proof.</p><Observation title="Budget observation" value={status.budget}/><Observation title="Authentication observation" value={status.auth}/><Empty title="Detailed budget ledger unavailable">No project budget amounts, reservations or cost entries are supplied by this status interface.</Empty></>}
            {selection.view === 'exceptions' && <><p className="company-description">Service blockers describe remaining gates. This view does not acknowledge or clear them.</p>{blockers.length ? <ul className="company-blockers">{blockers.map(blocker => <li key={blocker}><CircleAlert size={15}/><div><span>{stateLabel(blocker)}</span><code>{blocker}</code></div></li>)}</ul> : <Empty title="No blockers returned">An empty blocker list does not establish company acceptance. Check the source’s acceptance and readiness fields.</Empty>}{scopedMarketing.some(item => item.marketing.exceptions.length) && <Section title="Campaign exceptions"><ul className="company-blockers">{scopedMarketing.flatMap(item => item.marketing.exceptions.map((exception, index) => <li key={`${item.id}:${exception.campaign_id}:${index}`}><CircleAlert size={15}/><div><span>{stateLabel(exception.state)}</span><small>{item.name} · {exception.campaign_id}</small></div></li>))}</ul></Section>}</>}
            {selection.view === 'source' && <><p className="company-description">The company service is the source of the records shown here. Local notes remain separate from company state.</p><Section title="Source receipt"><ValueList rows={[
              {label: 'Source', value: source?.source ?? 'Unavailable'}, {label: 'Protocol', value: connection?.protocol ?? 'Unavailable'}, {label: 'Pinned contract baseline', value: connection?.serviceBaseline ?? 'Unavailable'},
              {label: 'Pinned backend checkpoint', value: connection?.backendCheckpoint ?? 'Unavailable'}, {label: 'Pinned manifest SHA-256', value: connection?.manifestSHA256 ?? 'Unavailable'},
              {label: 'Received', value: sourceTime(source?.receivedAt)}, {label: 'Requested scope', value: selection.projectId || 'leo-company'},
              {label: 'Company configuration digest', value: status.configured_company_digest}, {label: 'Runtime requirements digest', value: status.configured_requirements_digest},
            ]}/></Section><details className="company-source-details"><summary>Inspect raw status response</summary><p>Untrusted source fields, rendered as text. No links, scripts or previews are loaded.</p><pre>{JSON.stringify(source ?? snapshot, null, 2)}</pre></details></>}
          </>}
        </div>
        {!managerView && selection.projectId && <button className="company-back" onClick={() => choose({projectId: ''})}><ArrowLeft size={14}/>Back to all projects</button>}
        {!managerView && <details className="company-secondary-details"><summary>Execution controls</summary><section className="company-operator-controls" aria-label="Execution controls"><div><h3>Execution controls</h3><p>Pause, cancel and emergency stop are unavailable in this connection.</p></div><div><button disabled title="Pause is not exposed by this connection">Pause</button><button disabled title="Cancel is not exposed by this connection">Cancel</button><button disabled title="Emergency stop is not exposed by this connection">Emergency stop</button></div></section></details>}
        <details className="company-secondary-details" open={!managerView || undefined}><summary>Owner notes</summary><section className="company-notes" aria-labelledby="company-notes-heading"><div><NotebookPen size={16}/><h3 id="company-notes-heading">Owner notes</h3><span role="status">{notesStatus}</span></div><label className="sr-only" htmlFor="company-owner-notes">Owner notes</label><textarea id="company-owner-notes" value={notes} disabled={!notesReady} maxLength={32000} rows={3} placeholder="Keep questions and review notes here…" onChange={event => editNotes(event.target.value)}/><p>Saved on this device. These notes do not approve work or change company records.</p></section></details>
      </div><CompanyTaskSurface key={selection.projectId} projectId={selection.projectId} open={managerView && taskPanelOpen} placement={taskSurface.state.placement} onClose={() => taskSurface.update({open: false})} onPlacement={placement => taskSurface.update({placement})} opener={taskOpener} native={desktop ? {detached: detachedTask || undefined, pending: movingTask, canDetach: Boolean(taskIdentity), detach: detachTask, focus: () => {if (detachedTask) void desktop.bridge.focus(detachedTask.id).catch(() => setTaskMoveError('The task window could not be focused.'));}} : undefined}><CompanyTaskPanel projectId={project?.id ?? null} projectName={project?.name} onAccessDenied={invalidateAccess} onBinding={taskBindingChanged}/></CompanyTaskSurface></div>
    </main>
  </div>;
}
