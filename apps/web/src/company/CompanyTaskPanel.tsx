import {lazy, Suspense, useEffect, useState} from 'react';
import {isCompanyAccessDenied} from './api';
import {getCompanyWorkflow, type WorkflowAvailability} from './workflow-api';
import type {ApprovedJobRead} from '../../../../packages/company-contracts/approved-job-read';
import {workPlanCanonicalBytes} from '../../../../packages/company-contracts/work-plan';

const WorkPlanReview = lazy(() => import('./WorkPlanReview').then(module => ({default: module.WorkPlanReview})));

/** This panel reads the host's exact selection. It creates no grant or task. */
export function CompanyTaskPanel({projectId, projectName, onAccessDenied, expectedBinding, onBinding, onRecovered}: {projectId: string | null; projectName?: string; onAccessDenied: (cause: Error) => void;
  expectedBinding?: ApprovedJobRead; onBinding?: (binding: ApprovedJobRead | undefined) => void; onRecovered?: (available: boolean) => void}) {
  const [workflow, setWorkflow] = useState<WorkflowAvailability>(), [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    if (projectId) void getCompanyWorkflow(controller.signal).then(value => {if (!controller.signal.aborted) setWorkflow(value);}).catch(cause => {
      if (controller.signal.aborted) return;
      setFailed(true); if (isCompanyAccessDenied(cause)) onAccessDenied(cause);
    });
    return () => controller.abort();
  }, [projectId, onAccessDenied]);
  const job = workflow?.approvedJob;
  const match = job?.projectId === projectId && (!expectedBinding || new TextDecoder().decode(workPlanCanonicalBytes(job)) === new TextDecoder().decode(workPlanCanonicalBytes(expectedBinding)));
  useEffect(() => {
    onBinding?.(match ? job : undefined);
    if (workflow && expectedBinding && !match) onAccessDenied(Error('The host task reference changed.'));
    if ((!projectId || failed || workflow) && !match) onRecovered?.(false);
  }, [job, match, workflow, expectedBinding, failed, projectId, onBinding, onRecovered, onAccessDenied]);
  if (!projectId) return <p>Choose a project to see its saved task and plan.</p>;
  return <>
    <h3>{projectName}</h3>
    <p className="company-footnote">Team activity is not available. A saved plan does not mean employees have started work.</p>
    {match && job ? <Suspense fallback={<p>Opening saved task…</p>}><WorkPlanReview projectId={job.projectId} instructionId={job.instructionId} readOnly={job} onRecovered={onRecovered}/></Suspense>
      : <p className="company-task-panel-empty">{failed ? 'The task record could not be read. Close this panel and reopen it to retry.' : !workflow ? 'Reading the saved task…' : 'No task reference is available for this project. Open Communications for saved instructions and plan review.'}</p>}
  </>;
}
