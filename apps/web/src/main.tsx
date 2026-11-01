import { createRoot } from 'react-dom/client';
import { DesktopEntry } from './DesktopEntry';
import '@fontsource-variable/inter';
import './styles.css';
import './frontend-fidelity.css';

createRoot(document.getElementById('root')!).render(<DesktopEntry />);
