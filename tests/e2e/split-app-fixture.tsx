import {createRoot} from 'react-dom/client';
import {App} from '../../apps/web/src/App';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/desktop.css';

createRoot(document.getElementById('root')!).render(<App/>);
