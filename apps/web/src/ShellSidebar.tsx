import { useEffect, useRef, useState, type RefObject, type ReactNode, type MouseEvent } from 'react';
import {
  Archive,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FolderInput,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  ListFilter,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Search,
  Settings2,
  SquarePen,
} from 'lucide-react';
import {threadNavigationRevision,type ThreadNavigationRow as Thread} from '../../../packages/contracts/shell-read-models';
import type { UiPreferences } from '../../../packages/contracts/preferences';
import type { ShellLayout } from './shell-layout';
import { ariaKeyShortcuts } from './keyboard-bindings';
import { MotionRegion } from './task-motion';
import { UpdateControl } from './UpdateControl';
import { useWorkspace } from './workspace-context';
import './sidebar-context.css';
import {ThreadHoverCard} from './thread-hover/ThreadHoverCard';
import {createThreadHoverCache} from './thread-hover/data';
import type {ThreadHoverScope} from './thread-hover/facts';
import {loadPersonalThreadHover,type ThreadHoverPRTarget} from './thread-hover/host';
import { projectColor, threadDragPayload } from './project-colors';
import { ActionMenu } from '../../../packages/ui-shell/ActionMenu';
import { toast } from '../../../packages/ui-shell/Toast';
import { useThreadMove } from './sidebar-thread-move';
import { useThreadReorder, type SidebarSection } from './sidebar-reorder';
import { SectionHeader, SectionNameField, useSidebarSections } from './SidebarSections';
import type { SidebarSectionV1 } from '../../../packages/contracts/sidebar-sections';
import { Modal } from '../../../packages/ui-shell/Modal';
import './sidebar-thread-move.css';

const threadAge = (value: string) => {
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
};

export const threadStatus = (thread: Thread) =>
  thread.status === 'working'
    ? 'Working'
    : thread.status === 'awaiting_input'
      ? 'Your input'
      : thread.status === 'ready'
        ? 'Ready'
        : thread.status.charAt(0).toUpperCase() + thread.status.slice(1);

export function projectMonogram(name?: string | null): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return 'CV';
  const parts = cleaned.split(/[\s._/-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  const word = (parts[0] ?? '').replace(/[^A-Za-z0-9]/g, '');
  if (!word) return 'CV';
  return word.slice(0, 2).toUpperCase();
}

export function orderSidebarProjects(remaining: Thread[], projectGrouping: boolean, projectOrder: UiPreferences['projectOrder']) {
  if (!projectGrouping) return remaining;
  const groups = new Map<string, { rows: Thread[]; earliest: string; latest: string; order: number }>();
  for (const item of remaining) {
    const key = item.projectId ?? item.projectName ?? 'Conversations';
    const order = item.presentation?.order ?? 0;
    const group = groups.get(key);
    if (!group) groups.set(key, { rows: [item], earliest: item.createdAt, latest: item.updatedAt, order });
    else {
      group.rows.push(item);
      if (item.createdAt < group.earliest) group.earliest = item.createdAt;
      if (item.updatedAt > group.latest) group.latest = item.updatedAt;
      if (order < group.order) group.order = order;
    }
  }
  return [...groups.values()].sort((a, b) => projectOrder === 'created'
    ? a.earliest.localeCompare(b.earliest)
    : projectOrder === 'manual' ? a.order - b.order : b.latest.localeCompare(a.latest)
  ).flatMap(group => group.rows);
}

export function ShellSidebar({
  elementRef,
  searchRef,
  mobile,
  open,
  layout,
  preferences,
  matching,
  selectedId,
  loaded,
  creating,
  search,
  setSearch,
  close,
  toggleCollapsed,
  setFolded,
  select,
  create,
  settings,
  presentation,
  rename,
  archive,
  details = {},
  hoverBlocked = false,
  onOpenThreadPR,
  navigation,
  onOpenPullRequests,
  onOpenUsage,
  onPlaceThread,
  detachThread,
  onConnectProject,
  ensureManualOrder,
  pageControls,
  sections,
  sectionCommand,
}: {
  elementRef: RefObject<HTMLElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  mobile: boolean;
  open: boolean;
  layout: ShellLayout;
  preferences: UiPreferences;
  matching: Thread[];
  pageControls?: ReactNode;
  selectedId?: string;
  loaded: boolean;
  creating: boolean;
  search: string;
  navigation?: ReactNode;
  onOpenPullRequests?: () => void;
  onOpenUsage?: () => void;
  onPlaceThread?: (thread: Thread) => void;
  onConnectProject?: () => void;
  detachNavigation?: () => void;
  detachThread?: (thread: Thread) => void;
  details?: Record<string, { branch?: string; provider?: string }>;
  hoverBlocked?: boolean;
  onOpenThreadPR?: (target:ThreadHoverPRTarget,scope:ThreadHoverScope)=>void;
  setSearch: (value: string) => void;
  close: () => void;
  toggleCollapsed: (event: MouseEvent<HTMLButtonElement>) => void;
  setFolded: (key: string, folded: boolean) => void;
  select: (id: string) => void;
  create: () => void;
  settings: () => void;
  presentation: (thread: Thread, value: NonNullable<Thread['presentation']>) => Promise<boolean>;
  rename: (thread: Thread) => void;
  archive: (id: string) => void;
  /** Switch sidebar ordering to manual so a drag reorder becomes visible; resolves true when it changed. */
  ensureManualOrder?: () => Promise<boolean>;
  /** User sidebar sections; undefined when the host flag is off (baseline sidebar). */
  sections?: SidebarSectionV1[];
  sectionCommand?: (type: string, payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const workspace = useWorkspace();
  const [hoverCache]=useState(createThreadHoverCache<ThreadHoverPRTarget>);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [sectionMenuId, setSectionMenuId] = useState<string | null>(null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<string | 'new' | null>(null);
  const [sectionNameError, setSectionNameError] = useState('');
  const [deletingSection, setDeletingSection] = useState<SidebarSectionV1 | null>(null);
  const [announce, setAnnounce] = useState('');
  const announceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const say = (message: string) => { clearTimeout(announceRef.current); setAnnounce(''); announceRef.current = setTimeout(() => setAnnounce(message), 60); };
  const [filter, setFilter] = useState<'all' | 'working' | 'waiting'>('all');
  const [showAllSettled, setShowAllSettled] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const threadMove = useThreadMove(elementRef, matching,
    !mobile && !layout.sidebarCollapsed,
    JSON.stringify([search, filter, showAllSettled, layout.folded, preferences.projectGrouping, preferences.showWorkingSection]));

  const visibleMatching = matching.filter(
    item =>
      filter === 'all' ||
      (filter === 'working' && (Boolean(item.runId) || item.status === 'working')) ||
      (filter === 'waiting' && item.status === 'awaiting_input'),
  );

  useEffect(() => {
    if ((mobile && !open) || (!mobile && layout.sidebarCollapsed)) setMenuId(null);
  }, [mobile, open, layout.sidebarCollapsed]);

  const pinned = visibleMatching.filter(item => item.presentation?.pinned);
  const working = preferences.showWorkingSection
    ? visibleMatching.filter(
        item => !item.presentation?.pinned && (Boolean(item.runId) || item.status === 'working' || item.status === 'awaiting_input'),
      )
    : [];
  const settled = visibleMatching.filter(item => !pinned.includes(item) && !working.includes(item) && item.presentation?.settled);
  const sectionRows = useSidebarSections(sections, visibleMatching, preferences.showWorkingSection);
  const inSection = new Set([...sectionRows.values()].flat().map(item => item.id));
  const remaining = visibleMatching.filter(item => !pinned.includes(item) && !working.includes(item) && !settled.includes(item) && !inSection.has(item.id));
  const sectionIds = sections ? new Set(sections.map(section => section.id)) : undefined;

  const orderedRemaining = orderSidebarProjects(remaining, preferences.projectGrouping, preferences.projectOrder);
  const settledFolded = layout.folded['settled'] ?? false;
  const visibleSettled = showAllSettled ? settled : settled.slice(0, 6);
  const locked = search.trim().length > 0 || filter !== 'all';
  const reorder = useThreadReorder(navRef, {
    // Ordering needs every settled row; only rendering stops at six.
    lists: () => ({ pinned, working, ...(sections ? Object.fromEntries(sections.map(section => [`section:${section.id}`, sectionRows.get(section.id) ?? []])) : {}), flat: orderedRemaining, settled }),
    sectionIds: sectionIds ? () => sectionIds : undefined,
    expand: list => { if (list.startsWith('section:')) setFolded(list, false); },
    locked: () => locked,
    showWorking: preferences.showWorkingSection,
    // Grouped runs are contiguous, so a drop can only land inside the row's own project.
    groupKey: preferences.projectGrouping ? (item: Thread) => item.projectId ?? item.projectName ?? 'Conversations' : undefined,
    presentation,
    ensureManualOrder: preferences.projectOrder === 'manual' ? undefined : ensureManualOrder,
    prepareMove: (id, order, viaPointer) => threadMove.prepare(id, order, viaPointer),
    toast,
  });

  const runSection = async (type: string, payload: Record<string, unknown>): Promise<unknown> => {
    try { return await sectionCommand?.(type, payload); }
    catch (cause) { const message = cause instanceof Error ? cause.message : 'Section change could not save.'; toast(message, { tone: 'error' }); return Promise.reject(cause); }
  };
  const submitSectionName = async (name: string, sectionId?: string) => {
    const trimmed = name.trim();
    if (!trimmed) { setSectionNameError('Enter a name'); return; }
    if (sections?.some(section => section.id !== sectionId && section.name.toLowerCase() === trimmed.toLowerCase())) { setSectionNameError(`A section named \u201C${trimmed}\u201D already exists`); return; }
    try {
      if (sectionId) await runSection('sidebar.section.rename', { sectionId, name: trimmed });
      else await runSection('sidebar.section.create', { name: trimmed });
      setEditingSection(null); setSectionNameError('');
    } catch { setSectionNameError('Section name could not save.'); }
  };
  const moveSection = async (section: SidebarSectionV1, delta: -1 | 1) => {
    if (!sections) return;
    const ordered = [...sections].sort((a, b) => a.order - b.order);
    const from = ordered.findIndex(item => item.id === section.id), to = from + delta;
    if (to < 0 || to >= ordered.length) return;
    const others = ordered.filter(item => item.id !== section.id);
    const b = to > 0 ? others[to - 1]!.order : null, a = to < others.length ? others[to]!.order : null;
    const order = b === null ? (a ?? 0) - 1 : a === null ? b + 1 : (a - b > 1e-9 ? (a + b) / 2 : null);
    if (order !== null) { await runSection('sidebar.section.move', { sectionId: section.id, order }).catch(() => {}); return; }
    // No gap: dense rewrite, one command per section, matching thread rebalance.
    for (const [index, item] of [...others.slice(0, to), section, ...others.slice(to)].entries()) {
      if (item.order !== index + 1) await runSection('sidebar.section.move', { sectionId: item.id, order: index + 1 }).catch(() => {});
    }
  };
  const deleteSection = async (section: SidebarSectionV1, confirmed: boolean) => {
    const members = sectionRows.get(section.id) ?? [];
    if (members.length && !confirmed) { setDeletingSection(section); return; }
    setDeletingSection(null);
    try {
      await runSection('sidebar.section.delete', { sectionId: section.id });
      toast('Section deleted', { action: { label: 'Undo', onClick: () => void runSection('sidebar.section.restore', { section }).catch(() => {}) } });
    } catch { /* toasted */ }
  };
  const moveToSection = async (item: Thread, sectionId: string | null) => {
    try {
      if (await presentation(item, sectionId ? { pinned: false, settled: false, sectionId } : { pinned: false, sectionId: null })) {
        say(`Moved \u201C${item.title}\u201D to ${sectionId ? sections?.find(section => section.id === sectionId)?.name ?? 'a section' : 'your thread list'}`);
      }
    } catch (cause) { toast(cause instanceof Error ? cause.message : 'Thread could not move.', { tone: 'error' }); }
  };

  const renderMenu = (item: Thread) => (
    <span className="sidebar-thread-menu-button" {...threadMove.menuEvents}>
      <ActionMenu label={`Options for ${item.title}`} icon={<MoreHorizontal size={14} aria-hidden="true" />} iconOnly
        open={menuId === item.id} onOpenChange={open => setMenuId(open ? item.id : null)}
        items={[
          ...(onPlaceThread ? [{id: 'place', label: 'Place in workspace', shortcut: 'Alt Enter', onSelect: () => onPlaceThread(item)}] : []),
          ...(detachThread ? [{id: 'detach', label: 'Detach thread', icon: <ExternalLink size={13} />, onSelect: () => detachThread(item)}] : []),
          {id: 'rename', label: 'Rename thread', onSelect: () => rename(item)},
          {id: 'pin', label: item.presentation?.pinned ? 'Unpin thread' : 'Pin thread', icon: <Pin size={13} />,
            onSelect: () => presentation(item, {pinned: !item.presentation?.pinned})},
          {id: 'unread', label: item.presentation?.unread ? 'Mark as read' : 'Mark as unread', icon: <Circle size={12} />,
            onSelect: () => presentation(item, {unread: !item.presentation?.unread})},
          {id: 'settle', label: item.presentation?.settled ? 'Return to inbox' : 'Settle thread', icon: <Check size={13} />,
            onSelect: async () => { const next = !item.presentation?.settled; try { if (await presentation(item, {settled: next})) toast(next ? `"${item.title}" settled — find it under Settled` : `"${item.title}" returned to your threads`); } catch (cause) { toast(cause instanceof Error ? cause.message : 'Thread presentation could not save.', {tone: 'error'}); } }},
          {id: 'archive', label: 'Archive thread', icon: <Archive size={13} />, disabled: Boolean(item.runId),
            title: item.runId ? 'Stop the task before archiving.' : undefined, onSelect: () => archive(item.id)},
        ]}/>
      {sections && sections.length > 0 && (
        <ActionMenu label={`Move ${item.title} to a section`} icon={<FolderInput size={13} aria-hidden="true" />} iconOnly
          open={moveMenuId === item.id} onOpenChange={open => setMoveMenuId(open ? item.id : null)}
          items={[
            ...sections.map(section => ({ id: `to-${section.id}`, label: section.name, disabled: item.presentation?.sectionId === section.id, onSelect: () => void moveToSection(item, section.id) })),
            { id: 'new-section', label: 'New section\u2026', onSelect: () => { setEditingSection('new'); setSectionNameError(''); } },
            ...(item.presentation?.sectionId ? [{ id: 'remove-section', label: 'Remove from section', onSelect: () => void moveToSection(item, null) }] : []),
          ]}/>
      )}
    </span>
  );

  const row = (item: Thread, compactSettled = false) => {
    const branch = details[item.id]?.branch;
    const isWorking = Boolean(item.runId) || item.status === 'working';
    const showStatus = Boolean(item.runId) || item.status !== 'ready';
    const copy=item.kind==='side'||item.kind==='delegate'?null:item.workspaceId??null;
    const scope:ThreadHoverScope={authority:{kind:'local'},threadId:item.id,projectId:item.projectId??null,workingCopyId:copy,revision:item.threadRevision??threadNavigationRevision(item)};


    return (
      <div
        key={item.id}
        data-thread-id={item.id}
        className={`sidebar-thread-row ${compactSettled ? 'sidebar-settled-row' : ''} ${item.id === selectedId ? 'active' : ''} ${item.kind === 'delegate' ? 'sidebar-delegate' : ''} ${reorder.dragging?.id === item.id ? 'sidebar-drag-source' : ''}`}
      >
        <ThreadHoverCard facts={{scope,title:item.title,project:item.projectName?{name:item.projectName,monogram:projectMonogram(item.projectName)}:undefined,model:item.modelId??undefined,reasoning:item.thinkingLevel??undefined,activity:threadStatus(item),lastActivity:{label:threadAge(item.updatedAt),at:item.updatedAt},parent:item.parentThreadId?{threadId:item.parentThreadId,title:matching.find(parent=>parent.id===item.parentThreadId)?.title}:undefined}}
          cache={hoverCache} loadFacts={copy&&scope.projectId?loadPersonalThreadHover:undefined} projectColors={preferences.projectColors} onOpenPR={onOpenThreadPR} preferredSide="right"
          blocked={hoverBlocked||Boolean(menuId)||Boolean(reorder.dragging)||(!mobile&&layout.sidebarCollapsed)||(mobile&&!open)}>{trigger=><button {...trigger}
          type="button"
          className="thread-item"
          draggable={!locked}
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData('application/x-gen-thread', threadDragPayload(item));
            reorder.begin(item);
          }}
          onDragEnd={reorder.end}
          aria-keyshortcuts={ariaKeyShortcuts(onPlaceThread ? ['thread-place', 'thread-reorder-up', 'thread-reorder-down'] : ['thread-reorder-up', 'thread-reorder-down'])}
          onKeyDown={event => {
            if (onPlaceThread && event.altKey && event.key === 'Enter') {
              event.preventDefault();
              onPlaceThread(item);
              return;
            }
            if (reorder.key(item, event)) return;
            trigger.onKeyDown?.(event);
          }}
          aria-label={`${item.title} ${threadStatus(item)}`}
          aria-current={item.id === selectedId ? 'page' : undefined}
          onClick={() => {
            select(item.id);
            setMenuId(null);
          }}
        >
          {compactSettled ? (
            <span className="thread-settled-line">
              <span className="thread-project-monogram" style={{ color: projectColor({ kind: 'local' }, item.projectId, preferences.projectColors) }} aria-hidden="true">
                {projectMonogram(item.projectName)}
              </span>
              <span className="thread-item-title">
                {item.presentation?.unread && <span className="unread-dot" />}
                {item.title}
              </span>
              <span className="thread-item-meta" data-thread-state={item.runId ? 'working' : item.status}>
                <time dateTime={item.updatedAt}>{threadAge(item.updatedAt)}</time>
              </span>
            </span>
          ) : (
            <>
              <span className="thread-item-header">
                <span className="thread-project-chip">
                  <span className="thread-project-monogram" style={{ color: projectColor({ kind: 'local' }, item.projectId, preferences.projectColors) }} aria-hidden="true">
                    {projectMonogram(item.projectName)}
                  </span>
                  {item.presentation?.pinned && <Pin size={10} className="thread-pin-icon" aria-hidden="true" />}
                  <span className="thread-project-label">{item.projectName || 'Personal'}</span>
                </span>
                <span className="thread-item-meta" data-thread-state={item.runId ? 'working' : item.status}>
                  {showStatus && (
                    <span className="thread-item-status">
                      {isWorking ? (
                        <LoaderCircle size={11} className="spinning" />
                      ) : item.status === 'awaiting_input' ? (
                        <span className="pending-dot" />
                      ) : null}
                      <span>{item.runId ? 'Working' : threadStatus(item)}</span>
                    </span>
                  )}
                  <time dateTime={item.updatedAt}>{threadAge(item.updatedAt)}</time>
                </span>
              </span>
              <span className="thread-item-title">
                {item.presentation?.unread && <span className="unread-dot" />}
                {item.title}
              </span>
              {(branch || item.kind === 'delegate') && (
                <span className="thread-item-submeta">
                  {branch && (
                    <span className="thread-branch-meta">
                      <GitBranch size={11} aria-hidden="true" />
                      <span>{branch}</span>
                    </span>
                  )}
                  {item.kind === 'delegate' && <span className="thread-item-kind">Subagent</span>}
                </span>
              )}
            </>
          )}
          <span className="sr-only thread-item-state">{threadStatus(item)}</span>
        </button>}</ThreadHoverCard>
        <span className="sidebar-thread-actions">
          <button type="button" className="sidebar-row-action" aria-label={`Archive ${item.title}`}
            title={item.runId ? 'Stop the task before archiving.' : 'Archive'}
            disabled={Boolean(item.runId)}
            onClick={() => archive(item.id)}>
            <Archive size={13} aria-hidden="true" />
          </button>
          {renderMenu(item)}
        </span>
      </div>
    );
  };

  const group = (key: string, label: string, items: Thread[], opts: { list?: SidebarSection; keepVisible?: boolean; empty?: ReactNode } = {}) => {
    if (!items.length && !opts.keepVisible) return null;
    const folded = layout.folded[key] ?? false;
    return (
      <section key={key} className={`thread-group thread-group-${key}`} data-thread-list={opts.list}>
        <h2>
          <button
            type="button"
            aria-expanded={!folded}
            onClick={() => {
              setMenuId(null);
              setFolded(key, !folded);
            }}
          >
            <ChevronRight size={11} />
            <span>{label}</span>
            <small>{items.length}</small>
          </button>
        </h2>
        <MotionRegion open={!folded} animate={preferences.panelAnimations && preferences.motionDuration > 0} className="thread-group-content">
          {items.map(item => row(item, false))}
          {!items.length ? opts.empty ?? null : null}
        </MotionRegion>
      </section>
    );
  };

  return (
    <aside
      ref={elementRef}
      inert={(mobile && !open) || (!mobile && layout.sidebarCollapsed)}
      className={`sidebar ${open ? 'sidebar-open' : ''}`}
      aria-label="Thread navigation"
      data-dragging={reorder.dragging ? 'true' : undefined}
    >
      <div className="brand-row">
        <span className="brand-mark">
          <MessageSquare size={16} />
        </span>
        <strong>Gen V1</strong>
        <button
          type="button"
          className="icon-button sidebar-close"
          aria-label={mobile ? 'Close navigation' : 'Collapse sidebar'}
          onClick={mobile ? close : toggleCollapsed}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <div className="navigation-actions">
        <div className="search-field">
          <Search size={13} />
          <input
            ref={searchRef}
            aria-label="Search threads"
            placeholder="Search"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`icon-button sidebar-action-btn sidebar-filter ${filter !== 'all' ? 'selected' : ''}`}
          aria-label="Filter threads"
          title={`Filter: ${filter}. Click for ${filter === 'all' ? 'working' : filter === 'working' ? 'waiting' : 'all'} threads`}
          aria-pressed={filter !== 'all'}
          onClick={() => setFilter(value => (value === 'all' ? 'working' : value === 'working' ? 'waiting' : 'all'))}
        >
          <ListFilter size={15} />
        </button>
        {onConnectProject && (
          <button
            type="button"
            className="icon-button sidebar-action-btn"
            aria-label="Connect project"
            title="Connect project"
            onClick={onConnectProject}
          >
            <FolderPlus size={15} />
          </button>
        )}
        <button
          type="button"
          className="icon-button sidebar-action-btn new-thread"
          aria-label="New thread"
          title={`New thread (${preferences.keybindings.newThread})`}
          onClick={create}
          disabled={!loaded || creating}
        >
          <SquarePen size={15} />
        </button>
      </div>
      <nav className="thread-list" aria-label="Threads" tabIndex={0} ref={navRef}>
        {group('pinned', 'Pinned', pinned, {
          list: 'pinned',
          keepVisible: !locked,
          empty: <div className="sidebar-pinned-empty">Drag a thread here to pin it.</div>,
        })}
        {group('working', 'Working', working, { list: 'working' })}
        {sections && sections.map((section, index) => {
          const list: SidebarSection = `section:${section.id}`;
          const rows = sectionRows.get(section.id) ?? [];
          const folded = layout.folded[list] ?? false;
          return (
            <section key={section.id} className="thread-group thread-group-section" data-thread-list={list} data-drop-target={reorder.dropTargetList === list ? '' : undefined}>
              <SectionHeader
                section={section} count={rows.length} expanded={!folded}
                menuOpen={sectionMenuId === section.id} onMenuOpenChange={next => setSectionMenuId(next ? section.id : null)}
                onToggle={() => setFolded(list, !folded)}
                onRename={() => { setEditingSection(section.id); setSectionNameError(''); }}
                onMove={delta => void moveSection(section, delta)}
                onDelete={() => void deleteSection(section, false)}
                canMoveUp={index > 0} canMoveDown={index < sections.length - 1}
                editing={editingSection === section.id} nameError={sectionNameError}
                onSubmitName={name => void submitSectionName(name, section.id)}
                onCancelName={() => { setEditingSection(null); setSectionNameError(''); }}
              />
              <MotionRegion open={!folded} animate={preferences.panelAnimations && preferences.motionDuration > 0} className="thread-group-content">
                {rows.map(item => row(item, false))}
                {!rows.length && !locked && <div className="sidebar-pinned-empty">Drag threads here.</div>}
              </MotionRegion>
            </section>
          );
        })}
        {sections && !locked && (
          editingSection === 'new'
            ? <SectionNameField initial="" error={sectionNameError} onCommit={name => void submitSectionName(name)} onCancel={() => { setEditingSection(null); setSectionNameError(''); }} />
            : <button type="button" className="sidebar-new-section" onClick={() => { setEditingSection('new'); setSectionNameError(''); }}><FolderPlus size={13} aria-hidden="true" /> New section</button>
        )}
        {orderedRemaining.length > 0 && <div className="thread-flat-list" data-thread-list="flat">{orderedRemaining.map(item => row(item, false))}</div>}
        {reorder.indicatorTop != null && <div className="sidebar-drop-indicator" style={{ top: reorder.indicatorTop }} aria-hidden="true" />}
        {settled.length > 0 && (
          <section className="thread-group thread-group-settled" data-thread-list="settled">
            <h2>
              <button
                type="button"
                aria-expanded={!settledFolded}
                onClick={() => {
                  setMenuId(null);
                  setFolded('settled', !settledFolded);
                }}
              >
                <span>Settled</span>
                <small>{settled.length}</small>
                <ChevronDown size={12} className={`settled-chevron ${settledFolded ? 'is-folded' : ''}`} />
              </button>
            </h2>
            <MotionRegion
              open={!settledFolded}
              animate={preferences.panelAnimations && preferences.motionDuration > 0}
              className="thread-group-content"
            >
              {visibleSettled.map(item => row(item, true))}
              {settled.length > 6 && (
                <button
                  type="button"
                  className="sidebar-settled-more"
                  onClick={() => setShowAllSettled(value => !value)}
                >
                  <ChevronDown size={11} className={showAllSettled ? 'is-expanded' : ''} />
                  <span>{showAllSettled ? 'Show fewer' : `Show ${settled.length - 6} more`}</span>
                </button>
              )}
            </MotionRegion>
          </section>
        )}
        {loaded && !visibleMatching.length && (
          <div className="sidebar-empty">{search ? 'No matching threads.' : filter === 'working' ? 'No working threads right now.' : filter === 'waiting' ? 'No threads waiting for your input.' : 'Your threads will appear here.'}</div>
        )}
        {pageControls}
      </nav>
      {navigation}
      <div className="sidebar-footer" aria-label="App controls">
        <button type="button" onClick={settings} aria-label="Settings" title="Settings">
          <Settings2 size={16} />
          <span>Settings</span>
        </button>
        <button
          type="button"
          onClick={onOpenPullRequests ?? (() => workspace.setActiveTab('linked-pull-requests'))}
          aria-label="Pull requests"
          title="Pull requests"
        >
          <GitPullRequest size={16} />
          <span>PRs</span>
        </button>
        <button
          type="button"
          onClick={onOpenUsage ?? (() => workspace.setActiveTab('usage'))}
          aria-label="Usage"
          title="Usage"
        >
          <BarChart3 size={16} />
          <span>Usage</span>
        </button>
        <UpdateControl compact />
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</span>
      {deletingSection && (
        <Modal open title={`Delete \u201C${deletingSection.name}\u201D?`} onClose={() => setDeletingSection(null)}>
          <p>{`Its ${(sectionRows.get(deletingSection.id) ?? []).length} threads move back to your thread list. No threads are deleted.`}</p>
          <div className="decision-actions">
            <button type="button" className="quiet" onClick={() => setDeletingSection(null)}>Cancel</button>
            <button type="button" className="danger" onClick={() => void deleteSection(deletingSection, true)}>Delete section</button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
