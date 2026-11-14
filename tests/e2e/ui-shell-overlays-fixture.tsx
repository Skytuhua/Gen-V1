import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelPicker } from '../../apps/web/src/ModelPicker';
import { useModalRegion } from '../../apps/web/src/focus';
import { Modal } from '../../packages/ui-shell/Modal';
import { Popover } from '../../packages/ui-shell/Popover';
import '../../apps/web/src/styles.css';

function RetentionFixture({ mode }: { mode: string }) {
  const [disabled, setDisabled] = useState(false);
  const [popOpen, setPopOpen] = useState(mode === 'popover');
  const [popDisabled, setPopDisabled] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (mode === 'popover') return <>
    <button type="button" ref={anchor} onClick={() => setPopOpen(true)}>Open popover</button>
    <button type="button">Background control</button>
    <Popover anchor={anchor} open={popOpen} width={240} height={120} onDismiss={() => setPopOpen(false)}>
      <button type="button" disabled={popDisabled} onClick={() => setPopDisabled(true)}>Disable popup action</button>
      <button type="button">Popup safe</button>
    </Popover>
  </>;
  return <Modal open title="Retention dialog" onClose={() => {}}>
    <button type="button" disabled={disabled} onClick={() => setDisabled(true)}>Disable me</button>
    <button type="button">Safe control</button>
  </Modal>;
}

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

const retention = new URLSearchParams(location.search).get('retention');
createRoot(document.getElementById('root')!).render(retention ? <RetentionFixture mode={retention}/> : <Fixture />);
