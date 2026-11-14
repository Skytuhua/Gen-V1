import {createRoot} from 'react-dom/client';
import {App} from '../../apps/web/src/App';
import {ConversationPane} from '../../apps/web/src/conversation-workspace/ConversationPane';
import {useScopedConversation} from '../../apps/web/src/conversation-workspace/useScopedConversation';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
function Main(){return <App/>;}
function Scoped(){const conversation=useScopedConversation({target:{authority:'personal',threadId:'exact-owner'},navigationKey:'fixture'});return <ConversationPane conversation={conversation} renderComposer={()=><textarea aria-label="Message" defaultValue="Scoped draft"/>}/>;}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('scoped')?<Scoped/>:<Main/>);
