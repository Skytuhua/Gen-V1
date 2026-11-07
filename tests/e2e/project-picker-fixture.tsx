import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectSummary, WorkspaceAuthority } from '../../packages/contracts/workspace';
import { ShellSidebar } from '../../apps/web/src/ShellSidebar';
import { ProjectPicker } from '../../apps/web/src/ProjectPicker';
import type { Thread } from '../../packages/contracts';
import { DEFAULT_PREFERENCES, mergePreferences } from '../../packages/contracts/preferences';
import { projectColorKey } from '../../apps/web/src/project-colors';
import { readShellLayout } from '../../apps/web/src/shell-layout';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';

const local = { kind: 'local' } as const;
const plugin = { kind: 'plugin', pluginId: 'fixture-plugin', scopeId: 'fixture-scope' } as const;
const project = (id: string, name: string, authority: WorkspaceAuthority = local): ProjectSummary => ({ id, name, authority, rootPath: `C:/Synthetic/${name}`, createdAt: '2026-01-01T00:00:00.000Z' });
const initialProjects = [project('alpha', 'Alpha'), project('beta', 'Beta'), project('foreign', 'Foreign', plugin), ...Array.from({ length: 60 }, (_, i) => project(`project-${i}`, `Project ${String(i).padStart(2, '0')}`))];

function Fixture() {
  const query = new URLSearchParams(location.search);
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(query.has('last') ? 'project-59' : 'alpha');
  const [count, setCount] = useState(0), [adds, setAdds] = useState(0), [projects, setProjects] = useState(initialProjects);
  const [pulse, setPulse] = useState(0);
  const [preferences, setPreferences] = useState(() => mergePreferences(DEFAULT_PREFERENCES, { projectColors: JSON.parse(localStorage.getItem('synthetic-project-colors') ?? '{}') }));
  const sidebar = useRef<HTMLElement>(null), search = useRef<HTMLInputElement>(null);
  return <><p>Synthetic project picker fixture</p><input aria-label="Preserved draft" defaultValue="Keep my draft" />
    <button onClick={() => setOpen(true)}>Open project picker</button><output aria-label="Created threads">{count}</output><output aria-label="Connection requests">{adds}</output>
    <button onClick={() => setProjects(values => values.filter(value => value.id !== 'alpha').reverse())}>Update projects</button>
    <button onClick={() => setPulse(value => value + 1)}>Unrelated update {pulse}</button>
    <ShellSidebar elementRef={sidebar} searchRef={search} mobile={false} open layout={readShellLayout()} preferences={preferences}
      matching={[{ id: 'synthetic-thread', title: 'Existing thread', projectId: 'alpha', projectName: 'Alpha', status: 'ready', epoch: 0, runId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as Thread]}
      loaded creating={false} search="" setSearch={() => {}} close={() => {}} toggleCollapsed={() => {}} setFolded={() => {}} select={() => {}} create={() => setOpen(true)} settings={() => {}} presentation={() => {}} rename={() => {}} archive={() => {}} />
    <ProjectPicker open={open} authority={query.has('plugin') ? plugin : local} projects={projects} selectedProjectId={selected} recentProjectIds={query.has('recent') ? ['beta', 'alpha'] : []} colors={preferences.projectColors}
      onClose={() => setOpen(false)} onSelect={async (value: ProjectSummary | null) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (query.has('fail')) throw Error('Synthetic creation failed');
        setSelected(value?.id ?? ''); setCount(value => value + 1); setOpen(false);
      }} onAddProject={() => { setAdds(value => value + 1); setOpen(false); }}
      onColorChange={async (value: ProjectSummary, color: string | null) => {
        if (query.has('fail-color')) throw Error('Synthetic save failed');
        const colors = { ...preferences.projectColors }, key = projectColorKey(value.authority, value.id);
        if (color) colors[key] = color; else delete colors[key];
        const next = mergePreferences(preferences, { projectColors: colors });
        localStorage.setItem('synthetic-project-colors', JSON.stringify(colors)); setPreferences(next);
      }} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
