import {useEffect, useRef, useState} from 'react';
import {ApiError} from '../api';
import {isCompanyAccessDenied} from './api';
import type {ContextArtifact, ContextAttempt, ContextPage, ContextRef, ContextReview, ProjectContextResponse, TaskContextResponse, TaskContextSection} from '../../../../packages/company-contracts/manager';
import {getContextAvailability, getProjectContext, getTaskContext, type ContextAvailability, type ContextSnapshot} from './context-api';
import './context-dossier.css';

const limit = 20;
const sections: TaskContextSection[] = ['dependencies', 'attempts', 'artifacts', 'reviews'];
function observationTime(seconds: number | null) {
  if (seconds === null) return 'Unavailable';
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : `${seconds} seconds (outside calendar range)`;
}
function Reference({value}: {value: ContextRef}) {
  return <details className="company-context-reference"><summary>{value.type}: {value.id}</summary><dl className="company-values">
    <div><dt>Project scope</dt><dd>{value.scope.id}</dd></div>
    <div><dt>Observation</dt><dd>{value.observation.status} · {value.observation.source} · {value.observation.evidence_scope}</dd></div>
    <div><dt>Observed at</dt><dd>{observationTime(value.observation.observed_at)}</dd></div>
    <div><dt>Live verification</dt><dd>Unavailable</dd></div>
    {Object.entries(value.digests).map(([name, digest]) => <div key={name}><dt>{name} digest</dt><dd>{digest.status === 'available' ? digest.value : 'Unavailable'}</dd></div>)}
  </dl></details>;
}
function PageNote({page}: {page: ContextPage}) {
  return <div className="company-context-page"><p>{page.returned_count} records on this page · {page.truncated ? 'Incomplete result' : 'End of result'} · {page.boundary.replaceAll('_', ' ')}</p><details><summary>Snapshot and page evidence</summary><p>Snapshot: <code>{page.snapshot_digest}</code></p><p>{page.snapshot_status}</p><Reference value={page.entity}/></details></div>;
}
function SectionItems({value, inspect}: {value: TaskContextResponse; inspect: (reference: ContextRef<'task'>) => void}) {
  if (value.section === 'dependencies') return <section className="company-context-dependencies" aria-label="Direct task dependencies">
    <p><strong>{value.task_id}</strong> depends on{value.items.length ? ':' : ' no prerequisites returned on this page.'}</p>
    <p className="company-footnote">Direct prerequisites on this page only. Critical path unavailable.</p>
    <ul className="company-context-records">{value.items.map(dependency => <li key={dependency.entity.id}>
      <span className="company-context-dependency-arrow" aria-hidden="true">→</span><div><Reference value={dependency.entity}/>
        <p>State: {dependency.state}</p><p>Expected target digest: {dependency.expected_target_digest.status === 'available' ? dependency.expected_target_digest.value : 'Unavailable'}</p>
        <button type="button" className="company-refresh" onClick={() => inspect(dependency.entity)}>Inspect prerequisite {dependency.entity.id}</button>
      </div>
    </li>)}</ul>
  </section>;
  if (value.items.length === 0) return <p>No {value.section} returned on this page. Completion or acceptance is not inferred.</p>;
  return <ul className="company-context-records">{value.items.map(item => <li key={item.entity.id}>
    <Reference value={item.entity}/>
    {value.section === 'attempts' && (() => {const attempt = item as ContextAttempt; return <><p>State: {attempt.state} · Machine generation: {attempt.generation}</p><Reference value={attempt.task}/><Reference value={attempt.employee}/><Reference value={attempt.machine}/></>;})()}
    {value.section === 'artifacts' && (() => {const artifact = item as ContextArtifact; return <><p>{artifact.filename} · {artifact.media_type} · {artifact.size_bytes} bytes · Private</p><p>Producer origin: {artifact.origin === 'control_service' ? 'Company control service' : 'Employee attempt'}</p>{artifact.origin === 'control_service' ? <><Reference value={artifact.producer}/><p>Employee, task and attempt attribution: none</p><p>Derivation digest: {artifact.derivation_digest.value}</p></> : <><Reference value={artifact.task}/><Reference value={artifact.attempt}/><Reference value={artifact.employee}/><Reference value={artifact.machine}/><p>Machine generation: {artifact.generation}</p></>}<p>Media verification and download: unavailable</p></>;})()}
    {value.section === 'reviews' && (() => {const review = item as ContextReview; return <><p>Target digest: {review.target_digest}</p><p>Target status: {review.target_status} · Acceptance: not inferred</p><Reference value={review.task}/><Reference value={review.review_attempt}/><ul>{review.checks.map(check => <li key={check.check_id}>{check.check_id}: {check.outcome}<Reference value={check.artifact}/></li>)}</ul></>;})()}
  </li>)}</ul>;
}
function ProjectDossier({projectId, onAccessDenied}: {projectId: string; onAccessDenied: (cause: Error) => void}) {
  const [availability, setAvailability] = useState<ContextAvailability>();
  const [project, setProject] = useState<ContextSnapshot<ProjectContextResponse>>();
  const [task, setTask] = useState<ContextSnapshot<TaskContextResponse>>();
  const [taskId, setTaskId] = useState(''), [section, setSection] = useState<TaskContextSection>('dependencies');
  const [referencedTask, setReferencedTask] = useState<ContextRef<'task'>>(), [returnTask, setReturnTask] = useState<ContextRef<'task'>>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [restart, setRestart] = useState<'project' | 'task'>();
  const active = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    getContextAvailability(controller.signal).then(value => {if (!controller.signal.aborted) setAvailability(value);}).catch(cause => {
      if (controller.signal.aborted) return;
      if (isCompanyAccessDenied(cause)) onAccessDenied(cause);
      else setError(cause instanceof Error ? cause.message : 'Context availability is unavailable.');
    });
    return () => {controller.abort(); active.current?.abort(); generation.current++;};
  }, [onAccessDenied]);
  const invalidateTask = () => {active.current?.abort(); generation.current++; setBusy(false); setTask(undefined); setError(''); setRestart(undefined);};
  const load = async (kind: 'project' | 'task', cursor: string | null, target = {id: taskId, section}) => {
    if (!availability?.configured || kind === 'task' && !target.id) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const version = ++generation.current; setBusy(true); setError(''); setRestart(undefined);
    try {
      if (kind === 'project') {
        const result = await getProjectContext({project_id: projectId, limit, cursor}, controller.signal);
        if (generation.current !== version) return;
        setProject(result); setTask(undefined); setReferencedTask(undefined); setReturnTask(undefined);
        setTaskId(current => result.data.tasks.some(item => item.entity.id === current) ? current : result.data.tasks[0]?.entity.id ?? '');
      } else {
        const result = await getTaskContext({project_id: projectId, task_id: target.id, section: target.section, limit, cursor}, controller.signal);
        if (generation.current !== version) return;
        setTask(result);
      }
    } catch (cause) {
      if (controller.signal.aborted || generation.current !== version) return;
      if (isCompanyAccessDenied(cause)) {onAccessDenied(cause); return;}
      setError(cause instanceof Error ? cause.message : 'The context read could not complete.');
      if (cause instanceof ApiError && cause.code === 'COMPANY_SNAPSHOT_CHANGED') {
        if (kind === 'project') {setProject(undefined); setTask(undefined);} else setTask(undefined);
        setRestart(kind);
      }
    } finally {if (generation.current === version) setBusy(false);}
  };
  const navigate = (reference: ContextRef<'task'>, returning = false) => {
    if (reference.scope.id !== projectId) return;
    const prior = task?.data.task.entity;
    invalidateTask(); setReferencedTask(reference); setTaskId(reference.id); setSection('dependencies');
    setReturnTask(returning ? undefined : prior);
    void load('task', null, {id: reference.id, section: 'dependencies'});
  };
  return <section className="company-context" aria-label="Project context dossier" aria-busy={busy}>
    <div className="company-section-heading"><h3>Project context dossier</h3><span>Owner reads · No engine access</span></div>
    <p className="company-footnote">Paged source observations. Mandate, knowledge and canonical dossier remain unavailable. These reads grant no execution or approval authority.</p>
    {availability && !availability.configured && <div className="company-empty"><h3>Project context unavailable</h3>{availability.blockers.map((blocker, index) => <p key={index}>{blocker}</p>)}</div>}
    {error && <p role="alert" className="company-local-error">{error}</p>}
    {error && (project || task) && <p className="company-footnote">Previously received context remains visible; freshness is unconfirmed.</p>}
    {restart && <button type="button" className="company-refresh" disabled={busy} onClick={() => void load(restart, null)}>Reload {restart} from first page</button>}
    <div className="company-context-actions"><button type="button" className="company-refresh" disabled={!availability?.configured || busy} onClick={() => void load('project', null)}>Load project context</button>{project?.data.page.next_cursor && <button type="button" className="company-refresh" disabled={busy} onClick={() => void load('project', project.data.page.next_cursor)}>Next task page</button>}</div>
    {project && <>
      <h4>{project.data.project.name}</h4><p>{project.data.project.purpose}</p><p>Project state: {project.data.project.state}</p><Reference value={project.data.project.entity}/><Reference value={project.data.project.manager}/>
      <details><summary>Repositories and staffing</summary><ul>{project.data.project.repositories.map((repository, index) => <li key={index}>{repository.repository}<ul>{repository.relative_paths.map(path => <li key={path}>{path}</li>)}</ul></li>)}</ul><ul>{project.data.project.staffing.map(staff => <li key={staff.employee.id}><Reference value={staff.employee}/>{staff.responsibility}</li>)}</ul></details>
      <ul className="company-context-records">{project.data.tasks.map(item => <li key={item.entity.id}><Reference value={item.entity}/><p>Task state: {item.state}</p><Reference value={item.work_order}/><Reference value={item.employee}/></li>)}</ul>
      <PageNote page={project.data.page}/><p className="company-footnote">Received: {project.receivedAt}</p>
      <div className="company-context-actions"><label>Task<select aria-label="Context task" value={taskId} onChange={event => {invalidateTask(); setTaskId(event.target.value); setReferencedTask(undefined); setReturnTask(undefined);}}>{project.data.tasks.map(item => <option key={item.entity.id} value={item.entity.id}>{item.entity.id}</option>)}{referencedTask && !project.data.tasks.some(item => item.entity.id === referencedTask.id) && <option value={referencedTask.id}>{referencedTask.id} · prerequisite reference</option>}</select></label><label>Section<select aria-label="Task context section" value={section} onChange={event => {invalidateTask(); setSection(event.target.value as TaskContextSection);}}>{sections.map(value => <option key={value} value={value}>{value}</option>)}</select></label><button type="button" className="company-refresh" disabled={!taskId || busy} onClick={() => void load('task', null)}>Load task context</button>{returnTask && <button type="button" className="company-refresh" onClick={() => navigate(returnTask, true)}>Return to {returnTask.id}</button>}{task?.data.page.next_cursor && <button type="button" className="company-refresh" disabled={busy} onClick={() => void load('task', task.data.page.next_cursor)}>Next section page</button>}</div>
    </>}
    {task && <section aria-label="Task context page"><h4>{task.data.task_id} · {task.data.section}</h4><p>Task state: {task.data.task.state}</p><Reference value={task.data.task.entity}/><Reference value={task.data.task.work_order}/><SectionItems value={task.data} inspect={reference => navigate(reference)}/><PageNote page={task.data.page}/><p className="company-footnote">Received: {task.receivedAt}</p></section>}
    {availability && <details className="company-context-pin"><summary>Context contract pin</summary><p>{availability.contractId} / {availability.contractVersion}</p><p>Backend checkpoint: {availability.backendCheckpoint}</p><p>Manifest SHA-256: {availability.manifestSHA256}</p><p>Owner host only. No employee engine access.</p></details>}
  </section>;
}
export function ContextDossier({projectId, onAccessDenied}: {projectId: string | null; onAccessDenied: (cause: Error) => void}) {
  return projectId ? <ProjectDossier key={projectId} projectId={projectId} onAccessDenied={onAccessDenied}/> : <section className="company-empty"><h3>Project context dossier</h3><p>Choose a project to inspect its source context.</p></section>;
}
