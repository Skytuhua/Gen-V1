import { useEffect, useState, type RefObject, type ReactNode, type MouseEvent } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
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
import { useThreadMove } from './sidebar-thread-move';
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
  const word = parts[0]!.replace(/[^A-Za-z0-9]/g, '');
  if (!word) return 'CV';
  return word.slice(0, 2).toUpperCase();
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
  pageControls,
  orderBounds,
}: {
  elementRef: RefObject<HTMLElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  mobile: boolean;
  open: boolean;
  layout: ShellLayout;
  preferences: UiPreferences;
  matching: Thread[];
  pageControls?: ReactNode;
  orderBounds?: {minOrder: number; maxOrder: number};
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
  presentation: (thread: Thread, value: NonNullable<Thread['presentation']>) => void;
  rename: (thread: Thread) => void;
  archive: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const [hoverCache]=useState(createThreadHoverCache<ThreadHoverPRTarget>);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'working' | 'waiting'>('all');
  const [showAllSettled, setShowAllSettled] = useState(false);
  const threadMove = useThreadMove(elementRef, matching,
    preferences.projectOrder === 'manual' && !mobile && !layout.sidebarCollapsed,
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
  const remaining = visibleMatching.filter(item => !pinned.includes(item) && !working.includes(item) && !settled.includes(item));

  const projects = preferences.projectGrouping
    ? [...new Set(remaining.map(item => item.projectId ?? item.projectName ?? 'Conversations'))]
    : ['Conversations'];
  const orderedProjects = projects.toSorted((a, b) => {
    const group = (name: string) => remaining.filter(item => (item.projectId ?? item.projectName ?? 'Conversations') === name);
    if (preferences.projectOrder === 'created')
      return (group(a).map(item => item.createdAt).sort()[0] ?? '').localeCompare(group(b).map(item => item.createdAt).sort()[0] ?? '');
    if (preferences.projectOrder === 'manual')
      return Math.min(...group(a).map(item => item.presentation?.order ?? 0)) - Math.min(...group(b).map(item => item.presentation?.order ?? 0));
    return (group(b).map(item => item.updatedAt).sort().at(-1) ?? '').localeCompare(group(a).map(item => item.updatedAt).sort().at(-1) ?? '');
  });

  const orderedRemaining = preferences.projectGrouping
    ? orderedProjects.flatMap(project => remaining.filter(item => (item.projectId ?? item.projectName ?? 'Conversations') === project))
    : remaining;

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
            onSelect: () => presentation(item, {settled: !item.presentation?.settled})},
          {id: 'top', label: 'Move to top', icon: <ArrowUp size={13} />, onSelect: () => {
            const min = orderBounds?.minOrder ?? Math.min(0, ...matching.map(thread => thread.presentation?.order ?? 0));
            threadMove.prepare(item.id, min - 1);
            presentation(item, {order: min - 1});
          }},
          {id: 'bottom', label: 'Move to bottom', icon: <ArrowDown size={13} />, onSelect: () => {
            const max = orderBounds?.maxOrder ?? Math.max(0, ...matching.map(thread => thread.presentation?.order ?? 0));
            threadMove.prepare(item.id, max + 1);
            presentation(item, {order: max + 1});
          }},
          {id: 'archive', label: 'Archive thread', icon: <Archive size={13} />, disabled: Boolean(item.runId),
            title: item.runId ? 'Stop the task before archiving.' : undefined, onSelect: () => archive(item.id)},
        ]}/>
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
        className={`sidebar-thread-row ${compactSettled ? 'sidebar-settled-row' : ''} ${item.id === selectedId ? 'active' : ''} ${item.kind === 'delegate' ? 'sidebar-delegate' : ''}`}
      >
        <ThreadHoverCard facts={{scope,title:item.title,project:item.projectName?{name:item.projectName,monogram:projectMonogram(item.projectName)}:undefined,model:item.modelId??undefined,reasoning:item.thinkingLevel??undefined,activity:threadStatus(item),lastActivity:{label:threadAge(item.updatedAt),at:item.updatedAt},parent:item.parentThreadId?{threadId:item.parentThreadId,title:matching.find(parent=>parent.id===item.parentThreadId)?.title}:undefined}}
          cache={hoverCache} loadFacts={copy&&scope.projectId?loadPersonalThreadHover:undefined} projectColors={preferences.projectColors} onOpenPR={onOpenThreadPR}
          blocked={hoverBlocked||Boolean(menuId)||(!mobile&&layout.sidebarCollapsed)||(mobile&&!open)}>{trigger=><button {...trigger}
          type="button"
          className="thread-item"
          draggable
          onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-gen-thread', threadDragPayload(item));
          }}
          aria-keyshortcuts={onPlaceThread ? 'Alt+Enter' : undefined}
          onKeyDown={event => {
            if (onPlaceThread && event.altKey && event.key === 'Enter') {
              event.preventDefault();
              onPlaceThread(item);
              return;
            }
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
        {renderMenu(item)}
      </div>
    );
  };

  const group = (key: string, label: string, items: Thread[]) => {
    if (!items.length) return null;
    const folded = layout.folded[key] ?? false;
    return (
      <section key={key} className="thread-group">
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
        </MotionRegion>
      </section>
    );
  };

  const settledFolded = layout.folded['settled'] ?? false;
  const visibleSettled = showAllSettled ? settled : settled.slice(0, 6);

  return (
    <aside
      ref={elementRef}
      inert={(mobile && !open) || (!mobile && layout.sidebarCollapsed)}
      className={`sidebar ${open ? 'sidebar-open' : ''}`}
      aria-label="Thread navigation"
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
          title="New thread (⇧O)"
          onClick={create}
          disabled={!loaded || creating}
        >
          <SquarePen size={15} />
        </button>
      </div>
      <nav className="thread-list" aria-label="Threads" tabIndex={0}>
        {group('pinned', 'Pinned', pinned)}
        {group('working', 'Working', working)}
        {orderedRemaining.length > 0 && <div className="thread-flat-list">{orderedRemaining.map(item => row(item, false))}</div>}
        {settled.length > 0 && (
          <section className="thread-group thread-group-settled">
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
          <div className="sidebar-empty">{search ? 'No matching threads.' : 'Your threads will appear here.'}</div>
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
    </aside>
  );
}
