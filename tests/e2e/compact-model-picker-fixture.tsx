import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelPicker } from '../../apps/web/src/ModelPicker';
import { Modal } from '../../packages/ui-shell/Modal';
import { useModalRegion } from '../../apps/web/src/focus';
import type { ModelInfo } from '../../packages/contracts';
import '../../apps/web/src/styles.css';

const catalog: ModelInfo[] = [
  { id: 'openai/alpha', provider: 'openai', name: 'Alpha', thinkingLevels: ['low', 'high', 'xhigh', 'ultra', 'high'] },
  { id: 'openai/beta', provider: 'openai', name: 'Same name', thinkingLevels: ['medium', 'max'] },
  { id: 'claude-code/beta', provider: 'claude-code', name: 'Same name' },
];
function Fixture() {
  const params = new URLSearchParams(location.search), large = params.has('large');
  const [models, setModels] = useState<ModelInfo[]>(large ? Array.from({ length: 100 }, (_, i) => ({
    id: `openai/catalog-${i}`, provider: 'openai', name: `Catalog model ${i}`, thinkingLevels: ['low', 'high'],
  })) : catalog);
  const [model, setModel] = useState(large ? 'openai/catalog-99' : 'openai/alpha');
  const [effort, setEffort] = useState('high'), [locked, setLocked] = useState(false), [open, setOpen] = useState(true);
  const region = useRef<HTMLElement>(null);
  useModalRegion(region, params.has('aria') && open, () => setOpen(false), 'input');
  Object.assign(window, { updateModelCatalog: setModels });
  const content = <>
    <input aria-label="Preserved draft" defaultValue="Keep this draft" />
    <button type="button" onClick={() => setLocked(value => !value)}>Toggle working</button>
    <div className="composer-toolbar"><ModelPicker models={models} modelId={model} thinkingLevel={effort}
      disabled={locked} onChange={id => { setModel(id); setEffort(''); }}
      onThinkingChange={params.has('standalone') ? undefined : setEffort} /></div>
    <output aria-label="Committed choice">{model}|{effort}</output>
  </>;
  return <main style={{ height: '100dvh', display: 'flex', alignItems: 'end', justifyContent: 'end', padding: 16 }}>
    <button type="button" style={{ position: 'absolute', left: 8, top: 60 }}>Outside</button>
    {params.has('native') ? <Modal open={open} title="Picker owner" onClose={() => setOpen(false)}>{content}</Modal>
      : params.has('aria') ? open && <section ref={region} role="dialog" aria-modal="true" aria-label="Picker owner" className="dialog">{content}</section>
      : <section>{content}</section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
