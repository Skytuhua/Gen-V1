// Tooling-owned consumers of production renderers, with existing synthetic e2e patterns.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SideChat } from '../../apps/web/src/SideChat';
import { TaskMemory } from '../../apps/web/src/TaskMemory';
import { SkillLibrary } from '../../apps/web/src/SkillLibrary';
import { UpdateControl } from '../../apps/web/src/UpdateControl';
import { Connections } from '../../apps/web/src/Connections';
import { CredentialEntry } from '../../apps/web/src/CredentialEntry';
import { GitHubSignIn } from '../../apps/web/src/GitHubSignIn';
import { SecureArtifactProvider } from '../../apps/web/src/secure-artifact-context';
import { DraftTransfer } from '../../apps/web/src/DraftTransfer';
import { snapshotDraftReferences } from '../../apps/web/src/draft-transfer';
import { TerminalBody } from '../../apps/web/src/TerminalBody';
import { ProjectContextSurface } from '../../apps/web/src/ProjectContextSurface';
import { WorkspaceSplitLayout } from '../../apps/web/src/WorkspaceSplitLayout';
import { DelegatedAgentTranscript } from '../../apps/web/src/DelegatedAgentTranscript';
import { PluginFrame } from '../../apps/web/src/PluginFrame';
import { useScopedConversation } from '../../apps/web/src/conversation-workspace/useScopedConversation';
import { ConversationPane } from '../../apps/web/src/conversation-workspace/ConversationPane';
import { ScopedConversationComposer } from '../../apps/web/src/ScopedConversationComposer';
import { createPersonalAgentComposers } from '../../apps/web/src/agents-workspace/composer';
import { DEFAULT_PREFERENCES } from '../../packages/contracts/preferences';
import { createSplitWorkspaceLayout } from '../../packages/core/split-workspace-layout';
import { timelineSnapshot } from '../../tests/e2e/plan-timeline-fixture';
import { scopedSelection } from '../../tests/scoped-conversation-fixture';
import { browserSnapshot } from './browser-data';
import pluginManifest from '../../plugins/personal-visuals/plugin.json';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const query = new URLSearchParams(location.search), snapshot = browserSnapshot(query.get('variant') === 'empty'), surface = query.get('surface');
const noop = async () => {};
let pluginReadyCount = 0;
function Scoped() {
  const conversation = useScopedConversation(scopedSelection);
  const [composers] = useState(createPersonalAgentComposers);
  useEffect(() => () => composers.dispose(), [composers]);
  return <div style={{height: '100dvh'}}><ConversationPane conversation={conversation} renderComposer={state => state.context && <ScopedConversationComposer context={state.context} composers={composers} openConversation={noop} refreshOwner={noop}/>} /></div>;
}
function TerminalCapture() {
  const [id, setId] = useState('capture-terminal');
  return <div data-terminal-id={id} style={{height:640}}><TerminalBody key={id} projectId="capture-project" threadId="one" terminalId={id} active openAnother={()=>setId('capture-terminal-second')}/></div>;
}
async function splitCommand() {
  if (query.get('variant') === 'error') throw Error('Synthetic workspace command unavailable.');
  if (query.get('variant') === 'loading') await fetch('/api/capture/split');
}
async function draftReferences() {
  if (query.get('variant') === 'error') throw Error('Synthetic draft source unavailable.');
  await fetch('/api/capture/draft-references');
  return snapshotDraftReferences(snapshot);
}
function Content() {
  switch (surface) {
    case 'side-chat': localStorage.setItem('harness:side-selected:one', 'side-one'); return <SideChat parent={snapshot.threads[0]} snapshot={snapshot} modelId="synthetic/model" open onClose={()=>{}} refresh={noop}/>;
    case 'scoped': return <Scoped/>;
    case 'memory': return <TaskMemory snapshot={snapshot} threadId="one"/>;
    case 'skills': return <SkillLibrary snapshot={snapshot} preferences={DEFAULT_PREFERENCES} update={noop} refresh={noop} busy={false}/>;
    case 'connections': return <><Connections models={[]} snapshot={snapshot} refresh={noop} loadModels={noop} query="ChatGPT"/><GitHubSignIn/><UpdateControl/><SecureArtifactProvider value={{artifactId:'capture-credential',threadId:'one',revision:1}}><CredentialEntry slotKey="audit-token" service="Audit service" label="Private token" purpose="Synthetic empty credential request"/></SecureArtifactProvider></>;
    case 'drafts': return query.has('variant') ? <DraftTransfer references={draftReferences}/> : <DraftTransfer snapshot={snapshot}/>;
    case 'terminal': return <TerminalCapture/>;
    case 'project': return <ProjectContextSurface thread={query.get('variant') === 'empty' ? undefined : snapshot.threads[0]} snapshot={snapshot}/>;
    case 'split': return <div style={{height:800}}><WorkspaceSplitLayout layout={createSplitWorkspaceLayout()} onCommand={splitCommand} renderView={()=><TaskMemory snapshot={snapshot} threadId="one"/>}/></div>;
    case 'delegated': { const data = timelineSnapshot(); if (query.get('variant') === 'empty') data.messages = []; if (query.get('variant') === 'error') data.data = []; return <DelegatedAgentTranscript snapshot={data} threadId="thread-a" agentId="ui"/>; }
    case 'plugin': return <div style={{height:'100dvh',display:'flex',flexDirection:'column'}}><PluginFrame plugin={{...pluginManifest,apiVersion:1}} theme="dark" onReady={()=>{if (++pluginReadyCount >= 2) document.documentElement.dataset.pluginReady='true';}}/></div>;
    default: throw Error(`Unknown browser surface ${surface}`);
  }
}
createRoot(document.getElementById('root')!).render(<main data-browser-surface={surface} style={{padding: surface === 'plugin' || surface === 'scoped' ? 0 : 16}}><Content/></main>);
