import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Popover } from './Popover';
import { isComposing, useListNavigation } from './list-navigation';
import './controls.css';

export interface ActionMenuItem {
  id: string;
  label: string;
  accessibleLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}
export interface ActionMenuProps {
  label: string;
  icon?: ReactNode;
  open: boolean;
  iconOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  items: readonly ActionMenuItem[];
}

export function ActionMenu({ label, icon, iconOnly, open, onOpenChange, disabled, items }: ActionMenuProps) {
  const anchor = useRef<HTMLButtonElement>(null), content = useRef<HTMLDivElement>(null);
  const id = useId(), start = useRef(false);
  const [fieldsetDisabled, setFieldsetDisabled] = useState(false);
  const effectivelyDisabled = Boolean(disabled || fieldsetDisabled);
  const changeOpen = useRef(onOpenChange); changeOpen.current = onOpenChange;
  useEffect(() => {
    const update = () => {
      const blocked = Boolean(anchor.current?.matches(':disabled'));
      setFieldsetDisabled(blocked);
      if (blocked) changeOpen.current(false);
    };
    const observer = new MutationObserver(update);
    for (let owner = anchor.current?.parentElement; owner; owner = owner.parentElement) {
      if (owner instanceof HTMLFieldSetElement) observer.observe(owner, { attributes: true, attributeFilter: ['disabled'] });
    }
    update(); return () => observer.disconnect();
  }, [disabled]);
  const close = () => { onOpenChange(false); anchor.current?.focus(); };
  const choose = (index: number) => {
    if (disabled || anchor.current?.matches(':disabled')) { onOpenChange(false); return; }
    if (items[index]?.disabled) return;
    close(); items[index]?.onSelect();
  };
  const navigation = useListNavigation(items, choose, close);
  return <>
    <button ref={anchor} type="button" className="ui-action-trigger" disabled={disabled} aria-label={iconOnly ? label : undefined}
      aria-haspopup="menu" aria-expanded={open && !effectivelyDisabled} aria-controls={open && !effectivelyDisabled ? id : undefined}
      onClick={() => { start.current = false; navigation.reset(); onOpenChange(!open); }}
      onKeyDown={event => {
        if (isComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); start.current = event.key === 'ArrowUp'; navigation.reset();
          if (open) navigation.focus(navigation.edge(start.current)); else onOpenChange(true);
        }
      }}>{icon}{!iconOnly && <>{label}<ChevronDown size={12} aria-hidden="true" /></>}</button>
    <Popover anchor={anchor} contentRef={content} open={open && !effectivelyDisabled} width={280} height={Math.min(420, items.length * 36 + 26)} preferredSide="below"
      id={id} role="menu" aria-label={label} tabIndex={-1} className="ui-control-popup"
      onDismiss={() => onOpenChange(false)} onKeyDown={navigation.onKeyDown}
      onReady={() => { content.current?.focus(); navigation.focus(navigation.edge(start.current)); }}>
      {items.map((item, index) => <button key={item.id} ref={node => { navigation.rows.current[index] = node; }}
        type="button" tabIndex={-1} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={item.checked} aria-label={item.accessibleLabel} disabled={item.disabled}
        className="ui-control-option" onFocus={() => navigation.onFocus(index)} onClick={() => choose(index)}>
        {item.icon}<span>{item.label}</span>{item.checked !== undefined && <Check size={14} aria-hidden="true" style={{ visibility: item.checked ? 'visible' : 'hidden' }} />}
      </button>)}
    </Popover>
  </>;
}
