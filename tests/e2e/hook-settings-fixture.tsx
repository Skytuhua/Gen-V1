import {createRoot} from 'react-dom/client';
import {HookSettings} from '../../apps/web/src/HookSettings';
import {Modal} from '../../packages/ui-shell/Modal';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/settings.css';
import '../../apps/web/src/hook-settings.css';

createRoot(document.getElementById('root')!).render(
  <Modal open title="Settings" className="settings-dialog" onClose={() => {}}>
    <main className="settings-content">
      <HookSettings/>
    </main>
  </Modal>,
);
