// Focused production-CSP fixture; same company component/import path, no personal startup.
import {createRoot} from 'react-dom/client';
import '../../../apps/web/src/styles.css';
import '../../../apps/web/src/frontend-fidelity.css';
import {CompanyWorkspace} from '../../../apps/web/src/company/CompanyWorkspace';
createRoot(document.getElementById('root')!).render(<CompanyWorkspace/>);
