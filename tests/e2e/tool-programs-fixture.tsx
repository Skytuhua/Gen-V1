import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolProgramPanel } from '../../apps/web/src/ToolProgramPanel';
import '@fontsource-variable/inter';
import '../../apps/web/src/styles.css';

function Fixture() {
  const [threadId, setThreadId] = useState('thread-a');
  const [generation, setGeneration] = useState(1);
  return <main style={{ maxWidth: 860, margin: '24px auto', padding: 16 }}>
    <h1>Tool programs fixture</h1>
    <nav aria-label="Fixture owner" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={() => setThreadId('thread-a')}>Thread A</button>
      <button onClick={() => setThreadId('thread-b')}>Thread B</button>
      <button onClick={() => setGeneration(value => value + 1)}>Rebind owner</button>
    </nav>
    <ToolProgramPanel threadId={threadId} ownerKey={`${threadId}:${generation}`} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
