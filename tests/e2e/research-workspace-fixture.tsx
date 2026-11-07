import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ResearchWorkspace, type ResearchSelection} from '../../apps/web/src/research-workspace/ResearchWorkspace';
import '../../apps/web/src/styles.css';

function Fixture() {
  const [epoch, setEpoch] = useState(0), [visible, setVisible] = useState(true), [chat, setChat] = useState(false);
  const selection: ResearchSelection = {authority: {kind: 'personal'}, threadId: 'thread-a', projectId: 'project-a', epoch, resource: null};
  return <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}><header style={{height: 40, flex: '0 0 40px', display: 'flex', gap: 8, alignItems: 'center', paddingInline: 16}}>
    <span>Synthetic Research fixture</span><button onClick={() => setVisible(v => !v)}>Toggle workspace</button><button onClick={() => setEpoch(v => v + 1)}>Next epoch</button>
  </header><main style={{flex: 1, minHeight: 0}}>{visible && <ResearchWorkspace selection={selection} topic="Evidence notebook" onNavigate={() => {}}
    grantedFiles={[{resourceId: 'grant-a', label: 'Synthetic granted file'}]} chat={<div aria-label="Investigative chat"><label>Chat draft<textarea aria-label="Chat draft" /></label></div>}
    chatOpen={chat} onChatOpenChange={setChat} />}</main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
