import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './frontend-fidelity.css';

// The personal harness is always the shell. Optional installed plug-ins are
// contributed through its verified host registry and isolated frame bridge.
const root = createRoot(document.getElementById('root')!);
void import('./DesktopEntry').then(({DesktopEntry}) => root.render(<DesktopEntry />)).catch(() => root.render(<p role="alert">The application could not load. Refresh to retry. Your saved work remains on this device.</p>));
