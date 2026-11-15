import {createRoot} from 'react-dom/client';
import {App} from '../../apps/web/src/App';
import {createSharedAgentComposers} from '../../apps/web/src/agents-workspace/composer';

// AUD-05 regression host: an embedded conversation that is given a shared composer
// owner but no desktop host. Every Stop entry point must route through this owner.
const stopCalls:unknown[]=[];
(window as unknown as {__stopOwnerCalls:unknown[]}).__stopOwnerCalls=stopCalls;
const owner=createSharedAgentComposers({
 sendParent:async()=>{},
 stopParent:async(agent)=>{stopCalls.push(agent);},
});
createRoot(document.getElementById('root')!).render(<App embeddedThreadId="thread-a" sharedComposers={owner}/>);
