import {createRoot} from 'react-dom/client';
import type {ComponentType} from 'react';
import {App} from '../../apps/web/src/App';
import {getShellSettings} from '../../apps/web/src/api';
import {getWorkspace} from '../../apps/web/src/workspace-api';
import type {AgentsWorkspaceProps} from '../../apps/web/src/agents-workspace/AgentsWorkspace';
import {AgentsWorkspace} from '../../apps/web/src/agents-workspace/AgentsWorkspace';
import {AgentsWorkspaceController} from '../../apps/web/src/agents-workspace/controller';
import {createPersonalAgentComposers} from '../../apps/web/src/agents-workspace/composer';
import {createPersonalChildFollowUp} from '../../apps/web/src/agents-workspace/follow-up';
import '../../apps/web/src/styles.css';

const controller = new AgentsWorkspaceController();
const composers = createPersonalAgentComposers(createPersonalChildFollowUp(agent => controller.getSnapshot().agents.find(parent => parent.agentId === agent.parentId)?.threadId ?? undefined));
const root = createRoot(document.getElementById('root')!);
const props: AgentsWorkspaceProps = {controller, composers, onOpenConversation: id => {document.documentElement.dataset.openedThread = id;}};
async function mount() {
 let content;
 if (new URLSearchParams(location.search).has('candidate')) {
  const [workspace, settings] = await Promise.all([getWorkspace(), getShellSettings()]);
  document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
  if (workspace.state.canvases.find(canvas => canvas.id === workspace.state.activeCanvasId)?.preset !== 'all-agents') throw Error('Expected canonical All Agents route');
  const CandidateApp = App as ComponentType<{agentsWorkspace: AgentsWorkspaceProps}>;
  content = <CandidateApp agentsWorkspace={props}/>;
 } else content = <AgentsWorkspace {...props}/>;
 root.render(<main style={{height: '100dvh', minWidth: 0}}><span className="sr-only">Synthetic agent workspace fixture</span>{content}</main>);
 await controller.start();
}
void mount().catch(() => root.render(<p role="alert">Workspace bootstrap failed. Retry opening.</p>));
window.addEventListener('pagehide', () => {controller.dispose(); composers.dispose();}, {once: true});
