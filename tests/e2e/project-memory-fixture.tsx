import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectContextSurface} from '../../apps/web/src/ProjectContextSurface';
import {ContextInspector, type ContextInspectorProps} from '../../apps/web/src/ContextInspector';
import type {Snapshot, Thread} from '../../packages/contracts';
import type {MemoryItemV1, MemoryRecallV1} from '../../packages/contracts/project-memory';
import '../../apps/web/src/styles.css';

const thread = (id: string): Thread => ({id, title: 'Synthetic source conversation', projectId: id === 'thread-a' ? 'project-a' : 'project-b', projectName: 'Synthetic project', accountId: 'account-a', kind: 'main', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', status: 'ready', epoch: 1, runId: null, sessionPath: null, modelId: null});
const recalled: MemoryItemV1 = {id: 'accepted', projectIdentity: 'a'.repeat(64), scope: 'PROJECT', kind: 'CONSTRAINT', text: 'Use UTC for exported dates.', revision: 1, state: 'ACCEPTED', sourceRefs: [{ownerThreadId: 'thread-a', sourceKind: 'MESSAGE', sourceId: 'message-accepted', sourceRevision: 'source-r1', capturedSeq: 4, digest: 'c'.repeat(64), observedStatus: 'REPORTED'}], assertedBy: {kind: 'USER', id: 'local-user'}, observedAt: '2026-11-15T00:00:00Z', expiresAt: null, supersedes: [], sensitivity: 'NORMAL', reviewDecision: null};
const recall: MemoryRecallV1 = {requestId: 'prepared-request', projectIdentity: 'a'.repeat(64), contextGeneration: 7, queryDigest: 'd'.repeat(64), candidateIds: ['accepted'], selectedRevisions: [{itemId: 'accepted', revision: 1}], scores: [{itemId: 'accepted', revision: 1, projectOverlap: 1, symbolOverlap: 1, matchedTerms: ['UTC']}], exclusions: [], budgetBytes: 4096, producedAt: '2026-11-15T00:00:00Z', status: 'COMPLETE'};
function Fixture() {
  const [owner, setOwner] = useState(thread('thread-a')), [context, setContext] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  Object.assign(window, {switchMemoryOwner: () => setOwner(thread('thread-b'))});
  const snapshot = {seq: 1, threads: [owner], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: {theme: 'dark', modelId: null}, activeThreadId: owner.id} as Snapshot;
  const optional = {memoryRecall: {threadId: 'thread-a', accountId: 'account-a', projectId: 'project-a', projectIdentity: 'a'.repeat(64), requestId: 'prepared-request', contextGeneration: 7, recall, items: [recalled], injectedBytes: 240}} as Partial<ContextInspectorProps>;
  return <main style={{padding: 16, maxWidth: 900}}><p>Synthetic memory API fixture. Production review and context components.</p><ProjectContextSurface thread={owner} snapshot={snapshot}/><button ref={anchor} onClick={() => setContext(true)}>Inspect prepared context</button>{context && <ContextInspector {...optional} thread={owner} usage={undefined} anchor={anchor} close={() => setContext(false)} refresh={async () => {}}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
