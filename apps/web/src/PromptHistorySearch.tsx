import {useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref, type RefObject} from 'react';
import {Search} from 'lucide-react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {searchPromptHistory, type PromptHistoryEntry} from './prompt-history';

export interface PromptHistorySearchHandle {keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean}
interface Props {
  ref?: Ref<PromptHistorySearchHandle>;
  input: RefObject<HTMLTextAreaElement | null>;
  open: boolean;
  entries: readonly PromptHistoryEntry[];
  titles: ReadonlyMap<string, string>;
  onClose(): void;
  onChoose(entry: PromptHistoryEntry): void;
}

const matches = (text: string, query: string) => {
  const hits: {text: string; hit: boolean}[] = [];
  let index = 0;
  for (;;) {
    const at = text.toLowerCase().indexOf(query, index);
    if (at < 0) { if (index < text.length) hits.push({text: text.slice(index), hit: false}); break; }
    if (at > index) hits.push({text: text.slice(index, at), hit: false});
    hits.push({text: text.slice(at, at + query.length), hit: true});
    index = at + query.length;
  }
  return hits;
};

/** Ctrl+R composer popover: substring search over collected prompt history. */
export function PromptHistorySearch({ref, input, open, entries, titles, onClose, onChoose}: Props) {
  const id = useId(), content = useRef<HTMLDivElement>(null), queryInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const rows = useMemo(() => searchPromptHistory(entries, query), [entries, query]);
  const selected = rows[Math.min(active, rows.length - 1)];

  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useLayoutEffect(() => {
    if (open) requestAnimationFrame(() => queryInput.current?.focus());
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const element = input.current;
    if (!element) return;
    element.setAttribute('aria-controls', id);
    if (selected) element.setAttribute('aria-activedescendant', `${id}-${selected.id}`);
    else element.removeAttribute('aria-activedescendant');
    content.current?.ownerDocument.getElementById(`${id}-${selected?.id}`)?.scrollIntoView({block: 'nearest'});
    return () => { element.removeAttribute('aria-controls'); element.removeAttribute('aria-activedescendant'); };
  }, [open, selected?.id, id, input, selected]);

  const nav = (direction: 1 | -1) => {
    if (!rows.length) return;
    setActive(previous => (previous + direction + rows.length) % rows.length);
  };
  const listKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!open || isComposing(event)) return false;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return true; }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      event.preventDefault(); nav(event.key === 'ArrowDown' ? 1 : -1); return true;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && selected) {
      event.preventDefault(); onChoose(selected); return true;
    }
    return false;
  };
  useImperativeHandle(ref, () => ({keyDown: listKeyDown}));

  if (!open) return null;
  return <Popover anchor={input} contentRef={content} open={open} width={600} height={Math.min(352, Math.max(110, rows.length * 42 + 76))} preferredSide="above" align="start" onDismiss={onClose} className="composer-command-popover prompt-history-popover">
    <div className="prompt-history-search">
      <Search size={13} aria-hidden="true"/>
      <input ref={queryInput} type="search" aria-label="Search prompts" placeholder="Search prompts…" value={query}
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (listKeyDown(event)) return; if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}/>
    </div>
    <div id={id} role="listbox" aria-label="Prompt history" className="composer-command-list">
      {rows.map((entry, index) => <div key={entry.id} id={`${id}-${entry.id}`} role="option" aria-selected={entry.id === selected?.id}
        className="composer-command-option" onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()} onClick={() => onChoose(entry)}>
        <span className="prompt-history-text">{query ? matches(entry.text.split('\n')[0], query.toLowerCase()).map((part, at) => part.hit ? <mark key={at} className="prompt-history-match">{part.text}</mark> : <span key={at}>{part.text}</span>) : entry.text.split('\n')[0]}</span>
        {!entry.current && titles.get(entry.threadId) ? <span className="composer-command-source">{titles.get(entry.threadId)}</span> : null}
      </div>)}
      {!rows.length && <div role="status" className="composer-command-status"><Search size={14}/>{entries.length ? 'No prompts match.' : 'No prompts in history yet.'}</div>}
    </div>
    <div className="composer-command-hint" aria-hidden="true">↑ ↓ Navigate <span>Enter Select · Esc Close</span></div>
  </Popover>;
}
