import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PersonalInstructionsCard} from '../../apps/web/src/PersonalInstructionsCard';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/settings.css';
import '../../apps/web/src/personal-instructions.css';

function Host() {
  const [enabled, setEnabled] = useState(true);
  return <main className="settings-content">
    <PersonalInstructionsCard enabled={enabled} update={patch => setEnabled(patch.personalInstructionsEnabled)}/>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Host/>);
