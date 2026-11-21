import {createRoot} from 'react-dom/client';
import {App} from '../../apps/web/src/App';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/frontend-fidelity.css';
// Prompt edit-and-rerun evidence fixture (#1532 T05): the real App transcript
// against a stubbed /api, same contract as conversation-find-fixture.
createRoot(document.getElementById('root')!).render(<App/>);
