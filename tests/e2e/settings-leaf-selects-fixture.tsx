import {createRoot} from 'react-dom/client';
import {EnvironmentSettings} from '../../apps/web/src/EnvironmentSettings';
import {IntegrationSettings} from '../../apps/web/src/IntegrationSettings';
import {Modal} from '../../packages/ui-shell/Modal';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/settings.css';

createRoot(document.getElementById('root')!).render(
  <Modal open title="Settings" className="settings-dialog" onClose={() => {}}>
    <main className="settings-content">
      <p>Synthetic Settings leaf fixture</p>
      <label className="field">Synthetic neighboring draft<input defaultValue="Keep the neighboring draft"/></label>
      <EnvironmentSettings/>
      <IntegrationSettings/>
    </main>
  </Modal>,
);
