import {createRoot} from 'react-dom/client';
import {DesktopEntry} from '../../apps/web/src/DesktopEntry';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/desktop.css';

createRoot(document.getElementById('root')!).render(<DesktopEntry/>);
