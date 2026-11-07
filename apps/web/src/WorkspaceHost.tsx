import {useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode} from 'react';
import {Menu, PanelLeftOpen, X} from 'lucide-react';
import {threadNavigationRevision,type ThreadNavigationRow} from '../../../packages/contracts/shell-read-models';
import type {PanelBinding, WorkspacePreset} from '../../../packages/contracts/workspace';
import {getPreferences} from '../../../packages/contracts/preferences';
import {Modal} from '../../../packages/ui-shell/Modal';
import {CompactSettings} from './CompactSettings';
import {ResizeHandle} from './WorkspacePanel';
import {bootstrap, command, getShellSettings} from './api';
import {AgentsWorkspace, AgentsWorkspaceController, createPersonalAgentComposers, createPersonalChildFollowUp, type SharedAgentComposers} from './agents-workspace';
import {detachedSurface, pendingSurface, useDesktop, useDesktopCloseGuard, useDesktopReady} from './desktop-context';
import {prepareEditorHandoff} from './editor-handoff';
import {useModalRegion} from './focus';
import {journalFlush} from './journal';
import {PendingStatus} from './LoadingState';
import {ShellSidebar} from './ShellSidebar';
import {getShellNavigationItem} from './shell-read-api';
import {matchesShortcut, useShellLayout} from './shell-layout';
import {useShellNavigation} from './shell-navigation';
import {useAppearance} from './useAppearance';
import {useWorkspaceState} from './workspace-api';
import {WorkspaceControls} from './WorkspaceControls';
import {ResearchHost} from './ResearchHost';
import {CodeReviewHost} from './CodeReviewHost';
import type {ThreadHoverDestination,ThreadHoverPRTarget} from './thread-hover/host';
import type {ThreadHoverScope} from './thread-hover/facts';
import './workspace-host.css';

export type ConversationIntent = 'model' | 'settings' | 'usage' | 'new-thread' | 'connect-project' | 'resources' | 'linked-pull-requests';
export interface ConversationHost {
  workspace: ReturnType<typeof useWorkspaceState>;
  choosePreset(preset: WorkspacePreset, binding?: PanelBinding): Promise<void>;
  selectThread(id: string | undefined): void;
  initialThreadId?: string;
  intent?: {id: number; kind: ConversationIntent};
  consumeIntent(id: number): void;
  composers: SharedAgentComposers;
  openReview?(target:ThreadHoverPRTarget,scope:ThreadHoverScope):Promise<void>;
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The workspace could not open. Retry.';
const prepare = async () => {await journalFlush(); await prepareEditorHandoff();};

/** Resolve the main window's canonical workspace before mounting a conversation owner. */
export function WorkspaceHost({conversation}: {conversation: (host: ConversationHost) => ReactNode}) {
  const desktop = useDesktop(), desktopOwner = useRef(desktop); desktopOwner.current = desktop;
  const workspace = useWorkspaceState(true, {listenNative: false});
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getShellSettings>>>(), [error, setError] = useState('');
  const [reviewDestination,setReviewDestination]=useState<ThreadHoverDestination>();
  const [intent, setIntent] = useState<ConversationHost['intent']>(), intentSequence = useRef(0), selected = useRef<string | undefined>(undefined), pending = useRef(false), alive = useRef(true);
  const [controller] = useState(() => new AgentsWorkspaceController());
  const [composers] = useState(() => createPersonalAgentComposers(createPersonalChildFollowUp(agent => controller.getSnapshot().agents.find(parent => parent.agentId === agent.parentId)?.threadId ?? undefined), agent => {
    const current = desktopOwner.current, surface = agent.threadId ? {kind: 'thread' as const, threadId: agent.threadId} : null;
    return !alive.current || current?.closing || detachedSurface(current, surface) || pendingSurface(current, surface) ? undefined : current ? current.ownership(surface) : 0;
  }));
  const inventory = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const loadSettings = useCallback(async () => {const value = await getShellSettings(); if (alive.current) setSettings(value);}, []);
  useEffect(() => {alive.current = true; void bootstrap().then(loadSettings).catch(cause => {if (alive.current) setError(message(cause));}); return () => {alive.current = false;};}, [loadSettings]);
  useEffect(() => () => {controller.dispose(); composers.dispose();}, [controller, composers]);
  useDesktopCloseGuard('workspace-host-journal', journalFlush);
  const preset = workspace.envelope?.state.canvases.find(canvas => canvas.id === workspace.envelope?.state.activeCanvasId)?.preset;
  const monitored = preset === 'all-agents' && Boolean(settings);
  useLayoutEffect(() => {if (!monitored) return; void controller.start(); return () => controller.pause();}, [monitored, controller]);
  const invalidOwner = Boolean(workspace.envelope && !preset);
  const failure = error || workspace.error || (invalidOwner ? 'The saved workspace is unavailable. Retry to reload it.' : '');
  useDesktopReady(Boolean((monitored && !inventory.pending && (inventory.scopeKey || inventory.error)) || failure));
  const changeWorkspace = async (next: WorkspacePreset, beforeSelect?: () => Promise<void>, binding?: PanelBinding, isCurrent?: () => boolean) => {
    const check = () => {if (isCurrent && !isCurrent()) throw Error('The workspace owner changed. Reopen the current details.');};
    check();
    if (pending.current) throw Error('A workspace change is already in progress.');
    if (!workspace.envelope) throw Error('Wait for the workspace to load.');
    pending.current = true;
    try {
      await prepare(); check(); await loadSettings(); check();
      await beforeSelect?.(); check();
      const canvas = workspace.envelope.state.canvases.find(value => value.preset === next);
      let threadId = binding?.authority.kind === 'local' ? binding.threadId : undefined;
      if (!canvas && !binding && (next === 'research' || next === 'code-review')) {
        let id = selected.current;
        if (!id) try {id = localStorage.getItem('harness:selected-thread') ?? undefined;} catch { /* The server still validates an unbound preset. */ }
        if (id) threadId = (await getShellNavigationItem(id)).id;
      }
      const result=await workspace.send(canvas ? 'workspace.canvas.select' : 'workspace.canvas.create', canvas ? {canvasId: canvas.id} : {name: next, preset: next, ...(threadId ? {threadId} : {})}, isCurrent);
      check();
      if(next==='code-review'&&binding){
        const current=result.state.canvases.find(value=>value.id===result.state.activeCanvasId)!;
        const threads=current.panels.filter(panel=>panel.kind==='thread'),panel=threads.find(panel=>panel.id==='review-owner-'+current.id)??(threads.length===1?threads[0]:undefined);
        if(panel)await workspace.send('workspace.panel.update',{panelId:panel.id,patch:{binding}},isCurrent);
        else await workspace.send('workspace.panel.add',{canvasId:current.id,panel:{id:'review-owner-'+current.id,kind:'thread',binding}},isCurrent);
      }
      check(); if (alive.current) setError('');
    } finally {pending.current = false;}
  };
  const choosePreset = (next: WorkspacePreset, binding?: PanelBinding) => changeWorkspace(next, undefined, binding);
  const openReview=async(target:ThreadHoverPRTarget,scope:ThreadHoverScope)=>{
    if(scope.authority.kind!=='local'||!scope.projectId||!scope.workingCopyId||!Number.isSafeInteger(target.number)||target.number<1||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target.repo))throw Error('This pull request destination is unavailable.');
    const surface={kind:'thread' as const,threadId:scope.threadId},epoch=desktopOwner.current?desktopOwner.current.ownership(surface):0;
    const isCurrent=()=>{const current=desktopOwner.current;return alive.current&&epoch!==undefined&&!current?.closing&&!detachedSurface(current,surface)&&!pendingSurface(current,surface)&&(!current||current.ownership(surface)===epoch);};
    try {await changeWorkspace('code-review',async()=>{
      const row=await getShellNavigationItem(scope.threadId);
      if(row.projectId!==scope.projectId||row.workspaceId!==scope.workingCopyId||(row.threadRevision??threadNavigationRevision(row))!==scope.revision)throw Error('Thread details changed. Reopen the current details.');
    },{authority:{kind:'local'},threadId:scope.threadId,projectId:scope.projectId},isCurrent);
    if(isCurrent())setReviewDestination({id:++intentSequence.current,scope,target});
    }catch(cause){if(alive.current)setError(message(cause));throw cause;}
  };
  const openConversation = async (id?: string, kind?: ConversationIntent) => {
    const previous = selected.current; let changed = false;
    try {
      await changeWorkspace('workspace', async () => {
        if (id) await getShellNavigationItem(id); // Validate the exact Personal destination under this transition's guard.
        selected.current = id; changed = true;
        if (kind) setIntent({id: ++intentSequence.current, kind}); else setIntent(undefined);
      });
      if (id) try {localStorage.setItem('harness:selected-thread', id);} catch { /* The explicit owner still reaches the mounted conversation. */ }
    } catch (cause) {if (changed) {selected.current = previous; setIntent(undefined);} throw cause;}
  };
  const fail = (action: () => Promise<unknown>) => {void action().catch(cause => {if (alive.current) setError(message(cause));});};
  const retry = () => fail(async () => {await Promise.all([workspace.refresh(), loadSettings()]); setError('');});
  if (!workspace.envelope || !settings || !preset) return <main className="workspace-host-bootstrap">
    <PendingStatus pending={!failure} label="Opening workspace…"/>
    {failure && <div role="alert">{failure}<button onClick={retry}>Retry workspace</button></div>}
  </main>;
  if (preset !== 'all-agents' && preset !== 'research' && preset !== 'code-review') return conversation({workspace, choosePreset, initialThreadId: selected.current, selectThread: id => {selected.current = id;}, intent, consumeIntent: id => setIntent(current => current?.id === id ? undefined : current), composers, openReview});
  return <MonitorShell workspace={workspace} settings={settings} controller={controller} composers={composers} choosePreset={choosePreset}
    refreshSettings={loadSettings} openConversation={openConversation} openReview={openReview} error={error} dismissError={() => setError('')} fail={fail} content={preset==='code-review'?<CodeReviewHost destination={reviewDestination} consumeDestination={id=>setReviewDestination(current=>current?.id===id?undefined:current)} canvas={workspace.envelope.state.canvases.find(value=>value.id===workspace.envelope!.state.activeCanvasId)!} workspace={workspace} composers={composers} openConversation={openConversation}/>:preset==='research'?<ResearchHost canvas={workspace.envelope.state.canvases.find(value=>value.id===workspace.envelope!.state.activeCanvasId)!} workspace={workspace} composers={composers} openConversation={id=>openConversation(id)}/>:undefined}/>;
}

function MonitorShell({workspace, settings, controller, composers, choosePreset, refreshSettings, openConversation, openReview, error, dismissError, fail, content}: {
  workspace: ConversationHost['workspace']; settings: Awaited<ReturnType<typeof getShellSettings>>;
  controller: AgentsWorkspaceController; composers: SharedAgentComposers; choosePreset: ConversationHost['choosePreset'];
  refreshSettings: () => Promise<void>;
  openConversation: (id?: string, intent?: ConversationIntent) => Promise<void>;
  openReview: (target:ThreadHoverPRTarget,scope:ThreadHoverScope)=>Promise<void>; error: string; dismissError: () => void;
  fail: (action: () => Promise<unknown>) => void;
  content?: ReactNode;
}) {
  const desktop = useDesktop(), [layout, setLayout] = useShellLayout(), preferences = getPreferences(settings);
  const [search, setSearch] = useState(''), navigation = useShellNavigation(search), [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  const [rename, setRename] = useState<ThreadNavigationRow>(), [title, setTitle] = useState('');
  const [archive, setArchive] = useState<ThreadNavigationRow>();
  const [unpin, setUnpin] = useState<ThreadNavigationRow>();
  const mutationPending = useRef(false), [mutationBusy, setMutationBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null), scrim = useRef<HTMLButtonElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const latestAttention = useRef(openConversation); latestAttention.current = openConversation;
  const latestFailure = useRef(fail); latestFailure.current = fail;
  useEffect(() => desktop?.bridge.onAttentionOpen?.(id => latestFailure.current(() => latestAttention.current(id))), [desktop?.bridge]);
  useModalRegion(sidebar, mobile && open, () => setOpen(false), 'input', scrim);
  useAppearance(preferences);
  useEffect(() => {const query = matchMedia('(max-width: 700px)'), update = () => setMobile(query.matches); query.addEventListener('change', update); return () => query.removeEventListener('change', update);}, []);
  useLayoutEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)'), update = () => {document.documentElement.dataset.theme = settings.theme === 'system' ? query.matches ? 'dark' : 'light' : settings.theme;};
    update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, [settings.theme]);
  const action = (kind: ConversationIntent) => fail(() => openConversation(undefined, kind));
  const openSettings = () => fail(async () => {await prepare(); setSettingsOpen(true);});
  const shortcuts = useRef({action, openSettings}); shortcuts.current = {action, openSettings};
  const keybindings = JSON.stringify(preferences.keybindings);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (matchesShortcut(event, preferences.keybindings.openSettings)) {event.preventDefault(); shortcuts.current.openSettings();}
      else if (matchesShortcut(event, preferences.keybindings.newThread)) {event.preventDefault(); shortcuts.current.action('new-thread');}
      else if (matchesShortcut(event, preferences.keybindings.search)) {event.preventDefault(); setOpen(true); setLayout(value => ({...value, sidebarCollapsed: false})); requestAnimationFrame(() => searchRef.current?.focus());}
      else if (matchesShortcut(event, preferences.keybindings.toggleSidebar)) {event.preventDefault(); if (mobile) setOpen(value => !value); else setLayout(value => ({...value, sidebarCollapsed: !value.sidebarCollapsed}));}
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [keybindings, mobile]);
  const closeSettings = () => fail(async () => {await prepare(); setSettingsOpen(false); await Promise.all([refreshSettings(), navigation.refresh()]);});
  const openBrowser = desktop?.context.surface.kind === 'main' ? async (url: string) => {
    const owner = desktop.context.windowId;
    await prepare();
    const check = async () => {const current = await desktop.bridge.getContext(); if (current.windowId !== owner || current.surface.kind !== 'main') throw Error('The owning workspace changed.');};
    await check(); await desktop.bridge.browser({type: 'open'}); await check();
    if (url) await desktop.bridge.browser({type: 'navigate', url});
  } : undefined;
  const mutate = (action: () => Promise<void>) => {
    if (mutationPending.current) return;
    mutationPending.current = true; setMutationBusy(true);
    fail(async () => {try {await prepare(); await action();} finally {mutationPending.current = false; setMutationBusy(false);}});
  };
  const present = (row: ThreadNavigationRow, patch: NonNullable<ThreadNavigationRow['presentation']>) => {
    if (patch.pinned === false && preferences.unpinConfirmation) {setUnpin(row); return;}
    mutate(async () => {await command('thread.presentation', patch, row.id); await navigation.refresh();});
  };
  const archiveRow = (row: ThreadNavigationRow) => mutate(async () => {await command('thread.archive', {}, row.id); await navigation.refresh(); setArchive(undefined);});
  return <div className="app-shell workspace-host" data-sidebar-collapsed={layout.sidebarCollapsed} style={{'--sidebar-width': layout.sidebarWidth + 'px'} as CSSProperties} inert={desktop?.closing}>
    {open && <button ref={scrim} className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)}/>}
    <ShellSidebar hoverBlocked={settingsOpen||Boolean(rename||archive||unpin)} onOpenThreadPR={(target,scope)=>fail(()=>openReview(target,scope))} elementRef={sidebar} searchRef={searchRef} mobile={mobile} open={open} layout={layout} preferences={preferences}
      matching={navigation.page?.items ?? []} loaded={Boolean(navigation.page)} creating={false} search={search} setSearch={setSearch}
      close={() => setOpen(false)} toggleCollapsed={() => setLayout(value => ({...value, sidebarCollapsed: !value.sidebarCollapsed}))}
      setFolded={(key, folded) => setLayout(value => ({...value, folded: {...value.folded, [key]: folded}}))}
      select={id => fail(() => openConversation(id))} create={() => action('new-thread')} settings={openSettings}
      onConnectProject={() => action('connect-project')} onOpenPullRequests={() => action('linked-pull-requests')} onOpenUsage={() => action('usage')}
      rename={row => {setRename(row); setTitle(row.title);}} archive={id => {const row = navigation.page?.items.find(value => value.id === id); if (row) {if (preferences.archiveConfirmation) setArchive(row); else archiveRow(row);}}} presentation={present}
      orderBounds={navigation.page?.stats}
      pageControls={<div className="workspace-host-navigation-page">
        {navigation.error && <p role="alert">{navigation.error}<button onClick={() => fail(navigation.refresh)}>Retry threads</button></p>}
        <PendingStatus pending={navigation.pending} label="Loading threads…"/>
        {navigation.page?.nextCursor && <button disabled={navigation.pending} onClick={() => fail(navigation.more)}>Load more threads ({navigation.page.items.length} of {navigation.page.total})</button>}
      </div>}/>
    {!mobile && !layout.sidebarCollapsed && <ResizeHandle label="Resize sidebar" value={layout.sidebarWidth} minimum={200} maximum={380} side="left" change={sidebarWidth => setLayout(value => ({...value, sidebarWidth}))}/>}
    <div className="workspace-layout-workarea workspace-host-main">
      {(layout.sidebarCollapsed || mobile) && <button className="icon-button sidebar-recovery" aria-label={mobile ? 'Open navigation' : 'Open sidebar'} onClick={() => {setLayout(value => ({...value, sidebarCollapsed: false})); if (mobile) setOpen(true); requestAnimationFrame(() => searchRef.current?.focus());}}>{mobile ? <Menu size={18}/> : <PanelLeftOpen size={17}/>}</button>}
      <WorkspaceControls envelope={workspace.envelope} send={workspace.send} prepare={prepare} panels={[]} title={panel => panel.kind}
        onChoosePreset={choosePreset} toolsVisible={false} addPanel={async () => {throw Error('Choose Workspace or Custom to open tools.');}} updatePanel={async () => {throw Error('Choose Workspace or Custom to arrange tools.');}}/>
      {error && <div className="workspace-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={dismissError}><X size={15}/></button></div>}
      <div className="workspace-host-content" inert={settingsOpen}>{content ?? <AgentsWorkspace controller={controller} composers={composers} projects={workspace.envelope?.projects.filter(project => project.authority.kind === 'local')}
        preferences={{density: preferences.density === 'compact' ? 'compact' : 'comfortable', projectColors: preferences.projectColors}}
        onOpenConversation={(id,kind) => fail(() => openConversation(id,kind))}/>}</div>
    </div>
    <Modal open={settingsOpen} title="Settings" className="settings-dialog" onClose={closeSettings}>
      {settingsOpen && <CompactSettings scopeKey="personal-main" close={closeSettings} addResource={() => action('resources')} openBrowser={openBrowser}/>}
    </Modal>
    <Modal open={Boolean(rename)} title="Rename thread" onClose={() => {if (!mutationPending.current) setRename(undefined);}}><form onSubmit={event => {event.preventDefault(); if (rename && title.trim()) mutate(async () => {await command('thread.rename', {title: title.trim()}, rename.id); await navigation.refresh(); setRename(undefined);});}}>
      <label>Thread name<input autoFocus disabled={mutationBusy} value={title} maxLength={180} onChange={event => setTitle(event.target.value)}/></label><button disabled={mutationBusy || !title.trim()}>Save name</button>
    </form></Modal>
    <Modal open={Boolean(archive)} title="Archive thread" onClose={() => {if (!mutationPending.current) setArchive(undefined);}}><p>{archive?.title}</p><button disabled={mutationBusy} onClick={() => {if (archive) archiveRow(archive);}}>Archive</button></Modal>
    <Modal open={Boolean(unpin)} title="Unpin thread" onClose={() => {if (!mutationPending.current) setUnpin(undefined);}}><p>{unpin?.title}</p><button disabled={mutationBusy} onClick={() => setUnpin(undefined)}>Keep pinned</button><button disabled={mutationBusy} onClick={() => {if (unpin) mutate(async () => {await command('thread.presentation', {pinned: false}, unpin.id); await navigation.refresh(); setUnpin(undefined);});}}>Unpin</button></Modal>
  </div>;
}
