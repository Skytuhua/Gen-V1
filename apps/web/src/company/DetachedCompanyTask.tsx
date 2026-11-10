import {useCallback, useEffect, useState} from 'react';
import {PanelRight} from 'lucide-react';
import type {DesktopBridge, DesktopContext} from '../../../../packages/desktop-contract';
import {CompanyTaskPanel} from './CompanyTaskPanel';
import {bindCompanyTaskSurface, flushCompanyTaskHandoff, resolveCompanyTaskSurface} from './company-task-desktop';
import './company.css';
import './task-surface.css';

export function DetachedCompanyTask({bridge, context}: {bridge: DesktopBridge; context: DesktopContext}) {
  const [task, setTask] = useState<Awaited<ReturnType<typeof resolveCompanyTaskSurface>>>();
  const [recovered, setRecovered] = useState(false), [failure, setFailure] = useState(''), [busy, setBusy] = useState(false);
  const settled = useCallback((available: boolean) => {if (available) setRecovered(true); else setFailure('The saved task could not be recovered. Keep the main view open and retry from there.');}, []);
  const deny = useCallback(() => {setTask(undefined); setFailure('Current company access is unavailable. Saved work has been kept.');}, []);
  useEffect(() => bridge.onCloseRequested(async () => {
    try {await flushCompanyTaskHandoff(); return true;}
    catch {setFailure('Wait for the task read or save to finish, then try closing again.'); return false;}
  }), [bridge]);
  useEffect(() => {
    const controller = new AbortController();
    void resolveCompanyTaskSurface(context.surface, controller.signal).then(value => {if (!controller.signal.aborted) setTask(value);}).catch(() => {if (!controller.signal.aborted) setFailure('This task window cannot open with the current company connection. Return to the main window and check the selected project.');});
    return () => controller.abort();
  }, [context.surface]);
  useEffect(() => {
    if (!task || !recovered) return;
    let alive = true;
    void bridge.ready().then(value => {if (alive) bindCompanyTaskSurface(value.surface, task.binding);}).catch(() => {if (alive) deny();});
    return () => {alive = false;};
  }, [bridge, task, recovered, deny]);
  return <main className="company-workspace company-detached-task" aria-label="Detached company task">
    <header><div><h1>Task & plan</h1><p>{task?.projectName ?? 'Company task'}</p></div><button disabled={busy || !task} onClick={() => {
      setBusy(true); setFailure('');
      void flushCompanyTaskHandoff().then(() => bridge.reattach()).catch(() => setFailure('The task could not move yet. Wait for its read or save to finish and try again.')).finally(() => setBusy(false));
    }}><PanelRight size={16}/>Dock in main window</button></header>
    {failure && <p role="alert">{failure}</p>}
    {task ? <CompanyTaskPanel projectId={task.binding.projectId} projectName={task.projectName} expectedBinding={task.binding} onAccessDenied={deny} onRecovered={settled}/>
      : !failure && <p role="status">Checking this task and recovering its saved view…</p>}
  </main>;
}
