import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ModelInfo } from '../../../packages/contracts';
import { SUBSCRIPTION_CONNECTIONS } from '../../../packages/contracts/connections';
import './model-picker.css';

interface ModelPickerProps {
  models: ModelInfo[];
  modelId: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}
const providerLabel = (provider: string) => SUBSCRIPTION_CONNECTIONS.find(connection => connection.id === provider)?.label ?? provider;

export function ModelPicker({ models, modelId, onChange, disabled = false }: ModelPickerProps) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popover = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [present, setPresent] = useState(false), [query, setQuery] = useState(''), [activeId, setActiveId] = useState(modelId);
  const [position, setPosition] = useState<{ style: CSSProperties; side: 'above' | 'below' }>({ style: {}, side: 'above' });
  const selected = models.find(model => model.id === modelId), locked = disabled || !models.length;
  const groups = useMemo(() => {
    const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean), result = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const source = `${model.name} ${model.id} ${providerLabel(model.provider)}`.toLocaleLowerCase();
      if (!tokens.every(token => source.includes(token))) continue;
      const group = result.get(model.provider) ?? []; group.push(model); result.set(model.provider, group);
    }
    return [...result.entries()];
  }, [models, query]);
  const visible = groups.flatMap(([, group]) => group), active = visible.find(model => model.id === activeId) ?? visible[0];
  const optionId = (model: ModelInfo) => `${id}-option-${models.indexOf(model)}`;

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function show() {
    if (locked) return;
    setQuery(''); setActiveId(modelId); setPresent(true); setOpen(true);
  }
  function choose(model: ModelInfo) {
    if (locked) return;
    onChange(model.id); close(true);
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { close(true); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (active) choose(active); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = visible.findIndex(model => model.id === active?.id), count = visible.length;
    if (!count) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
    setActiveId(visible[next].id);
  }

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const width = Math.min(320, window.innerWidth - 24), above = anchor.top - 20, below = window.innerHeight - anchor.bottom - 20;
      const side = above >= Math.min(280, below) ? 'above' : 'below';
      const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
      setPosition({ side, style: { width, left: `clamp(12px, ${left}px, calc(100vw - ${width + 12}px))`, maxHeight: `min(${Math.min(400, Math.max(120, side === 'above' ? above : below))}px, calc(100dvh - 24px))`, ...(side === 'above' ? { bottom: window.innerHeight - anchor.top + 8 } : { top: anchor.bottom + 8 }) } });
    }
    place(); search.current?.focus();
    const onScroll = (event: Event) => { if (!popover.current?.contains(event.target as Node)) place(); };
    const observer = new ResizeObserver(place); if (trigger.current) observer.observe(trigger.current); const toolbar = trigger.current?.closest('.composer-toolbar'); if (toolbar) observer.observe(toolbar);
    window.addEventListener('resize', place); window.addEventListener('scroll', onScroll, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', onScroll, true); };
  }, [open]);
  useEffect(() => {
    if (open || !present) return;
    const timeout = window.setTimeout(() => setPresent(false), 110);
    return () => window.clearTimeout(timeout);
  }, [open, present]);
  useEffect(() => { if (locked) setOpen(false); }, [locked]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { const target = event.target as Node; if (!trigger.current?.contains(target) && !popover.current?.contains(target)) close(); };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [open]);
  useEffect(() => {
    if (open && active) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [open, active?.id]);

  return <>
    <button ref={trigger} type="button" role="combobox" aria-label="Model" aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-list`} disabled={locked}
      className="composer-tool model-picker-trigger" title={disabled ? 'Wait for the active run to finish to change models' : selected?.name ?? (modelId || 'Select model')}
      onClick={() => open ? close(true) : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); if (open) search.current?.focus(); else show(); } }}>
      <span>{selected?.name ?? (modelId || 'Select model')}</span><ChevronDown size={12} data-open={open} />
    </button>
    {present && createPortal(<div ref={popover} className="model-picker-popover" data-state={open ? 'open' : 'closed'} data-side={position.side} style={position.style} aria-hidden={!open} inert={!open}>
      <div className="model-picker-search"><Search size={15} aria-hidden="true" /><input ref={search} type="search" aria-label="Search models" placeholder="Search models…" value={query} autoComplete="off" spellCheck={false}
        aria-controls={`${id}-list`} aria-activedescendant={active ? optionId(active) : undefined} onChange={event => { setQuery(event.target.value); setActiveId(modelId); }} onKeyDown={navigate} /><kbd aria-hidden="true">Esc</kbd></div>
      <div id={`${id}-list`} role="listbox" aria-label="Available models" className="model-picker-list">
        {groups.map(([provider, group]) => <div role="group" aria-label={providerLabel(provider)} className="model-picker-group" key={provider}>
          <div className="model-picker-provider" aria-hidden="true">{providerLabel(provider)}</div>
          {group.map(model => <div id={optionId(model)} role="option" aria-label={model.name} aria-selected={model.id === modelId} data-active={model.id === active?.id} className="model-picker-option" key={model.id}
            onPointerMove={() => setActiveId(model.id)} onMouseDown={event => event.preventDefault()} onClick={() => choose(model)}>
            <span>{model.name}</span>{model.id === modelId && <Check className="model-picker-check" size={15} aria-hidden="true" />}
          </div>)}
        </div>)}
      </div>
      {!visible.length && <p className="model-picker-empty" role="status">No models found<span>Try a model or provider name.</span></p>}
      <div className="model-picker-footnote">Models available to this task</div>
    </div>, document.body)}
  </>;
}
