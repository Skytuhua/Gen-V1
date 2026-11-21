import {createRoot} from 'react-dom/client';
import {ScopedConversationComposer} from '../../apps/web/src/ScopedConversationComposer';
import {scopedContext} from '../scoped-conversation-fixture';
import {createPersonalAgentComposers} from '../../apps/web/src/agents-workspace/composer';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
const composers=createPersonalAgentComposers();
function Fixture(){
 return <div className="composer-dock"><ScopedConversationComposer context={scopedContext} composers={composers} openConversation={async()=>{}} refreshOwner={async()=>{}}/></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
