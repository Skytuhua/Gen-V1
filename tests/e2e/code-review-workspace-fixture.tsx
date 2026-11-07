import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CodeReviewWorkspace, type ReviewActionResult, type ReviewOutcomeResult, type ReviewWrites} from '../../apps/web/src/code-review-workspace/CodeReviewWorkspace';
import type {ReviewOwner, ReviewSelection} from '../../apps/web/src/code-review-workspace/model';
import '../../apps/web/src/styles.css';

let callbackIndex = 0;
const pending = new Map<number, {resolve: (value: ReviewActionResult | ReviewOutcomeResult) => void; reject: () => void}>();
window.addEventListener('settle-callback', event => {const {index, state, reject} = (event as CustomEvent).detail; const item = pending.get(index); if (reject) item?.reject(); else item?.resolve({state}); pending.delete(index);});
const owner: ReviewOwner = {authority: {kind: 'local'}, projectId: 'project-one', threadId: 'copy-one'};
const other: ReviewOwner = {...owner, projectId: 'project-two', threadId: 'copy-two'};
function Fixture() {
  const [selection, navigate] = useState<ReviewSelection>({owner, target: {kind: 'local', scope: 'worktree'}});
  const [revision, setRevision] = useState('e'.repeat(64)), [writable, setWritable] = useState(true), [reviewable, setReviewable] = useState(true), [result, setResult] = useState(''), [calls, setCalls] = useState<unknown[]>([]), [inspection, setInspection] = useState('');
  const record = async (operation: string, ...args: unknown[]): Promise<ReviewActionResult> => {setResult(JSON.stringify([...args, {operation}])); setCalls(rows => [...rows, {index: callbackIndex, operation, args}]); if (new URLSearchParams(location.search).has('controlled')) return await new Promise<ReviewActionResult>( (resolve, reject) => pending.set(callbackIndex++, {resolve: resolve as (value: ReviewActionResult | ReviewOutcomeResult) => void, reject: () => reject(Error('synthetic callback failure'))})); if (new URLSearchParams(location.search).has('delayed')) await new Promise<void>(resolve => window.addEventListener('resolve-review', () => resolve(), {once: true})); return {state: new URLSearchParams(location.search).has('uncertain') ? 'uncertain' : 'confirmed'};};
  const writes: ReviewWrites = {owner: new URLSearchParams(location.search).has('wrong-owner') ? other : selection.owner, git: {head: selection.target.kind === 'local' ? '1'.repeat(40) : '3'.repeat(40), branch: 'topic', revision, gitWrite: writable, files: new URLSearchParams(location.search).has('clean') ? [] : [{path: 'src/first.ts', index: 'M', worktree: 'M', staged: true, untracked: false, binary: false, added: 1, removed: 1}]},
    review: {repo: 'owner/repo', item: {number: 48, headRefOid: '3'.repeat(40)}, head: '3'.repeat(40), revision, canReview: writable && reviewable},
    onStage: (context, payload) => record('stage', context, payload), onUnstage: (context, payload) => record('unstage', context, payload), onCommit: (context, payload) => record('commit', context, payload), onReview: (context, payload) => record('review-pr', context, payload),
    onCreatePullRequest: context => setResult(JSON.stringify(['create-pr', context])), onLinkPullRequest: selected => setResult(JSON.stringify(['link-pr', selected])),
    ...(new URLSearchParams(location.search).has('inspect') ? {onInspectOutcome: async context => {setInspection(JSON.stringify(context)); if (new URLSearchParams(location.search).has('inspect-delayed')) return await new Promise<ReviewOutcomeResult>((resolve, reject) => pending.set(callbackIndex++, {resolve: resolve as (value: ReviewActionResult | ReviewOutcomeResult) => void, reject: () => reject(Error('synthetic inspection failure'))})); return {state: new URLSearchParams(location.search).has('inspect-confirmed') ? 'confirmed' as const : 'not-applied' as const};}} : {}),
  };
  return <><header className="fixture-caption">Synthetic module fixture <span aria-label="Native caption controls">Window controls</span></header>
    <main style={{height: 'calc(100dvh - 42px)', minHeight: 0}}><CodeReviewWorkspace selection={selection} onNavigate={navigate} owners={[{owner, label: 'Project One / Copy One'}, {owner: other, label: 'Project Two / Copy Two'}]} pullRequests={[{repo: 'owner/repo', number: 48, title: 'Exact remote PR'}]} writes={writes}
      chat={<label>Agent message<textarea aria-label="Agent message" defaultValue="Retain optional chat" /></label>} terminal={<pre>Supplied terminal output</pre>} /></main>
    <div hidden><button onClick={() => setRevision('f'.repeat(64))}>Change action revision</button><button onClick={() => setWritable(false)}>Revoke writes</button><button onClick={() => setReviewable(false)}>Revoke review</button><output aria-label="Canonical callback">{result}</output><output aria-label="Canonical calls">{JSON.stringify(calls)}</output><output aria-label="Outcome inspection">{inspection}</output></div></>;
}
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') ?? 'dark';
document.documentElement.dataset.nativeTitlebar = 'true';
const style = document.createElement('style'); style.textContent = 'html,body,#root{height:100%;margin:0;overflow:hidden}.fixture-caption{height:42px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--surface);font-size:12px}.fixture-caption span{padding:0 12px}'; document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture />);
