import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelPicker } from '../../apps/web/src/ModelPicker';
import { useModalRegion } from '../../apps/web/src/focus';
import '../../apps/web/src/styles.css';

function Fixture() {
  const dialog = useRef<HTMLElement>(null);
  const large = new URLSearchParams(location.search).has('large');
  const aria = new URLSearchParams(location.search).has('aria');
  const [open, setOpen] = useState(true);
  const [model, setModel] = useState(large ? 'model-99' : 'model-a');
  useModalRegion(dialog, aria && open, () => setOpen(false), 'input');
  useEffect(() => { if (!aria) (dialog.current as HTMLDialogElement)?.showModal(); }, [aria]);
  const content = <>
    <header><h2>Fixture settings</h2></header>
    <input aria-label="Preserved draft" defaultValue="Keep this draft" />
    <div className="composer-toolbar"><ModelPicker models={large ? Array.from({ length: 100 }, (_, index) => ({
      id: `model-${index}`, provider: 'openai', name: `Catalog model ${index}`,
    })) : [
      { id: 'model-a', provider: 'openai', name: 'Model A' },
      { id: 'model-b', provider: 'openai', name: 'Model B' },
    ]} modelId={model} onChange={setModel} /></div>
  </>;
  return <>
    <button type="button">Background control</button>
    {open && (aria
      ? <section ref={element => { dialog.current = element; }} role="dialog" aria-modal="true" aria-label="Fixture settings" className="dialog" style={{ position: 'fixed', top: 80, left: 60 }}>{content}</section>
      : <dialog ref={element => { dialog.current = element; }} className="dialog" aria-label="Fixture settings">{content}</dialog>)}
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
