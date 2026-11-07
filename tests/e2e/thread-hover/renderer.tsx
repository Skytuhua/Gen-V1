import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThreadHoverCard} from '../../../apps/web/src/thread-hover/ThreadHoverCard';
import {createThreadHoverCache} from '../../../apps/web/src/thread-hover/data';
import type {ThreadHoverFacts, ThreadHoverScope} from '../../../apps/web/src/thread-hover/facts';
import {Modal} from '../../../packages/ui-shell/Modal';
import '../../../apps/web/src/styles.css';
import './fixture.css';

type Target = {id: string; owner: string; workingCopy: string};
type Request = {scope: ThreadHoverScope; signal: AbortSignal; resolve: (facts: ThreadHoverFacts<Target>) => void; reject: (error: Error) => void};
export function fixtureFacts(id: string, revision = 'rev-1'): ThreadHoverFacts<Target> {
  return {scope: {authority: {kind: 'local'}, threadId: id, projectId: 'same-project', workingCopyId: `C:/worktrees/${id}`, revision},
    title: id === 'a' ? 'Improve the workspace without losing the full thread title' : 'Second thread in the same project',
    project: {name: 'Gen V1', monogram: 'GV'}, machine: 'Workstation', environment: 'Local', workingCopy: `C:/worktrees/${id}`,
    branch: `feature/${id}`, runtime: 'Codex', model: 'Supplied model', reasoning: 'High', activity: 'Reviewing changes',
    lastActivity: {label: '14:20', at: '2026-11-06T14:20:00Z'}, sourceHandoff: 'Source thread / exact supplied handoff',
    parent: {threadId: 'parent', title: 'Parent conversation'}, childCount: 2,
    pullRequests: [{id: `${id}-pr`, label: `#59 Preserve exact ${id} owner`, state: 'Open', checks: '3 checks passed', target: {id: `${id}-pr`, owner: id, workingCopy: `C:/worktrees/${id}`}}]};
}

declare global {
  interface Window {
    hoverFixture: {
      requests: Request[];
      setFacts: (facts: ThreadHoverFacts<Target>) => void;
      setBlocked: (blocked: boolean) => void;
      facts: typeof fixtureFacts;
      lastOpen: {target: Target; scope: ThreadHoverScope; exact: boolean} | null;
      setMenuOpen: (open: boolean) => void;
    };
  }
}

const requests: Request[] = [], cache = createThreadHoverCache<Target>();
const load = (scope: ThreadHoverScope, signal: AbortSignal) => new Promise<ThreadHoverFacts<Target>>((resolve, reject) => requests.push({scope, signal, resolve, reject}));
function Fixture() {
  const params = new URLSearchParams(location.search), async = params.has('async');
  const [facts, setFacts] = useState(fixtureFacts('a')), [blocked, setBlocked] = useState(false), [menuOpen, setMenuOpen] = useState(false), [modal, setModal] = useState(params.has('modal'));
  const [last, setLast] = useState('');
  window.hoverFixture = {requests, setFacts, setBlocked, facts: fixtureFacts, lastOpen: window.hoverFixture?.lastOpen ?? null, setMenuOpen};
  const content = <section className="fixture-owner">
    <ThreadHoverCard facts={async ? {scope: facts.scope, title: facts.title, project: facts.project} : facts}
      cache={cache} loadFacts={async ? load : undefined} blocked={blocked || menuOpen} projectColors={{'["local","same-project"]': '#639BC2'}}
      onOpenPR={(target, scope) => {
        const source = async ? fixtureFacts(scope.threadId, scope.revision) : facts;
        const exact = async ? target.id === source.pullRequests?.[0].target.id : target === source.pullRequests?.[0].target;
        window.hoverFixture.lastOpen = {target, scope, exact}; setLast(JSON.stringify({target, scope, exact}));
      }}>
      {trigger => <button {...trigger} type="button" className="fixture-thread" draggable onClick={() => setLast('thread selected')}>Thread trigger</button>}
    </ThreadHoverCard>
    <button type="button" className="fixture-next" onClick={() => setMenuOpen(value => !value)}>Next control</button>
    {menuOpen && <div role="menu" aria-label="Parent-owned thread menu"><button role="menuitem" onClick={() => setMenuOpen(false)}>Close menu</button></div>}
  </section>;
  return <main className={params.has('edge') ? 'fixture edge' : 'fixture'}>
    <p className="fixture-label">Synthetic data • actual ThreadHoverCard module</p>
    {modal ? <Modal open title="Fixture modal owner" onClose={() => setModal(false)}>{content}</Modal> : content}
    <output aria-label="Exact open target">{last}</output>
    <button type="button" className="fixture-outside">Outside control</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
