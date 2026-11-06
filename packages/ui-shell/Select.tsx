import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';
import { isComposing, useListNavigation } from './list-navigation';
import './controls.css';

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  'aria-label': string;
  id?: string;
  name?: string;
  form?: string;
  disabled?: boolean;
  required?: boolean;
}

export function Select({ value, onValueChange, options, 'aria-label': label, id, name, form, disabled, required }: SelectProps) {
  const anchor = useRef<HTMLButtonElement>(null), content = useRef<HTMLDivElement>(null);
  const native = useRef<HTMLSelectElement>(null), initial = useRef(value), change = useRef(onValueChange);
  change.current = onValueChange;
  const [open, setOpen] = useState(false);
  const listId = useId(), start = useRef<'selected' | 'last' | string>('selected');
  const selected = options.findIndex(option => option.value === value);
  const close = () => { setOpen(false); anchor.current?.focus(); };
  const choose = (index: number) => {
    if (disabled || !options[index] || options[index].disabled) return;
    close(); if (options[index].value !== value) onValueChange(options[index].value);
  };
  const navigation = useListNavigation(options, choose, close);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const owner = native.current?.form;
    const reset = (event: Event) => queueMicrotask(() => {
      if (event.defaultPrevented || !native.current) return;
      const next = [...native.current.options].find(option => option.value === initial.current)?.value ?? native.current.options[0]?.value ?? '';
      native.current.value = next; change.current(next); setOpen(false);
    });
    owner?.addEventListener('reset', reset);
    return () => owner?.removeEventListener('reset', reset);
  }, [form]);
  return <span className="ui-select">
    <button ref={anchor} id={id} type="button" role="combobox" aria-label={label} aria-expanded={open && !disabled}
      aria-controls={open ? listId : undefined} aria-haspopup="listbox" aria-required={required} disabled={disabled}
      className="ui-select-trigger" onClick={() => { start.current = 'selected'; navigation.reset(); setOpen(!open); }}
      onKeyDown={event => {
        if (isComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key.length === 1 && event.key !== ' ') {
          event.preventDefault(); navigation.reset(); start.current = event.key === 'ArrowUp' ? 'last' : event.key === 'ArrowDown' ? 'selected' : event.key;
          setOpen(true);
        }
      }}><span>{options[selected]?.label ?? ''}</span><ChevronDown size={14} aria-hidden="true" /></button>
    <select ref={native} className="ui-select-native" aria-hidden="true" tabIndex={-1} name={name} form={form} disabled={disabled} required={required}
      value={value} onChange={event => onValueChange(event.target.value)} onInvalid={() => anchor.current?.focus()}>
      {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
    <Popover anchor={anchor} contentRef={content} open={open && !disabled} width={280} height={Math.min(420, options.length * 36 + 26)} preferredSide="below"
      id={listId} role="listbox" aria-label={label} tabIndex={-1} className="ui-control-popup"
      onDismiss={() => setOpen(false)} onKeyDown={navigation.onKeyDown} onReady={() => {
        content.current?.focus();
        navigation.focus(start.current === 'last' ? navigation.edge(true) : selected >= 0 && !options[selected].disabled ? selected : navigation.edge());
        if (start.current !== 'selected' && start.current !== 'last') navigation.type(start.current, -1);
      }}>
      {options.map((option, index) => <button key={option.value} ref={node => { navigation.rows.current[index] = node; }}
        type="button" role="option" tabIndex={-1} aria-selected={option.value === value} disabled={option.disabled}
        className="ui-control-option" onFocus={() => navigation.onFocus(index)} onClick={() => choose(index)}>
        <span>{option.label}</span><Check size={14} aria-hidden="true" style={{ visibility: option.value === value ? 'visible' : 'hidden' }} />
      </button>)}
    </Popover>
  </span>;
}
