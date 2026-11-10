import {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Artifact} from '../../apps/web/src/Artifact';
import {createTaskSnapshot, taskSurface} from './task-data';
import '../../apps/web/src/styles.css';

const query = new URLSearchParams(location.search), surface = taskSurface(query.get('surface'));
function TaskCapture() {
  const [snapshot, setSnapshot] = useState(() => createTaskSnapshot(surface, query.get('variant') === 'empty'));
  useEffect(() => {
    if (surface !== 'document-window') return;
    // Exercise the actual launcher; the window keeps its own focus, portal and editing behavior.
    let opened = false;
    const open = () => {
      const button = document.querySelector<HTMLButtonElement>('.document-window-launcher > button');
      if (!opened && button) {opened = true; button.click();}
    };
    const observer = new MutationObserver(open); observer.observe(document.getElementById('root')!, {childList: true, subtree: true}); open();
    return () => observer.disconnect();
  }, []);
  return <main data-task-surface={surface} style={{padding: 16, margin: '0 auto', maxWidth: 1200, minHeight: '100dvh'}}>
    <Artifact artifact={snapshot.artifacts[0]} snapshot={snapshot} theme="dark" refresh={async next => {if (next) setSnapshot(next);}} embedded/>
  </main>;
}
document.body.style.overflow = 'auto';
document.getElementById('root')!.style.height = 'auto';
createRoot(document.getElementById('root')!).render(<TaskCapture/>);
