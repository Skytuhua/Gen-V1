import {createRoot} from 'react-dom/client';
import {App} from '../../apps/web/src/App';
import {AgentsWorkspace} from '../../apps/web/src/agents-workspace/AgentsWorkspace';
import {AgentsWorkspaceController} from '../../apps/web/src/agents-workspace/controller';
import {createPersonalAgentComposers} from '../../apps/web/src/agents-workspace/composer';
import {createPersonalChildFollowUp} from '../../apps/web/src/agents-workspace/follow-up';
import '../../apps/web/src/styles.css';

const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(location.search).has('app')) root.render(<App/>);
else {
 const controller = new AgentsWorkspaceController();
 const composers = createPersonalAgentComposers(createPersonalChildFollowUp(agent => controller.getSnapshot().agents.find(parent => parent.agentId === agent.parentId)?.threadId ?? undefined));
 root.render(<main style={{height: '100dvh', minWidth: 0}}><span className="sr-only">Synthetic agent workspace fixture</span><AgentsWorkspace controller={controller} composers={composers} onOpenConversation={id => {document.documentElement.dataset.openedThread = id;}}/></main>);
 void controller.start().catch(() => root.render(<p role="alert">Workspace bootstrap failed. Retry opening.</p>));
 window.addEventListener('pagehide', () => {controller.dispose(); composers.dispose();}, {once: true});
}
