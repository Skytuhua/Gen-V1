import {createRoot} from 'react-dom/client';
import {ChatView} from '../../packages/ui-shell/ChatView';
import {TooltipLayer} from '../../packages/ui-shell/Tooltip';
import '../../apps/web/src/styles.css';

// Exercise the shared component directly. The application now owns its
// conversation geometry through the canonical split workspace.
createRoot(document.getElementById('root')!).render(<div style={{display:'flex',height:'100dvh',minWidth:0}}>
 <ChatView header={<strong>Direct chat interaction fixture</strong>}>
  <div className="conversation-scroll" tabIndex={0}><p>Keep the pointer drag and keyboard cancellation on the same live chat surface.</p></div>
  <div className="composer-dock"><form className="composer" onSubmit={event=>event.preventDefault()}><textarea aria-label="Message" defaultValue="Keep this draft"/></form></div>
 </ChatView>
 <TooltipLayer/>
</div>);
