import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Folder, FolderPlus, Palette, Search } from 'lucide-react';
import type { ProjectSummary, WorkspaceAuthority } from '../../../packages/contracts/workspace';
import { projectColorSchema } from '../../../packages/contracts/preferences';
import { Modal } from '../../../packages/ui-shell/Modal';
import { Popover } from '../../../packages/ui-shell/Popover';
import { isComposing } from '../../../packages/ui-shell/list-navigation';
import { PROJECT_PALETTE, projectColor, projectColorKey } from './project-colors';
import './project-picker.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

export interface ProjectPickerProps {
  open: boolean;
  authority: WorkspaceAuthority;
  projects: readonly ProjectSummary[];
  selectedProjectId?: string;
  recentProjectIds?: readonly string[];
  colors: Record<string, string>;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSelect: (project: ProjectSummary | null) => void | Promise<void>;
  onAddProject: () => void | Promise<void>;
  onColorChange: (project: ProjectSummary, color: string | null) => void | Promise<void>;
}

// Controllers supply authorized projects and own creation, connection and persistence.
export function ProjectPicker(props: ProjectPickerProps) {
  return props.open ? <ProjectPickerDialog {...props} /> : null;
}

function ProjectPickerDialog({ authority, projects, selectedProjectId, recentProjectIds = [], colors, busy = false, error,
  onClose, onSelect, onAddProject, onColorChange }: ProjectPickerProps) {
  const id = useId(), search = useRef<HTMLInputElement>(null), list = useRef<HTMLDivElement>(null);
  const colorAnchor = useRef<HTMLButtonElement>(null), colorInput = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [working, setWorking] = useState(false), [failure, setFailure] = useState('');
  const [query, setQuery] = useState(''), [activeKey, setActiveKey] = useState(selectedProjectId ? projectColorKey(authority, selectedProjectId) : '');
  const [colorKey, setColorKey] = useState<string | null>(null), [custom, setCustom] = useState(''), [colorError, setColorError] = useState('');
  const locked = busy || working;
  const choices = useMemo(() => {
    const scoped = projects.filter(project => projectColorKey(project.authority, project.id) === projectColorKey(authority, project.id));
    const rank = (project: ProjectSummary) => { const index = recentProjectIds.indexOf(project.id); return index < 0 ? Infinity : index; };
    const ordered = [...scoped].sort((a, b) => rank(a) - rank(b));
    const all: (ProjectSummary | null)[] = authority.kind === 'local' ? [null, ...ordered] : ordered;
    const terms = query.trim().toLowerCase().split(/\s+/);
    return all.filter(project => terms.every(term => `${project?.name ?? 'No project'} ${project?.rootPath ?? ''} ${project?.repository ?? ''}`.toLowerCase().includes(term)));
  }, [projects, authority, recentProjectIds, query]);
  const keyOf = (project: ProjectSummary | null) => project ? projectColorKey(project.authority, project.id) : '';
  const activeIndex = Math.max(0, choices.findIndex(project => keyOf(project) === activeKey));
  const active = choices[activeIndex];
  const activeIdentity = choices.length ? keyOf(active) : undefined;
  const choiceOrder = choices.map(keyOf).join('\n');
  const editing = choices.find(project => project && keyOf(project) === colorKey);
  const optionId = (index: number) => `${id}-project-${index}`;

  useLayoutEffect(() => { search.current?.focus({ preventScroll: true }); }, []);

  useLayoutEffect(() => {
    const container = list.current, row = container?.children[activeIndex] as HTMLElement | undefined;
    if (!container || !row) return;
    if (row.offsetTop < container.scrollTop) container.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = row.offsetTop + row.offsetHeight - container.clientHeight;
  }, [activeIndex, activeIdentity, choiceOrder]);

  const run = async (action: () => void | Promise<void>, color = false) => {
    if (busy || pending.current) return;
    pending.current = true; setWorking(true); setFailure(''); setColorError('');
    try { await action(); }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); if (color) setColorError(message); else setFailure(message); }
    finally { pending.current = false; setWorking(false); }
  };
  const closeColor = () => { if (!pending.current && !busy) { setColorKey(null); colorAnchor.current?.focus(); } };
  const saveColor = (value: string | null) => {
    if (!editing || locked) return;
    if (value !== null && !projectColorSchema.safeParse(value).success) { setColorError('Choose a six-digit hex color, such as #4F6EFF.'); return; }
    void run(async () => { await onColorChange(editing, value); setColorKey(null); colorAnchor.current?.focus(); }, true);
  };

  return <Modal open title="Select project" className="project-picker" onClose={() => { if (!busy && !pending.current) onClose(); }}>
    <div className="project-picker-search"><Search size={16} aria-hidden="true" /><input ref={search} type="text" role="combobox" aria-label="Search projects"
      aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={choices.length ? optionId(activeIndex) : undefined}
      placeholder="Search projects" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (isComposing(event)) { if (event.key === 'Escape') event.preventDefault(); return; }
        if (event.altKey || event.ctrlKey || event.metaKey || locked) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (choices.length) setActiveKey(keyOf(choices[(activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]));
        } else if (event.key === 'Enter') {
          event.preventDefault(); if (choices.length) void run(() => onSelect(active));
        }
      }} /></div>
    <div ref={list} id={`${id}-list`} role="listbox" aria-label="Projects" aria-busy={locked} className="project-picker-list">
      {choices.map((project, index) => {
        const key = keyOf(project), selected = project ? selectedProjectId === project.id : !selectedProjectId;
        return <button type="button" role="option" tabIndex={-1} key={key} id={optionId(index)} aria-label={project?.name ?? 'No project'}
          aria-selected={selected} data-active={index === activeIndex} disabled={locked} className="project-picker-option"
          onClick={() => { setActiveKey(key); void run(() => onSelect(project)); }}>
          {project ? <span className="project-picker-dot" style={{ backgroundColor: projectColor(project.authority, project.id, colors) }} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />}
          <span className="project-picker-label"><span>{project?.name ?? 'No project'}</span>{project && <small>{project.rootPath ?? project.repository}</small>}</span>
          {project && recentProjectIds.includes(project.id) && <small className="project-picker-recent">Recent</small>}
          {selected && <Check size={14} aria-hidden="true" />}
        </button>;
      })}
    </div>
    {!choices.length && <p className="project-picker-empty">{query ? 'No matching projects.' : 'No connected projects.'}</p>}
    {(failure || error) && <ErrorState className="project-picker-error" message={failure || error || ''}/>}
    <footer className="project-picker-footer">
      <button type="button" disabled={locked} onClick={() => void run(onAddProject)}><FolderPlus size={15} />Add project</button>
      {active && <button type="button" ref={colorAnchor} disabled={locked} aria-label={`Color for ${active.name}`} aria-expanded={Boolean(editing)} onClick={() => {
        setColorKey(keyOf(active)); setCustom(projectColor(active.authority, active.id, colors) ?? ''); setColorError('');
      }}><Palette size={15} /><span>Color</span></button>}
      <button type="button" disabled={locked} onClick={onClose}>Cancel</button>
    </footer>
    <p className="project-picker-hint">↑↓ navigate · Enter select · Esc cancel</p>
    <Popover anchor={colorAnchor} open={Boolean(editing)} width={280} height={230} initialFocus={colorInput} onDismiss={closeColor}
      role="group" aria-label="Project color" className="ui-control-popup project-picker-colors" onKeyDown={event => {
        if (isComposing(event) && event.key === 'Escape') { event.preventDefault(); return; }
        if (event.key === 'Escape' && locked) { event.preventDefault(); event.stopPropagation(); }
      }}>
      <div className="project-picker-swatches">{Object.entries(PROJECT_PALETTE).map(([name, value]) => <button type="button" key={name} disabled={locked} aria-label={name}
        aria-pressed={Boolean(editing && colors[projectColorKey(editing.authority, editing.id)]?.toLowerCase() === value.toLowerCase())} onClick={() => saveColor(value)}>
        <span style={{ backgroundColor: value }} aria-hidden="true" /></button>)}</div>
      <form onSubmit={event => { event.preventDefault(); saveColor(custom); }}><label>Custom color<input ref={colorInput} aria-label="Custom color" value={custom} maxLength={80} disabled={locked}
        onChange={event => { setCustom(event.target.value); setColorError(''); }} onKeyDown={event => { if (isComposing(event) && event.key === 'Enter') event.preventDefault(); }} placeholder="#4F6EFF" spellCheck={false} /></label>
        <button type="submit" disabled={locked}>Save color</button></form>
      {colorError && <ErrorState className="project-picker-error" message={colorError}/>}
      <button type="button" disabled={locked} onClick={() => saveColor(null)}>Use automatic color</button>
    </Popover>
  </Modal>;
}
