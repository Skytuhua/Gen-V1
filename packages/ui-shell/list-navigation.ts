import { useRef, type KeyboardEvent } from 'react';

export interface ListEntry { label: string; disabled?: boolean }

export function isComposing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

// Menu and select share navigation; Popover retains placement and Escape ownership.
export function useListNavigation(items: readonly ListEntry[], choose: (index: number) => void, close: () => void) {
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const search = useRef({ text: '', time: 0 });
  const active = useRef(-1);
  const focus = (index: number) => {
    if (index < 0 || !items[index] || items[index].disabled) return;
    active.current = index;
    rows.current[index]?.focus({ preventScroll: true });
    rows.current[index]?.scrollIntoView({ block: 'nearest' });
  };
  const edge = (last = false) => last ? items.findLastIndex(item => !item.disabled) : items.findIndex(item => !item.disabled);
  const type = (key: string, from = active.current) => {
    const now = Date.now();
    search.current = { text: now - search.current.time > 700 ? key : search.current.text + key, time: now };
    const text = search.current.text.toLocaleLowerCase();
    const prefix = [...text].every(letter => letter === text[0]) ? text[0] : text;
    for (let step = 1; step <= items.length; step++) {
      const index = (from + step + items.length) % items.length;
      if (!items[index].disabled && items[index].label.toLocaleLowerCase().startsWith(prefix)) { focus(index); break; }
    }
  };
  return { rows, focus, edge, type, reset: () => { search.current = { text: '', time: 0 }; },
    onFocus: (index: number) => { active.current = index; },
    onKeyDown: (event: KeyboardEvent) => {
      if (isComposing(event)) { if (event.key === 'Escape') event.preventDefault(); return; }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const index = rows.current.indexOf(event.target as HTMLButtonElement);
      if (index >= 0) active.current = index;
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); focus(edge(event.key === 'End')); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        for (let step = 1; step <= items.length; step++) {
          const next = (active.current + direction * step + items.length) % items.length;
          if (!items[next].disabled) { focus(next); break; }
        }
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (active.current >= 0 && !items[active.current]?.disabled) choose(active.current);
      } else if (event.key.length === 1) { event.preventDefault(); type(event.key); }
    },
  };
}
