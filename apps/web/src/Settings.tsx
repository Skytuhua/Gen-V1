import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ExternalLink, Search, X } from 'lucide-react';
import type { ModelInfo, Snapshot } from '../../../packages/contracts';
import { getPreferences, type UiPreferences } from '../../../packages/contracts/preferences';
import { command, getModels } from './api';
import { T3_SETTINGS_ROWS, T3_PANEL_ROWS, T3_SETTINGS_SOURCE, type SettingsInventoryRow } from './settings-inventory';
import './settings.css';
import { DEPENDENCY_NOTICES } from './dependency-notices';
import {DraftTransfer} from './DraftTransfer';
import {useDesktop} from './desktop-context';
import { Connections, matchingSubscriptionConnections } from './Connections';
import {SkillLibrary} from './SkillLibrary';
import { version } from '../../../package.json';

export const SETTINGS_SECTIONS = [
  ['general', 'General'], ['appearance', 'Appearance'], ['chat', 'Chat'], ['diffs', 'Diffs & pull requests'], ['keybindings', 'Keybindings'], ['snap-shot', 'SnapShots'],
  ['providers', 'Providers'], ['skills', 'Skills & learning'], ['threads', 'Threads'], ['browser', 'Browser'], ['devices', 'Devices'], ['scheduled-tasks', 'Scheduled tasks'],
  ['projects', 'Projects'], ['source-control', 'Source control'], ['worktrees', 'Worktrees'], ['connections', 'Environments'], ['access', 'Sharing & access'], ['secrets', 'Secrets'],
  ['maintenance', 'Maintenance'], ['labs', 'Labs'], ['about', 'About'], ['archived', 'Archive'], ['diagnostics', 'Diagnostics'], ['licenses', 'Licenses'],
] as const;
type Availability = 'Working' | 'Adapted' | 'Unavailable';
const supportedT3Shortcuts: Record<string, keyof UiPreferences['keybindings']> = { 'keybinding-sidebar.toggle': 'toggleSidebar', 'keybinding-rightPanel.toggle': 'toggleRightPanel', 'keybinding-chat.new': 'newThread', 'keybinding-thread.stop': 'stop', 'keybinding-commandPalette.toggle': 'search' };
const preferenceRows: Record<string, { key: keyof UiPreferences; options?: readonly string[]; labels?: readonly string[]; description: string; adapted?: boolean }> = {
  'chat-width': { key: 'chatWidth', options: ['comfortable', 'wide', 'full'], description: 'Sets the width of messages, the composer and inline task interfaces.' },
  'setting-appearance-contrast': { key: 'contrast', options: ['normal', 'high'], description: 'Increase interface text and border contrast.', adapted: true },
  'interface-font': { key: 'interfaceFont', options: ['system', 'Inter', 'Arial', 'Georgia'], description: 'Choose an available interface font. Font size applies throughout the interface.' },
  'prompt-font': { key: 'promptFont', options: ['system', 'Inter', 'Arial', 'Georgia'], description: 'The font used in your message composer.' },
  'code-font': { key: 'codeFont', options: ['monospace', 'Consolas', 'Cascadia Code'], description: 'The font used in code blocks, diffs, and file previews.' },
  'panel-animations': { key: 'panelAnimations', description: 'Animate opening and resizing panels. Reduced motion is always respected.' },
  'word-wrap': { key: 'wordWrap', description: 'Wrap long lines in code, diffs, and file previews.' },
  'composer-context': { key: 'showComposerContext', description: 'Show the context usage inspector beside the composer.' },
  'harness-live-usage': {key:'showUsageFooter',description:'Show live runtime tokens, context and reported cost in the bottom-right corner.'},
  'thread-details-items': { key: 'showThreadDetails', description: 'Show task status and thread details in the conversation header.', adapted: true },
  'project-grouping': { key: 'projectGrouping', description: 'Group threads by their project in the sidebar.', adapted: true },
  'project-order': { key: 'projectOrder', options: ['recent', 'created', 'manual'], description: 'Sort projects by recent activity, creation time, or your manual thread order.' },
  'working-shelf': { key: 'showWorkingSection', description: 'Show active tasks together in a Working section.' },
  'time-format': { key: 'timeFormat', options: ['system', '12h', '24h'], description: 'Display thread and executor timestamps using this clock format.' },
  'archive-confirmation': { key: 'archiveConfirmation', description: 'Ask before archiving a thread. Uncheckpointed widget edits always require a decision.' },
  'unpin-confirmation': { key: 'unpinConfirmation', description: 'Ask before unpinning a thread.' },
  'thread-notifications': { key: 'threadNotifications', options: ['off', 'notifications', 'sound', 'both'], labels: ['Off', 'Browser notifications', 'Sound', 'Notifications and sound'], description: 'Notify when an open window sees a task finish, fail, or need input. Notification permission is required; background delivery is unavailable.', adapted: true },
  'in-app-notifications': { key: 'inAppNotifications', description: 'Show a notice when another task finishes or needs your input.' },
  'send-shortcut': { key: 'sendShortcut', options: ['enter', 'mod-enter-multiline', 'mod-enter'], labels: ['Enter to send', 'Ctrl / ⌘ Enter; expandable input', 'Ctrl / ⌘ Enter to send'], description: 'Shift Enter always inserts a new line. Ctrl / ⌘ means your platform modifier.' },
  'diff-layout': { key: 'diffLayout', options: ['stacked', 'split'], labels: ['Stacked', 'Side by side'], description: 'Layout for before and after content reported by an executor.', adapted: true },
  'hide-whitespace-changes': { key: 'hideWhitespace', description: 'Hide lines whose differences consist only of whitespace in the diff viewer.' },
  'default-diff-file-state': { key: 'diffDefaultExpanded', description: 'Expand executor diff records when opening the workspace.', adapted: true },
  'diff-color-scheme': { key: 'diffColors', options: ['red-green', 'blue-orange'], description: 'Colors for additions and deletions in executor diffs.' },
  'harness-font-size': { key: 'fontSize', description: 'Base interface font size, in pixels.' },
  'harness-motion-duration': { key: 'motionDuration', description: 'Panel transition duration, from 0 to 400 milliseconds.' },
};
const extra = (id: string, title: string, section: string, terms = ''): SettingsInventoryRow => ({ id, title, section, terms });
export const SETTINGS_ROWS = [
  ...T3_SETTINGS_ROWS,
  ...T3_PANEL_ROWS,
  extra('harness-draft-transfer','Move browser drafts','maintenance','draft import export backup desktop migration'),
  extra('harness-live-usage','Live usage','chat','tokens context plan subscription quota cost live meter bottom right'),
  extra('harness-font-size', 'Font size', 'appearance', 'text typography pixels'), extra('harness-motion-duration', 'Motion duration', 'appearance', 'animation speed milliseconds'),
  extra('harness-local-models', 'Available models', 'providers', 'pi runtime connection refresh authentication'),
  extra('harness-skills','Skills & learning','skills','skill library self improvement automatic learning reviews approval agent writes tool calls interval idle curation archive restore rollback'),
  extra('harness-hermes-license','Hermes Agent learning','licenses','self improvement skills Nous Research MIT'),
  extra('harness-runtime', 'Local runtime', 'connections', 'Pi browser host'),
  extra('harness-export-diagnostics', 'Workspace diagnostics', 'diagnostics', 'host connection counts accepted sequence'),
  extra('harness-licenses', 'Application and dependency notices', 'licenses', 'license source repository attribution'),
  ...DEPENDENCY_NOTICES.map(([name, version, license]) => extra(`license-${name}`, name, 'licenses', `dependency ${version} ${license}`)),
];
const unavailableReasons: Record<string, string> = {
  'snap-shot': 'Screen capture and configurable global shortcuts are not implemented.',
  browser: 'Browser automation and recording are unavailable. The Windows app includes a separate manual browser.',
  devices: 'Requires a device host and simulator or emulator connection. No device adapter is installed.',
  'scheduled-tasks': 'Requires a persistent scheduler and webhook service. Scheduled agent runs are unavailable.',
  'source-control': 'Requires a source control host adapter. No Git credential, pull request, merge, fetch, or repository mutation is performed here.',
  worktrees: 'Requires a Git worktree manager. Granted projects are read through the local host; no worktree lifecycle is implemented.',
  access: 'Requires remote environment pairing and access administration. This build connects to its same-origin local host.',
  secrets: 'Requires a dedicated secret-provider integration. Provider credentials remain in their private connection stores.',
  connections: 'Remote pairing, tunnels, routing and load balancing are not implemented. The current connection uses the local host.',
  labs: 'This T3 experiment has no implemented adapter in this application.',
  maintenance: 'Requires a host maintenance adapter. This application does not run T3 cleanup, automatic restarts, or background probes.',
  providers: 'This provider-management feature has no adapter. Connect supported subscriptions under AI subscriptions.',
  appearance: 'This T3 appearance feature is not implemented.',
  threads: 'This T3 thread automation or project-default feature has no runtime adapter. Existing task state and explicit approvals are retained.',
  diagnostics: 'Requires T3 process telemetry or trace collection. These measurements are not reported by this local host.',
  keybindings: 'This command has no corresponding application action. Its shortcut cannot be enabled.',
  chat: 'This composer capability is not implemented. Your drafts remain in the local journal.',
  diffs: 'Requires a pull request adapter. Executor-reported before and after content remains available in the workspace Diff tab.',
  about: 'This distribution does not use the T3 desktop release, updater, mobile client, privacy policy, or CLI.',
  projects: 'Requires a project configuration and script manager. Only explicitly granted project resources are available.',
  general: 'This action is not implemented. Its preference cannot be enabled here.',
};
export function settingAvailability(row: SettingsInventoryRow): Availability {
  if (supportedT3Shortcuts[row.id] || row.id === 'keybindings') return 'Adapted';
  if (preferenceRows[row.id]) return preferenceRows[row.id]!.adapted ? 'Adapted' : 'Working';
  if (['harness-draft-transfer','color-scheme', 'harness-export-diagnostics', 'harness-licenses', 'harness-hermes-license', 'harness-skills', 'harness-local-models', 'panel-licenses-dependency-license-notices'].includes(row.id) || row.id.startsWith('harness-keybinding-') || row.id.startsWith('license-')) return 'Working';
  if (['providers', 'default-model', 'archive', 'project-overview', 'app-version', 'open-source-licenses', 'diagnostics', 'harness-runtime'].includes(row.id)) return 'Adapted';
  return 'Unavailable';
}
const keyboardActions = [['search', 'Search threads'], ['newThread', 'New thread'], ['toggleSidebar', 'Toggle sidebar'], ['toggleRightPanel', 'Toggle workspace panel'], ['openSettings', 'Open settings'], ['stop', 'Stop active run']] as const;
for (const [id, label] of keyboardActions) SETTINGS_ROWS.push(extra(`harness-keybinding-${id}`, label, 'keybindings', `shortcut ${id}`));

function PreferenceControl({ row, preferences, update, busy }: { row: SettingsInventoryRow; preferences: UiPreferences; update: (value: Partial<UiPreferences>) => Promise<void>; busy: boolean }) {
  const definition = preferenceRows[row.id]!;
  const value = preferences[definition.key];
  if (definition.options) return <select aria-label={row.title} disabled={busy} value={String(value)} onChange={event => void update({ [definition.key]: event.target.value })}>{definition.options.map((option, index) => <option value={option} key={option}>{definition.labels?.[index] ?? option.charAt(0).toUpperCase() + option.slice(1)}</option>)}</select>;
  if (typeof value === 'number') return <input aria-label={row.title} type="number" min={definition.key === 'fontSize' ? 12 : 0} max={definition.key === 'fontSize' ? 20 : 400} step={definition.key === 'fontSize' ? 1 : 10} disabled={busy} value={value} onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) void update({ [definition.key]: next }); }} />;
  return <button role="switch" aria-label={row.title} aria-checked={Boolean(value)} disabled={busy} className="settings-switch" onClick={() => void update({ [definition.key]: !value })}><span /></button>;
}
function ShortcutInput({ action, label, value, save, busy }: { action: string; label: string; value: string; save: (key: string, value: string) => void; busy: boolean }) {
  return <input aria-label={`${label} shortcut`} title="Focus and press a shortcut" readOnly value={value} disabled={busy} onKeyDown={event => { if (event.key === 'Tab') return; event.preventDefault(); if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return; const key = event.key === ',' ? 'Comma' : event.key.length === 1 ? event.key.toUpperCase() : event.key; save(action, [event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')); }} />;
}

export function Settings({ snapshot, modelError, refresh, loadModels, close, addResource, initialSection = 'general' }: { snapshot: Snapshot; modelError: string; refresh: () => Promise<void>; loadModels: (refresh?: boolean) => Promise<void>; close: () => void; addResource: () => void; initialSection?: string }) {
  const desktop=useDesktop();
  const dialog = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [newTaskModels, setNewTaskModels] = useState<ModelInfo[]>([]);
  const [newTaskModelError, setNewTaskModelError] = useState(modelError);
  const catalogRequest = useRef(0);
  const selectedAccountsKey = JSON.stringify(Object.entries(snapshot.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const catalogSelection = useRef(selectedAccountsKey); catalogSelection.current = selectedAccountsKey;
  const loadNewTaskModels = useCallback(async (force = false) => {
    const request = ++catalogRequest.current, selection = catalogSelection.current;
    try { const result = await getModels(force); if (request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels(result.models); setNewTaskModelError(result.error ?? ''); } }
    catch (cause) { if (request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels([]); setNewTaskModelError(cause instanceof Error ? cause.message : 'Models could not be loaded.'); } }
  }, []);
  useLayoutEffect(() => { setNewTaskModels([]); setNewTaskModelError(''); void loadNewTaskModels(); return () => { catalogRequest.current++; }; }, [loadNewTaskModels, selectedAccountsKey]);
  const refreshModels = async (force = false) => { await Promise.all([loadModels(force), loadNewTaskModels(force)]); };

  const preferences = getPreferences(snapshot.settings);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useLayoutEffect(() => { if(section==='skills'&&!query.trim())dialog.current?.querySelector<HTMLElement>('.settings-navigation [aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'}); }, [section,query]);
  const persist = async (payload: Record<string, unknown>) => {
    setBusy(true); setSaved(false); setError('');
    try { await command('settings.update', payload); await refresh(); setSaved(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved.'); }
    finally { setBusy(false); }
  };
  const update = async (value: Partial<UiPreferences>) => {
    if (value.threadNotifications === 'notifications' || value.threadNotifications === 'both') {
      if (!('Notification' in window)) { setError('Browser notifications are unavailable in this browser.'); return; }
      if (await Notification.requestPermission() !== 'granted') { setError('Notification permission was not granted. Your saved preference has not changed.'); return; }
    }
    await persist({ preferences: value });
  };
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = SETTINGS_ROWS.filter(row => tokens.length ? tokens.every(token => `${row.title} ${row.terms} ${SETTINGS_SECTIONS.find(item => item[0] === row.section)?.[1] ?? ''} ${settingAvailability(row)} ${unavailableReasons[row.section] ?? ''}`.toLocaleLowerCase().includes(token)) : row.section === section);
  const subscriptionCount = tokens.length ? matchingSubscriptionConnections(query).length : 0;
  const heading = tokens.length ? `Search results (${rows.length + subscriptionCount})` : SETTINGS_SECTIONS.find(item => item[0] === section)?.[1];
  const details = (row: SettingsInventoryRow): { description: string; control: ReactNode } => {
    if (supportedT3Shortcuts[row.id]) { const action = supportedT3Shortcuts[row.id]!; return { description: 'Focus and press a shortcut to change this binding.', control: <ShortcutInput action={action} label={row.title} value={preferences.keybindings[action]} busy={busy} save={(key, value) => void update({ keybindings: { ...preferences.keybindings, [key]: value } })} /> }; }
    if (row.id.startsWith('license-')) { const item = DEPENDENCY_NOTICES.find(([name]) => name === row.title)!; return { description: `Installed version ${item[1]} · ${item[2]}. The installed package's complete LICENSE and NOTICE files remain authoritative.`, control: <a href={`https://www.npmjs.com/package/${encodeURIComponent(item[0])}/v/${item[1]}`} target="_blank" rel="noreferrer">Package notice<ExternalLink size={12} /></a> }; }
    if (preferenceRows[row.id]) return { description: preferenceRows[row.id]!.description, control: <PreferenceControl row={row} preferences={preferences} update={update} busy={busy} /> };
    if (row.id.startsWith('harness-keybinding-')) { const action = row.id.slice('harness-keybinding-'.length) as keyof UiPreferences['keybindings']; return { description: 'Click and press a shortcut. Saved bindings apply after the host accepts them.', control: <ShortcutInput action={action} label={row.title} value={preferences.keybindings[action] ?? ''} busy={busy} save={(key, value) => void update({ keybindings: { ...preferences.keybindings, [key]: value } })} /> }; }
    switch (row.id) {
      case 'keybindings': return { description: 'Six workspace actions have editable bindings below. Commands without a corresponding action remain unavailable.', control: <span className="settings-value">6 supported actions</span> };
      case 'color-scheme': return { description: 'Follow your device color scheme, or choose light or dark.', control: <select aria-label="Color scheme" disabled={busy} value={snapshot.settings.theme} onChange={event => void persist({ theme: event.target.value })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select> };
      case 'providers': case 'harness-local-models': return { description: `${newTaskModels.length} ${newTaskModels.length === 1 ? 'model' : 'models'} reported by connected runtimes. Credentials stay in their private connection stores. ${newTaskModelError}`, control: <button className="secondary" disabled={busy} onClick={() => void refreshModels(true)}>Refresh models</button> };
      case 'default-model': return { description: 'Default model for new work. Available models and reasoning levels follow the selected account for new tasks.', control: <select aria-label="Default model" disabled={busy || !newTaskModels.length} value={snapshot.settings.modelId ?? ''} onChange={event => void persist({ modelId: event.target.value })}><option value="" disabled>Select model</option>{newTaskModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select> };
      case 'archive': return { description: `${snapshot.archivedThreads?.length ?? 0} archived threads. Restore reopens the saved thread; it does not resume a run.`, control: <span className="settings-value">{snapshot.archivedThreads?.length ?? 0} archived</span> };
      case 'project-overview': return { description: `${snapshot.resources.filter(item => item.kind === 'project').length} explicitly granted project folders. Access remains scoped to the resource grant.`, control: <button className="secondary" onClick={addResource}>Add resource</button> };
      case 'app-version': return { description: `Generative Harness ${version} · T3 source reference da8cc591dadd75819ae62961da4a882767efb145.`, control: <span className="settings-value">{desktop?'Windows desktop':'Browser build'}</span> };
      case 'diagnostics': return { description: 'Inspect the current accepted workspace snapshot and connection details. Native telemetry is unavailable.', control: <button className="secondary" onClick={() => { setQuery(''); setSection('diagnostics'); }}>Open diagnostics</button> };
      case 'harness-draft-transfer': return {description:'Explicitly transfer browser-local drafts. Existing or incompatible desktop entries are retained for review.',control:<DraftTransfer snapshot={snapshot}/>};
      case 'harness-export-diagnostics': return { description: `Accepted event sequence ${snapshot.seq}. ${snapshot.threads.length} active threads, ${snapshot.artifacts.length} artifacts, ${snapshot.resources.length} grants, ${snapshot.operations.filter(item => item.status === 'unknown').length} uncertain operations. Model credentials and file contents are not included.`, control: <button className="secondary" onClick={() => void refresh().catch(cause => setError(String(cause)))}>Refresh snapshot</button> };
      case 'harness-runtime': return { description: desktop?'Runs locally in the Windows app. Connect a subscription in Providers, then refresh models.':'Uses the local host. Connect a subscription with pnpm agent:login in the project terminal, then refresh models.', control: <span className="settings-value">Local host</span> };
      case 'open-source-licenses': return { description: 'Source and dependency license information for this application and the pinned T3 reference.', control: <button className="secondary" onClick={() => { setQuery(''); setSection('licenses'); }}>View licenses</button> };
      case 'harness-licenses': return { description: 'Account picker code is adapted from T3 Code. Copyright (c) 2026 T3 Tools Inc., MIT License. See third-party/t3code for the complete license and pinned source notices.', control: <a href="https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/LICENSE" target="_blank" rel="noreferrer">T3 source license<ExternalLink size={12} /></a> };
      case 'harness-hermes-license': return {description:'Skill learning is adapted from Hermes Agent. Copyright (c) 2025 Nous Research, MIT License. The pinned source and complete notice are retained under third-party/hermes-agent.',control:<a href="https://github.com/NousResearch/hermes-agent/blob/c627ec84664d43e0b18b95d9d86d8963747d56c7/LICENSE" target="_blank" rel="noreferrer">Hermes source license<ExternalLink size={12}/></a>};
      case 'harness-skills': return {description:'Inspect reusable procedures, review proposed changes and control automatic learning.',control:<button className="secondary" onClick={()=>{setQuery('');setSection('skills');}}>Open skills and learning</button>};
      case 'panel-licenses-dependency-license-notices': return { description: 'The direct dependencies below were checked against their installed package manifests. Full transitive distribution notices are not yet assembled in this browser interface.', control: <span className="settings-value">{DEPENDENCY_NOTICES.length} direct dependencies</span> };
      default: return { description: unavailableReasons[row.section] ?? 'This T3 capability has no implemented adapter.', control: <button className="secondary" disabled>Unavailable</button> };
    }
  };
  return <dialog ref={dialog} className={`settings-dialog${!tokens.length&&section==='skills'?' settings-skills':''}`} aria-label="Settings" onCancel={close} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header><button className="icon-button" aria-label="Close settings" onClick={close}><ArrowLeft size={17} /></button><strong>Settings</strong><span className="settings-save-state" role="status">{busy ? 'Saving…' : saved ? <><Check size={12} />Saved</> : null}</span><button className="icon-button" aria-label="Dismiss settings" onClick={close}><X size={17} /></button></header>
    <div className="settings-layout"><aside className="settings-navigation"><label className="settings-search"><Search size={14} /><input type="search" aria-label="Search all settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)} /></label><nav aria-label="Settings sections">{SETTINGS_SECTIONS.map(([id, label]) => <button key={id} className={`${!tokens.length && section === id ? 'selected' : ''} ${['providers','projects','connections','maintenance','diagnostics'].includes(id) ? 'settings-group-start' : ''}`} onClick={() => { setQuery(''); setSection(id); }} aria-current={!tokens.length && section === id ? 'page' : undefined}>{label}</button>)}</nav><a className="settings-reference" href={T3_SETTINGS_SOURCE} target="_blank" rel="noreferrer">T3 reference · da8cc591<ExternalLink size={11} /></a></aside>
    <main className="settings-content"><div className="settings-page-heading"><h1>{heading}</h1><p>Each setting shows what is supported here.</p></div>{error && <p role="alert" className="notice error-text">{error}</p>}
      {rows.filter(row=>tokens.length||section!=='skills'||row.id!=='harness-skills').map(row => { const { description, control } = details(row); const availability = settingAvailability(row); return <section key={row.id} className="settings-row" data-setting-id={row.id} data-availability={availability.toLowerCase()}><div className="settings-row-copy"><h2><span>{row.title}</span><span className={`availability availability-${availability.toLowerCase()}`}>{availability}</span></h2>{tokens.length > 0 && <span className="settings-result-section">{SETTINGS_SECTIONS.find(item => item[0] === row.section)?.[1]}</span>}<p>{description}</p></div><div className="settings-row-control">{control}</div></section>; })}
      {!tokens.length&&section==='skills'&&<SkillLibrary snapshot={snapshot} preferences={preferences} update={update} refresh={refresh} busy={busy}/>}
      {!rows.length && !subscriptionCount && section!=='skills' && <p className="settings-empty">No matching settings. Search covers every section, including unavailable capabilities.</p>}
      {!tokens.length && section === 'archived' && snapshot.archivedThreads?.map(thread => <section key={thread.id} className="settings-row"><div className="settings-row-copy"><h2>{thread.title}</h2><p>{thread.projectName ?? 'Conversation'} · {thread.status}</p></div><button className="secondary" disabled={busy} onClick={() => { setBusy(true); void command('thread.restore', {}, thread.id).then(refresh).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Restore thread</button></section>)}
      {(!tokens.length && section === 'providers' || subscriptionCount > 0) && <Connections models={newTaskModels} snapshot={snapshot} refresh={refresh} loadModels={refreshModels} query={tokens.length ? query : ''} />}
      {!tokens.length && section === 'licenses' && <div className="settings-license-notes"><p>Core interface: React (MIT), lucide-react (ISC), json-render (Apache-2.0). PDF: pdf-lib (MIT), PDF.js (Apache-2.0). Local server: Fastify (MIT). Validation: Ajv and Zod (MIT). These package names identify installed dependencies; their license files remain authoritative.</p></div>}
    </main></div>
  </dialog>;
}
