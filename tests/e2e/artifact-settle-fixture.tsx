import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Artifact } from '../../apps/web/src/Artifact';
import { taskFixture } from './task-interface-fixture';
import '../../apps/web/src/styles.css';

const source = taskFixture({ root: 'body', elements: {
  body: { type: 'Stack', props: { gap: 'sm' }, children: ['note', 'records'] },
  note: { type: 'Input', props: { stateKey: 'note', label: 'Artifact note' } },
  records: { type: 'Table', props: { rowsBinding: 'rows', caption: 'Source records', columns: [{ key: 'name', label: 'Name' }, { key: 'detail', label: 'Detail' }] } },
} }, { rows: Array.from({ length: 6 }, (_, index) => ({ name: `Record ${index + 1}`, detail: 'Synthetic source material for the new working object.' })) }, { note: 'Keep this saved note' });

function Fixture() {
  const restored = new URLSearchParams(location.search).has('restored');
  const [snapshot, setSnapshot] = useState(() => {
    const initial = structuredClone(source);
    const rows = new URLSearchParams(location.search).get('rows');
    if (rows !== null) initial.data[0].value = Array.from({ length: Math.max(0, Math.min(20, Number(rows) || 0)) }, (_, index) => ({ name: `Record ${index + 1}`, detail: 'Synthetic source material for the new working object.' }));
    if (new URLSearchParams(location.search).has('disclosure')) {
      initial.userStates[0].values.open = false;
      initial.artifacts[0].spec!.elements.body.children = ['note', 'details'];
      initial.artifacts[0].spec!.elements.details = { type: 'Disclosure', props: { title: 'Recovered details', stateKey: 'open' }, children: ['records'] };
    }
    if (new URLSearchParams(location.search).has('request')) {
      initial.artifacts[0].spec!.elements.body.children!.push('followup');
      initial.artifacts[0].spec!.elements.followup = { type: 'Disclosure', props: { title: 'Prepared question', defaultOpen: true, onOpenActionId: 'ask', payloadFromState: { note: 'note' } } };
    }
    if (new URLSearchParams(location.search).has('signature')) {
      initial.artifacts[0].spec!.elements.body.children!.push('signature');
      initial.artifacts[0].spec!.elements.signature = { type: 'SignaturePad', props: { stateKey: 'signature', nameStateKey: 'name', label: 'Restored signature' } };
      initial.userStates[0].values.name = 'Test Signer';
    }
    if (new URLSearchParams(location.search).has('expanded')) initial.artifacts[0].placement = 'expanded';
    if (new URLSearchParams(location.search).has('widget')) Object.assign(initial.artifacts[0], {
      kind: 'widget', spec: null, bindings: {}, actions: {},
      widget: { hash: 'settle-widget', html: '<p>Secure widget ready</p><label>Widget note<input id="note" aria-label="Widget note"></label><script>harness.onUpdate(h => { document.getElementById("note").value = h.state.note || ""; });</script>', inputSchema: { type: 'object' }, stateSchema: { type: 'object' }, eventSchema: { type: 'object' }, stateSchemaVersion: 1 },
    });
    return initial;
  });
  const [visible, setVisible] = useState(restored), [fresh, setFresh] = useState(false), [generation, setGeneration] = useState(0);
  return <main style={{ maxWidth: 1040, margin: '0 auto', padding: 24 }}>
    <nav aria-label="Fixture controls">
      <button onClick={() => { setFresh(true); setVisible(true); }}>Publish artifact</button>
      <button onClick={() => setSnapshot(value => ({ ...value, seq: value.seq + 1, artifacts: value.artifacts.map(artifact => ({ ...artifact, revision: artifact.revision + 1 })) }))}>Publish snapshot</button>
      <button onClick={() => { setFresh(false); setGeneration(value => value + 1); setVisible(true); }}>Restore artifact</button>
      <button onClick={() => setVisible(false)}>Unmount artifact</button>
    </nav>
    <input aria-label="Conversation draft" defaultValue="Keep my conversation draft" />
    {visible && <Artifact key={generation} artifact={snapshot.artifacts[0]} snapshot={snapshot} theme="dark" animateEntry={fresh} refresh={async next => { if (next) setSnapshot(next); }} />}
    <p data-after-artifact>Conversation continues after the working object.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
