import {createRoot} from 'react-dom/client';
import {AgentFileProtection} from '../../apps/web/src/AgentFileProtection';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/settings.css';
import '../../apps/web/src/agent-file-protection.css';

createRoot(document.getElementById('root')!).render(
	<AgentFileProtection projects={[{id:'project:alpha',label:'Alpha project'}]} busy={false}/>,
);
