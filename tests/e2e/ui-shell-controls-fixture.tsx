import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceControls } from '../../apps/web/src/WorkspaceControls';
import { GrantedFiles } from '../../apps/web/src/WorkspacePanelBodies';
import { ActionMenu } from '../../packages/ui-shell/ActionMenu';
import { Select } from '../../packages/ui-shell/Select';
import { Modal } from '../../packages/ui-shell/Modal';
import type { Snapshot } from '../../packages/contracts';
import type { WorkspaceEnvelope } from '../../packages/contracts/workspace';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/workspace-canvas.css';

const envelope: WorkspaceEnvelope = { projects: [], state: {
  version: 1, revision: 1, activeCanvasId: 'main', disabledKinds: [], integrations: {}, profiles: [],
  canvases: [{ version: 1, id: 'main', name: 'Workspace', preset: 'workspace', viewport: { x: 0, y: 0, zoom: 1 }, panels: [], filter: 'all', projectIds: [] }],
} };
const snapshot = { resources: [
  { id: 'one', threadId: 'thread', label: 'Alpha grant' },
  { id: 'two', threadId: 'thread', label: 'Beta grant' },
] } as Snapshot;

function Fixture() {
  const query = new URLSearchParams(location.search);
  const [action, setAction] = useState('');
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [value, setValue] = useState(query.has('required') ? '' : 'c');
  const [disabled, setDisabled] = useState(false);
  const large = query.has('large');
  const controls = <>
    <form id="controls-form" onSubmit={event => { event.preventDefault(); setAction(JSON.stringify([...new FormData(event.currentTarget)])); }}>
      <fieldset data-testid="choice-fieldset" style={{ padding: 0, border: 0 }}><Select aria-label="Choice" aria-invalid={query.has('controlled-invalid') || undefined} name="choice" required={query.has('required')} value={large ? value === 'c' ? '99' : value : value} onValueChange={setValue} disabled={disabled}
        options={large ? Array.from({ length: 100 }, (_, index) => ({ value: String(index), label: `Option ${index}` })) : [
          ...(query.has('required') ? [{ value: '', label: 'Choose an option' }] : []), { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta unavailable', disabled: true },
          { value: 'c', label: 'Charlie' }, { value: 'd', label: 'Delta' },
        ]} /></fieldset>
      <input aria-label="Following field" defaultValue="Keep draft" />
      <button type="submit">Submit choice</button><button type="reset">Reset choice</button>
    </form>
    <fieldset data-testid="action-fieldset" style={{ padding: 0, border: 0 }}><ActionMenu label="Actions" open={menu} onOpenChange={setMenu} items={[
      { id: 'disabled', label: 'Unavailable', disabled: true, onSelect: () => setAction('wrong') },
      { id: 'alpha', label: 'Alpha', onSelect: () => setAction('alpha') },
      { id: 'delta', label: 'Delta', checked: true, onSelect: () => setAction('delta') },
    ]} /></fieldset>
    <button type="button" onClick={() => setDisabled(!disabled)}>Toggle disabled</button>
    <output aria-label="Result">{action}</output>
  </>;
  if (query.has('primitives')) return <main style={{ padding: '60px 16px' }}>
    <button type="button" onClick={() => setOpen(true)}>Open controls dialog</button>
    {query.has('modal') ? <Modal title="Controls dialog" open={open} onClose={() => setOpen(false)}>{controls}</Modal> : controls}
    <button type="button" style={{ position: 'fixed', right: 16, bottom: 16 }}>Background action</button>
  </main>;
  return <main style={{ padding: '60px 16px 16px' }}>
    <WorkspaceControls envelope={envelope} prepare={async () => {}} send={async () => envelope}
      panels={[]} title={panel => panel.id} updatePanel={async () => {}}
      addPanel={async kind => { if (new URLSearchParams(location.search).has('failure')) throw Error('The owner rejected this tool.'); setAction(kind); }} />
    <output aria-label="Last tool">{action}</output>
    <GrantedFiles snapshot={snapshot} threadId="thread" />
    <button type="button">After controls</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
