import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import type { SidebarSectionV1 } from '../../../packages/contracts/sidebar-sections';
import type { ThreadNavigationRow as Thread } from '../../../packages/contracts/shell-read-models';
import { ActionMenu } from '../../../packages/ui-shell/ActionMenu';

const isWorking = (item: Thread) => Boolean(item.runId) || item.status === 'working' || item.status === 'awaiting_input';

/** Members of each user section in R04 precedence order, sorted for display. */
export function useSidebarSections(sections: SidebarSectionV1[] | undefined, rows: Thread[], showWorking: boolean) {
  return useMemo(() => {
    const map = new Map<string, Thread[]>();
    if (!sections) return map;
    const members = (section: SidebarSectionV1) => rows
      .filter(item => !item.presentation?.pinned && item.presentation?.sectionId === section.id && !(showWorking && isWorking(item)) && !item.presentation?.settled)
      .sort((a, b) => (a.presentation?.order ?? 0) - (b.presentation?.order ?? 0) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    for (const section of sections) map.set(section.id, members(section));
    return map;
  }, [sections, rows, showWorking]);
}

/** Inline name field shared by the rename state and the New section ghost row. */
export function SectionNameField({ initial, error, onCommit, onCancel }: { initial: string; error: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial), composing = useRef(false);
  const submit = (event: FormEvent) => { event.preventDefault(); if (!composing.current) onCommit(name); };
  return (
    <form className="sidebar-section-name" onSubmit={submit}>
      <input
        autoFocus aria-label="Section name" value={name} maxLength={60}
        aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'sidebar-section-name-error' : undefined}
        onChange={event => setName(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if (event.key === 'Escape' && !composing.current) { event.preventDefault(); event.stopPropagation(); onCancel(); } }}
        onBlur={() => { if (!error) onCancel(); }}
      />
      {error && <p id="sidebar-section-name-error" className="sidebar-section-name-error" aria-live="polite">{error}</p>}
    </form>
  );
}

export function SectionHeader({ section, count, expanded, menuOpen, onMenuOpenChange, onToggle, onRename, onMove, onDelete, canMoveUp, canMoveDown, editing, nameError, onSubmitName, onCancelName }: {
  section: SidebarSectionV1; count: number; expanded: boolean;
  menuOpen: boolean; onMenuOpenChange: (open: boolean) => void;
  onToggle: () => void; onRename: () => void; onMove: (delta: -1 | 1) => void; onDelete: () => void;
  canMoveUp: boolean; canMoveDown: boolean;
  editing: boolean; nameError: string; onSubmitName: (name: string) => void; onCancelName: () => void;
}) {
  return (
    <h2 data-section-header={`section:${section.id}`} aria-expanded={expanded}>
      <button type="button" aria-expanded={expanded} onClick={onToggle} aria-label={`${section.name}, ${count} ${count === 1 ? 'thread' : 'threads'}`}>
        <ChevronRight size={11} />
        {editing ? <SectionNameField initial={section.name} error={nameError} onCommit={onSubmitName} onCancel={onCancelName} /> : <span title={section.name}>{section.name}</span>}
        <small className="sidebar-section-count">{count}</small>
      </button>
      <span className="sidebar-section-actions">
        <ActionMenu label={`Options for section ${section.name}`} icon={<MoreHorizontal size={14} aria-hidden="true" />} iconOnly
          open={menuOpen} onOpenChange={onMenuOpenChange}
          items={[
            { id: 'rename', label: 'Rename', onSelect: onRename },
            { id: 'move-up', label: 'Move up', disabled: !canMoveUp, onSelect: () => onMove(-1) },
            { id: 'move-down', label: 'Move down', disabled: !canMoveDown, onSelect: () => onMove(1) },
            { id: 'delete', label: 'Delete section', onSelect: onDelete },
          ]} />
      </span>
    </h2>
  );
}
