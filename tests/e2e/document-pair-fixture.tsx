import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Snapshot } from '../../packages/contracts';
import { Artifact } from '../../apps/web/src/Artifact';
import '../../apps/web/src/styles.css';

const initial: Snapshot = await (await fetch('/api/snapshot')).json();
const availableWidth = Number(new URLSearchParams(location.search).get('artifactWidth'));
function Fixture() {
  const [snapshot, setSnapshot] = useState(initial);
  return <main style={{ padding: 16, margin: '0 auto', maxWidth: availableWidth ? availableWidth + 66 : 1200 }}>
    <Artifact artifact={snapshot.artifacts[0]} snapshot={snapshot} theme="dark" refresh={async next => { if (next) setSnapshot(next); }} embedded />
  </main>;
}
document.body.style.overflow = 'auto';
createRoot(document.getElementById('root')!).render(<Fixture />);
