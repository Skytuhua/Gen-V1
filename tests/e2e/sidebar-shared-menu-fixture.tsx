import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ShellSidebar} from '../../apps/web/src/ShellSidebar';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {WorkspaceProvider} from '../../apps/web/src/workspace-context';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import type {ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import type {DesktopBridge, DesktopContext} from '../../packages/desktop-contract';
import type {ShellLayout} from '../../apps/web/src/shell-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const calls: unknown[] = [];
Object.assign(window, {sidebarMenuCalls: calls});
const query = new URLSearchParams(location.search);
const context: DesktopContext = {windowId: 'synthetic-sidebar', surface: {kind: 'main'}, windows: [], update: {state: 'idle', message: 'Up to date'}};
const bridge = {onState: () => () => {}, onCloseRequested: () => () => {}} as unknown as DesktopBridge;
const threads: ThreadNavigationRow[] = ['Selected conversation', 'Other conversation', 'Working without run', 'Side conversation', 'Delegate conversation'].map((title, index) => ({
  id: `thread-${index}`, title, projectId: `project-${index}`, projectName: 'Synthetic project', workspaceId: `copy-${index}`,
  kind: index === 3 ? 'side' : index === 4 ? 'delegate' : 'main', parentThreadId: index === 4 ? 'thread-0' : undefined,
  status: index === 1 || index === 2 ? 'working' : 'ready', runId: index === 1 ? 'run-other' : null,
  sessionPath: null, epoch: 0, createdAt: '2026-11-06T12:00:00Z', updatedAt: '2026-11-06T12:00:00Z',
  presentation: {pinned: query.has('flags'), unread: query.has('flags'), settled: query.has('flags'), order: index - 4},
} as ThreadNavigationRow));

function Fixture() {
  const elementRef = useRef<HTMLElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(true), [rows, setRows] = useState(threads);
  const [layout, setLayout] = useState<ShellLayout>({sidebarCollapsed: false, sidebarWidth: 248, rightPanelOpen: false, rightPanelWidth: 520, rightPanelMaximized: false, activeTab: 'artifact', activeArtifactId: null, folded: {}});
  return <DesktopProvider bridge={bridge} context={context}><WorkspaceProvider value={{activeArtifactId: null, requestOpenArtifact: () => {}, closeArtifact: () => {}, rightPanelOpen: false, activeTab: 'artifact', setActiveTab: () => {}}}>
    <div className="app-shell" data-theme="dark" style={{height: '100vh'}}>
      <ShellSidebar elementRef={elementRef} searchRef={searchRef} mobile={query.has('mobile')} open={visible} layout={layout}
        preferences={{...DEFAULT_PREFERENCES, projectGrouping: true, showWorkingSection: false, panelAnimations: false}}
        matching={rows} selectedId="thread-0" loaded creating={false} search="" setSearch={() => {}} close={() => setVisible(false)}
        toggleCollapsed={() => setLayout(value => ({...value, sidebarCollapsed: !value.sidebarCollapsed}))}
        setFolded={(key, folded) => setLayout(value => ({...value, folded: {...value.folded, [key]: folded}}))}
        select={id => calls.push({select: id})} create={() => {}} settings={() => {}}
        presentation={(thread, value) => calls.push({presentation: thread, value})} rename={thread => calls.push({rename: thread})}
        archive={id => calls.push({archive: id})} detachThread={() => calls.push({detach: true})}
        {...(!query.has('custom') ? {onPlaceThread: (thread: ThreadNavigationRow) => calls.push({place: thread})} : {})}
        {...(!query.has('fallback') ? {orderBounds: {minOrder: -50, maxOrder: 80}} : {})}/>
      <main><p>Synthetic sidebar menu fixture</p><button onClick={() => setVisible(false)}>Hide mobile sidebar</button>
        <button onClick={() => setLayout(value => ({...value, sidebarCollapsed: true}))}>Collapse sidebar</button>
        <button onClick={() => setRows([])}>Remove threads</button><button>Outside target</button></main>
    </div>
  </WorkspaceProvider></DesktopProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
