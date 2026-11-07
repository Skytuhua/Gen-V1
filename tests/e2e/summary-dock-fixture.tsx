import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DockedSummary, SummaryDock, SummaryLayout } from '../../packages/ui-shell/SummaryDock';
import { UsageFooter } from '../../apps/web/src/UsageFooter';
import { EMPTY_USAGE } from '../../packages/contracts';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

function Fixture() {
  const [show, setShow] = useState(true), [usage, setUsage] = useState(true), [requests, setRequests] = useState(0);
  const [actions, setActions] = useState(0);
  const [details, setDetails] = useState(false);
  const explicitFocus = new URLSearchParams(location.search).has('focus');
  useEffect(() => {
    const expand = () => setRequests(value => value + 1), hide = () => setShow(false), show = () => setShow(true);
    const state = window as unknown as Window & { summaryResizeCount: number }; state.summaryResizeCount = 0;
    const resize = () => { state.summaryResizeCount++; };
    window.addEventListener('summary-expand', expand); window.addEventListener('summary-hide', hide); window.addEventListener('summary-show', show); window.addEventListener('resize', resize);
    const timer = new URLSearchParams(location.search).has('delayed') ? setTimeout(() => setDetails(true), 50) : undefined;
    return () => { clearTimeout(timer); window.removeEventListener('summary-expand', expand); window.removeEventListener('summary-hide', hide); window.removeEventListener('summary-show', show); window.removeEventListener('resize', resize); };
  }, []);
  return <div className="app-shell" style={{ height: '100dvh', minHeight: 0 }}>
    <section className="shell-workarea">
      <SummaryLayout active={show||usage} summaries={<SummaryDock>
        <DockedSummary id="plan" title="Project overview" open={show} defaultCollapsed={false} focusOnOpen={explicitFocus} expandRequest={requests||undefined}>
          <input aria-label="Overview draft" defaultValue="Keep overview state" />
          <button type="button" onClick={()=>setActions(value=>value+1)}>Open full plan</button>
          {details && <p data-testid="delayed-details">{'Delayed project detail with a long supplied name. '.repeat(120)}</p>}
        </DockedSummary>
        <UsageFooter visible={usage} usage={{...EMPTY_USAGE,contextTokens:18000,contextWindow:100000}}/>
      </SummaryDock>}>
      <main className="workspace">
        <header className="workspace-header"><button type="button" onClick={() => setShow(value => !value)}>Toggle overview</button></header>
        <input aria-label="Main draft" defaultValue="Keep composer focus" />
        <button type="button" onClick={() => setUsage(value => !value)}>Toggle usage preference</button>
        <button type="button" onClick={() => setRequests(value => value + 1)}>Expand from plan update</button>
        <output aria-label="Body actions">{actions}</output>
      </main>
      </SummaryLayout>
    </section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
