import {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Toaster} from '../../packages/ui-shell/Toast';
import {ShellSidebar} from '../../apps/web/src/ShellSidebar';
import {DesktopProvider} from '../../apps/web/src/desktop-context';
import {WorkspaceProvider} from '../../apps/web/src/workspace-context';
import {DEFAULT_PREFERENCES} from '../../packages/contracts/preferences';
import type {ThreadNavigationRow} from '../../packages/contracts/shell-read-models';
import type {SidebarSectionV1} from '../../packages/contracts/sidebar-sections';
import type {DesktopBridge, DesktopContext} from '../../packages/desktop-contract';
import type {ShellLayout} from '../../apps/web/src/shell-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

declare global {interface Window {sidebarSectionCalls: unknown[]}}
const calls: unknown[] = [];
Object.assign(window, {sidebarSectionCalls: calls});
const query = new URLSearchParams(location.search);
const context: DesktopContext = {windowId: 'synthetic-sidebar-sections', surface: {kind: 'main'}, windows: [], update: {state: 'idle', message: 'Up to date'}};
const bridge = {onState: () => () => {}, onCloseRequested: () => () => {}} as unknown as DesktopBridge;

const thread = (id: string, title: string, presentation: ThreadNavigationRow['presentation']): ThreadNavigationRow => ({
  id, title, projectId: `project-${id}`, projectName: 'Synthetic project', workspaceId: `copy-${id}`,
  kind: 'main', status: 'ready', runId: null, sessionPath: null, epoch: 0,
  createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z', presentation,
} as ThreadNavigationRow);

const initialSections: SidebarSectionV1[] = [
  {id: 'sec_reviews', name: 'Reviews', order: 1, createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z'},
  {id: 'sec_later', name: 'Later', order: 2, createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z'},
];
const initialThreads: ThreadNavigationRow[] = [
  thread('thread-1', 'Review the parser fix', {order: 1, sectionId: 'sec_reviews'}),
  thread('thread-2', 'Review the docs pass', {order: 2, sectionId: 'sec_reviews'}),
  thread('thread-3', 'Loose conversation', {order: 3}),
  thread('thread-4', 'Settled member', {order: 4, settled: true, sectionId: 'sec_later'}),
];

function Fixture() {
  const elementRef = useRef<HTMLElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(initialThreads);
  const [sections, setSections] = useState<SidebarSectionV1[] | undefined>(query.has('off') ? undefined : initialSections);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<ShellLayout>({sidebarCollapsed: false, sidebarWidth: 248, rightPanelOpen: false, rightPanelWidth: 520, rightPanelMaximized: false, activeTab: 'artifact', openTabs: ['artifact'], activeArtifactId: null, folded: {}});
  return <DesktopProvider bridge={bridge} context={context}><WorkspaceProvider value={{activeArtifactId: null, requestOpenArtifact: () => {}, closeArtifact: () => {}, rightPanelOpen: false, activeTab: 'artifact', setActiveTab: () => {}}}>
    <div className="app-shell" data-theme="dark" style={{height: '100vh'}}>
      <ShellSidebar elementRef={elementRef} searchRef={searchRef} mobile={false} open layout={layout}
        preferences={{...DEFAULT_PREFERENCES, projectGrouping: false, showWorkingSection: false, panelAnimations: false}}
        matching={rows} selectedId="thread-3" loaded creating={false} search={search} setSearch={setSearch} close={() => {}}
        toggleCollapsed={() => setLayout(value => ({...value, sidebarCollapsed: !value.sidebarCollapsed}))}
        setFolded={(key, folded) => setLayout(value => ({...value, folded: {...value.folded, [key]: folded}}))}
        select={id => calls.push({select: id})} create={() => {}} settings={() => {}}
        presentation={async(row, value)=>{calls.push({presentation:row.id,value});setRows(current=>current.map(item=>item.id===row.id?{...item,presentation:{...item.presentation,...value}}:item));return true;}}
        rename={row => calls.push({rename: row.id})} archive={id => calls.push({archive: id})}
        sections={sections}
        sectionCommand={async(type, payload)=>{calls.push({command:type,payload});
          const p = payload as {name?: string; sectionId?: string; order?: number; section?: SidebarSectionV1};
          if (type === 'sidebar.section.create') setSections(current => [...(current ?? []), {id: `sec_${calls.length}`, name: p.name ?? '', order: (current ?? []).length + 1, createdAt: '2026-11-20T12:00:00Z', updatedAt: '2026-11-20T12:00:00Z'}]);
          if (type === 'sidebar.section.rename') setSections(current => (current ?? []).map(item => item.id === p.sectionId ? {...item, name: p.name ?? item.name, updatedAt: '2026-11-20T13:00:00Z'} : item));
          if (type === 'sidebar.section.move') setSections(current => (current ?? []).map(item => item.id === p.sectionId ? {...item, order: p.order ?? item.order} : item));
          if (type === 'sidebar.section.delete') { setSections(current => (current ?? []).filter(item => item.id !== p.sectionId)); setRows(current => current.map(item => item.presentation?.sectionId === p.sectionId ? {...item, presentation: {...item.presentation, sectionId: null}} : item)); }
          if (type === 'sidebar.section.restore' && p.section) setSections(current => [...(current ?? []), p.section!]);
        }}/>
      <Toaster/><main><p>Synthetic sidebar sections fixture</p><button>Outside target</button></main>
    </div>
  </WorkspaceProvider></DesktopProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
