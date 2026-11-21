import {useEffect, useRef, useState} from 'react';
import {CircleAlert, Search, X} from 'lucide-react';
import {Modal} from '../../../packages/ui-shell/Modal';
import {Spinner} from '../../../packages/ui-shell/Feedback';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {
  COMMAND_GROUP_LABEL, groupCommands, normalize, rankCommands, readRecent, writeRecent,
  type CommandGroup, type CommandItem,
} from './command-menu';
import './command-menu.css';

export interface CommandResults {items: CommandItem[]; pending: boolean; error: string; retry(): void}
type Row = Omit<CommandItem, 'group'> & {group: CommandGroup};

export function CommandMenu(props: {
  open: boolean;
  onClose(): void;
  commands: readonly CommandItem[];
  threadResults?: (query: string) => CommandResults;
  skillResults?: (query: string) => CommandResults;
  chord(bindingId: string): string | undefined;
  reportError(error: unknown): void;
}) {
  const {open, onClose, commands, threadResults, skillResults, chord, reportError} = props;
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const list = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const announce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const storage = (): Pick<Storage, 'getItem' | 'setItem'> => {
    try { return localStorage; } catch { return {getItem: () => null, setItem: () => undefined}; }
  };

  const searching = query.trim().length > 0;
  const threadState = searching ? threadResults?.(query) : undefined;
  const skillState = searching ? skillResults?.(query) : undefined;
  const threads = threadState?.items ?? [];
  const skills = skillState?.items ?? [];

  const recent: Row[] = searching ? [] :
    readRecent(storage())
      .map(id => commands.find(command => command.id === id && !command.disabledReason))
      .filter((command): command is CommandItem => Boolean(command))
      .map(command => ({...command, group: 'recent'}));
  const rows: Row[] = searching ?
    rankCommands(query, [...commands, ...threads, ...skills]) :
    [...recent, ...commands];
  const grouped = groupCommands(rows);

  const enabled = rows.filter(row => !row.disabledReason);
  const active = rows.find(row => row.id === activeId) ?? enabled[0];
  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const at = Math.max(0, enabled.findIndex(row => row.id === active?.id));
    setActiveId(enabled[(at + delta + enabled.length) % enabled.length].id);
  };
  const edge = (last: boolean) => {if (enabled.length > 0) setActiveId(enabled[last ? enabled.length - 1 : 0].id);};

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveId('');
    setAnnouncement('');
    // The modal's showModal() focuses its first control (the in-flow close
    // button); reclaim the search box on the next frame per the plan.
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!searching) {setActiveId(current => rows.some(row => row.id === current && !row.disabledReason) ? current : enabled[0]?.id ?? ''); return;}
    setActiveId(enabled[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset active row on every query change
  }, [query]);

  useEffect(() => {
    clearTimeout(announce.current);
    announce.current = setTimeout(() => setAnnouncement(rows.length === 0 ? 'No results' : `${rows.length} results`), 300);
    return () => clearTimeout(announce.current);
  }, [query, rows.length]);

  useEffect(() => {
    list.current?.querySelector(`[data-command-id="${CSS.escape(active?.id ?? '')}"]`)?.scrollIntoView({block: 'nearest'});
  }, [active?.id]);

  const runCommand = (item: Row) => {
    if (item.disabledReason) return;
    if (item.remember !== false) writeRecent(storage(), item.id);
    onClose();
    requestAnimationFrame(() => {Promise.resolve(item.run()).catch(reportError);});
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (isComposing(event)) return;
    if (event.key === 'ArrowDown') {event.preventDefault(); move(1);}
    else if (event.key === 'ArrowUp') {event.preventDefault(); move(-1);}
    else if (event.key === 'PageDown') {event.preventDefault(); move(8);}
    else if (event.key === 'PageUp') {event.preventDefault(); move(-8);}
    else if (event.key === 'Home' && event.ctrlKey) {event.preventDefault(); edge(false);}
    else if (event.key === 'End' && event.ctrlKey) {event.preventDefault(); edge(true);}
    else if (event.key === 'Enter' && active) {event.preventDefault(); runCommand(active);}
  };

  const matched = (label: string) => {
    const terms = normalize(query).split(' ').filter(word => word.length > 0);
    if (terms.length === 0) return label;
    const lower = normalize(label);
    const marks = new Set<number>();
    for (const word of terms) {
      let at = 0;
      while ((at = lower.indexOf(word, at)) >= 0) {
        for (let i = at; i < at + word.length; i += 1) marks.add(i);
        at += word.length;
      }
    }
    if (marks.size === 0) return label;
    const parts: {text: string; hit: boolean}[] = [];
    let hit = marks.has(0), start = 0;
    for (let i = 1; i <= label.length; i += 1) {
      const now = i < label.length && marks.has(i);
      if (now === hit) continue;
      parts.push({text: label.slice(start, i), hit});
      hit = now;
      start = i;
    }
    return <>{parts.map((part, index) => part.hit ? <b key={index}>{part.text}</b> : part.text)}</>;
  };

  const row = (item: Row) => (
    <div
      key={`${item.group}:${item.id}`}
      data-command-id={item.id}
      role="option"
      aria-selected={item.id === active?.id}
      aria-disabled={Boolean(item.disabledReason)}
      className={`command-menu-row${item.id === active?.id ? ' active' : ''}${item.disabledReason ? ' disabled' : ''}`}
      onPointerMove={() => {if (item.id !== active?.id) setActiveId(item.id);}}
      onClick={() => runCommand(item)}
    >
      {item.icon ? <item.icon size={16} aria-hidden="true"/> : <span className="command-menu-icon-blank"/>}
      <span className="command-menu-label">{matched(item.label)}</span>
      {item.detail || item.disabledReason ? <span className="command-menu-detail">{item.disabledReason ?? item.detail}</span> : null}
      {item.bindingId && chord(item.bindingId) ? <kbd className="ui-control-shortcut" aria-hidden="true">{chord(item.bindingId)}</kbd> : null}
    </div>
  );

  const groupState = (results: CommandResults | undefined, group: CommandGroup, label: string) => {
    if (!results || !searching || rows.some(entry => entry.group === group)) return null;
    if (results.pending) return <div role="status" className="command-menu-row status"><Spinner size={13}/>{label}</div>;
    if (results.error) return (
      <div className="command-menu-row error">
        <CircleAlert size={16} aria-hidden="true"/>
        <span className="command-menu-detail">{results.error}</span>
        <button type="button" className="command-menu-retry" onClick={results.retry}>Retry</button>
      </div>
    );
    return null;
  };

  const pending = Boolean(threadState?.pending || skillState?.pending);

  return (
    <Modal open={open} title="Command menu" onClose={onClose} className="command-menu-dialog">
      <div className="command-root" onKeyDown={onKeyDown}>
        <div className="command-menu-search">
          <Search size={16} aria-hidden="true"/>
          <input
            ref={search}
            type="text"
            value={query}
            placeholder="Search commands and threads…"
            aria-label="Search commands"
            onChange={event => setQuery(event.target.value)}
          />
          {query.length > 0 && (
            <button type="button" className="command-menu-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>
          )}
        </div>
        <div className="command-menu-list" role="listbox" aria-label="Commands" ref={list}>
          {grouped.map(({group, items}) => (
            <div key={group} role="group" aria-label={COMMAND_GROUP_LABEL[group]}>
              <div className="command-menu-heading">{COMMAND_GROUP_LABEL[group]}</div>
              {items.map(row)}
              {groupState(threadState, 'threads', 'Searching threads…')}
              {groupState(skillState, 'skills', 'Searching skills…')}
            </div>
          ))}
          {!grouped.some(({group}) => group === 'threads') && groupState(threadState, 'threads', 'Searching threads…')}
          {!grouped.some(({group}) => group === 'skills') && groupState(skillState, 'skills', 'Searching skills…')}
          {searching && rows.length === 0 && !pending && !threadState?.error && !skillState?.error && (
            <div className="command-menu-empty">
              <div className="command-menu-empty-title">No results for “{query.trim()}”</div>
              <div className="command-menu-empty-hint">Try a different word, or press Esc to close.</div>
            </div>
          )}
        </div>
        <div role="status" aria-live="polite" className="visually-hidden">{announcement}</div>
        <div className="command-menu-footer"><kbd>↑↓</kbd> to move · <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to close</div>
      </div>
    </Modal>
  );
}
