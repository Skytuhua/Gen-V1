import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShellSidebar } from '../../apps/web/src/ShellSidebar';
import { matchingThreads } from '../../apps/web/src/thread-search';
import type { Thread } from '../../packages/contracts';
import { DEFAULT_PREFERENCES } from '../../packages/contracts/preferences';
import type { ShellLayout } from '../../apps/web/src/shell-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const query = new URLSearchParams(location.search);
const threads: Thread[] = Array.from({ length: query.has('overflow') ? 35 : 6 }, (_, index) => ({
  id: `thread-${index + 1}`, title: `Thread ${index + 1}`, projectName: 'Synthetic project',
  status: 'ready', epoch: 0, runId: null, modelId: null, sessionPath: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: `2026-11-01T00:00:${String(59 - index).padStart(2, '0')}Z`,
  presentation: { order: index },
}));
threads.push(...['Pinned', 'Folded'].map((title, index): Thread => ({
  ...threads[0], id: title.toLowerCase(), title,
  presentation: { order: index, pinned: index === 0, settled: index === 1 },
})));

function Fixture() {
  const elementRef = useRef<HTMLElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState(threads), [generation, setGeneration] = useState(0);
  const [search, setSearch] = useState(''), [request, setRequest] = useState<(() => void) | null>(null);
  const [layout, setLayout] = useState<ShellLayout>({ sidebarCollapsed: false, sidebarWidth: 248, rightPanelOpen: false,
    rightPanelWidth: 520, rightPanelMaximized: false, activeTab: 'artifact', activeArtifactId: null, folded: { settled: true } });
  const preferences = { ...DEFAULT_PREFERENCES, projectGrouping: false, showWorkingSection: false,
    projectOrder: query.has('recent') ? 'recent' as const : 'manual' as const };
  const matching = useMemo(() => matchingThreads(rows, [], search, preferences.projectOrder), [rows, search, preferences.projectOrder]);
  return <div className="app-shell" data-theme="dark" style={{ height: '100vh' }}>
    <ShellSidebar key={generation} elementRef={elementRef} searchRef={searchRef} mobile={false} open={false} layout={layout}
      preferences={preferences} matching={matching} selectedId="thread-4" loaded creating={false} search={search} setSearch={setSearch}
      close={() => {}} toggleCollapsed={() => {}} setFolded={(key, folded) => setLayout(value => ({ ...value, folded: { ...value.folded, [key]: folded } }))}
      select={() => {}} create={() => {}} settings={() => {}} rename={() => {}} archive={() => {}}
      orderBounds={query.has('bounds') ? { minOrder: -100, maxOrder: 100 } : undefined}
      presentation={(thread, patch) => {
        const apply = () => setRows(value => value.map(row => row.id === thread.id ? { ...row, presentation: { ...row.presentation, ...patch } } : row));
        if (query.has('deferred')) setRequest(() => apply);
        else if (!query.has('fail')) apply();
      }} />
    <main>
      <p>Synthetic thread move fixture</p>
      <button disabled={!request} onClick={() => { request?.(); setRequest(null); }}>Publish move</button>
      <button onClick={() => { setRequest(null); setRows(value => [...value]); }}>Reject move</button>
      <button onClick={() => setRows(value => value.map((row, index) => ({ ...row, presentation: { ...row.presentation, order: -index } })))}>Background sort</button>
      <button onClick={() => setGeneration(value => value + 1)}>Restore sidebar</button>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
