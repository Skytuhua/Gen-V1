import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CompactSettings} from '../../apps/web/src/CompactSettings';
import {Modal} from '../../packages/ui-shell/Modal';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

function Fixture() {
  const [scope, setScope] = useState('personal-one'), [open, setOpen] = useState(true);
  return <div className="app-shell"><p>Synthetic compact Settings consumer fixture</p><button onClick={() => setScope('personal-two')}>Change scope</button><Modal open={open} title="Settings" className="settings-dialog" onClose={() => setOpen(false)}><CompactSettings scopeKey={scope} close={() => setOpen(false)} addResource={() => {}} openBrowser={async url => {Object.assign(window, {openedUrl: url});}}/></Modal></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
