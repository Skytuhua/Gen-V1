import {settingsOperation, settleSettingsOperations} from './settings-operations';
import {registerEditorHandoff} from './editor-handoff';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ExternalLink, Search } from 'lucide-react';
import type { ModelInfo, Snapshot } from '../../../packages/contracts';
import { getPreferences, type UiPreferences } from '../../../packages/contracts/preferences';
import { Select } from '../../../packages/ui-shell/Select';
import { command, getModels } from './api';
import type { SettingsInventoryRow } from './settings-inventory';
import { DEPENDENCY_NOTICES } from './dependency-notices';
import { DraftTransfer } from './DraftTransfer';
import { useDesktop } from './desktop-context';
import { Connections, matchingSubscriptionConnections } from './Connections';
import { SkillLibrary } from './SkillLibrary';
import { IntegrationSettings } from './IntegrationSettings';
import { UpdateControl } from './UpdateControl';
import { AppearanceSettings, NotificationSettings } from './AppearanceSettings';
import { version } from '../../../package.json';
import {settingsDataFromSnapshot, type SettingsData} from './settings-data';
import {snapshotDraftReferences, type DraftReferenceSource} from './draft-transfer';
import './settings.css';

// Selective T3 Code presentation adaptation; see third-party/t3code/README.md.
export const SETTINGS_SECTIONS = [
  ['general', 'General'], ['appearance', 'Appearance'], ['chat', 'Chat & Composer'],
  ['providers', 'Models & Accounts'], ['projects', 'Projects & Working Copies'],
  ['diffs', 'Source Control & Reviews'], ['skills', 'Skills & Integrations'],
  ['notifications', 'Notifications & Usage'], ['browser', 'Browser'],
  ['keybindings', 'Keyboard Shortcuts'], ['maintenance', 'Data & Recovery'], ['about', 'About & Licenses'],
] as const;
const legacySections: Record<string, string> = { threads: 'chat', integrations: 'skills', connections: 'providers', 'source-control': 'diffs', worktrees: 'projects', archived: 'maintenance', diagnostics: 'maintenance', licenses: 'about' };
const keyboardActions = [['search', 'Search threads'], ['newThread', 'New thread'], ['toggleSidebar', 'Toggle sidebar'], ['toggleRightPanel', 'Toggle workspace panel'], ['openSettings', 'Open settings'], ['stop', 'Stop active run']] as const;
const preferenceRows: Record<string, { key: keyof UiPreferences; options?: readonly string[]; labels?: readonly string[]; description: string }> = {
  'time-format': { key: 'timeFormat', options: ['system', '12h', '24h'], labels: ['System', '12 hour', '24 hour'], description: 'Clock format for thread and activity timestamps.' },
  'archive-confirmation': { key: 'archiveConfirmation', description: 'Ask before archiving. Unsaved widget edits always require a decision.' },
  'unpin-confirmation': { key: 'unpinConfirmation', description: 'Ask before removing a pinned thread.' },
  'composer-context': { key: 'showComposerContext', description: 'Show conversation capacity beside the composer.' },
  'harness-composer-predictions': { key: 'composerPredictions', description: 'Uses the selected model and subscription quota.' },
  'thread-details-items': { key: 'showThreadDetails', description: 'Show task status in the conversation header.' },
  'project-grouping': { key: 'projectGrouping', description: 'Group sidebar threads by project.' },
  'project-order': { key: 'projectOrder', options: ['recent', 'created', 'manual'], labels: ['Recent activity', 'Creation time', 'Manual'], description: 'Order project groups in the sidebar.' },
  'working-shelf': { key: 'showWorkingSection', description: 'Group active tasks in the Working section.' },
  'thread-notifications': { key: 'threadNotifications', options: ['off', 'notifications', 'sound', 'both'], labels: ['Off', 'Popups', 'Sound', 'Popups and sound'], description: 'Task completion, failure, and input requests. Browser delivery requires permission.' },
  'in-app-notifications': { key: 'inAppNotifications', description: 'Show notices for other tasks in the app.' },
  'live-usage': { key: 'showUsageFooter', description: 'Show the compact Live usage summary.' },
  'send-shortcut': { key: 'sendShortcut', options: ['enter', 'mod-enter-multiline', 'mod-enter'], labels: ['Enter to send', 'Ctrl / ⌘ Enter; expandable input', 'Ctrl / ⌘ Enter to send'], description: 'Shift Enter inserts a new line.' },
  'diff-layout': { key: 'diffLayout', options: ['stacked', 'split'], labels: ['Stacked', 'Side by side'], description: 'Layout for executor before and after content.' },
  'hide-whitespace-changes': { key: 'hideWhitespace', description: 'Hide changes that consist only of whitespace.' },
  'default-diff-file-state': { key: 'diffDefaultExpanded', description: 'Expand executor diff records when opening review.' },
  'diff-color-scheme': { key: 'diffColors', options: ['red-green', 'blue-orange'], labels: ['Red and green', 'Blue and orange'], description: 'Colors for additions and deletions.' },
};
const row = (id: string, title: string, section: string, terms = ''): SettingsInventoryRow => ({ id, title, section, terms });
export const SETTINGS_ROWS: SettingsInventoryRow[] = [
  row('time-format', 'Time format', 'general'), row('archive-confirmation', 'Archive confirmation', 'general'), row('unpin-confirmation', 'Unpin confirmation', 'general'),
  row('harness-personalization', 'Appearance', 'appearance', 'theme dark light system accent custom contrast density compact comfortable touch fonts interface prompt code size radius motion speed reduced preview reset'),
  row('chat-width', 'Chat width', 'appearance', '680 760 full comfortable wide message composer'), row('word-wrap', 'Code line wrap', 'appearance'), row('harness-project-colors', 'Project colors', 'appearance', 'palette custom hex'),
  row('send-shortcut', 'Send shortcut', 'chat'), row('composer-context', 'Composer context', 'chat'), row('harness-composer-predictions', 'Suggest my next message', 'chat'), row('thread-details-items', 'Thread details', 'chat'), row('project-grouping', 'Group threads by project', 'chat'), row('project-order', 'Project order', 'chat'), row('working-shelf', 'Working section', 'chat'),
  row('harness-local-models', 'Available models', 'providers', 'refresh runtime'), row('default-model', 'Default model', 'providers'), row('harness-accounts', 'Accounts', 'providers', 'subscriptions sign in credentials'), row('harness-runtime', 'Local runtime & environments', 'providers', 'environment variables secret local host'),
  row('project-overview', 'Granted resources', 'projects', 'project folder working copies permissions access'),
  row('diff-layout', 'Diff layout', 'diffs'), row('hide-whitespace-changes', 'Hide whitespace changes', 'diffs'), row('default-diff-file-state', 'Expand diffs', 'diffs'), row('diff-color-scheme', 'Diff colors', 'diffs'),
  row('harness-skills', 'Skills & learning', 'skills', 'library proposals automatic learning review archive restore rollback'), row('harness-integrations', 'Bundled integrations', 'skills', 'humanizer impeccable graphify superpowers ponytail tools hooks mcp'),
  row('thread-notifications', 'Task notifications', 'notifications', 'sound popup'), row('in-app-notifications', 'In-app notifications', 'notifications'), row('live-usage', 'Live usage', 'notifications'), row('harness-notification-controls', 'Notification preferences', 'notifications', 'volume sound preview privacy quiet hours'),
  row('browser-start-page', 'Start page', 'browser', 'manual browser address website'),
  ...keyboardActions.map(([id, label]) => row(`harness-keybinding-${id}`, label, 'keybindings', `keyboard shortcut ${id}`)),
  row('harness-draft-transfer', 'Move browser drafts', 'maintenance', 'import export recovery transfer'), row('archive', 'Archived threads', 'maintenance', 'restore recovery'), row('harness-export-diagnostics', 'Workspace diagnostics', 'maintenance', 'snapshot counts uncertain operations refresh'),
  row('app-version', 'Version & updates', 'about', 'update'), row('harness-licenses', 'T3 Code', 'about', 'copyright MIT license attribution settings account picker'), row('harness-hermes-license', 'Hermes Agent learning', 'about', 'Nous Research MIT license'), row('harness-dependency-notices', 'Dependency notices', 'about', 'licenses'),
  ...DEPENDENCY_NOTICES.map(([name, installed, license]) => row(`license-${name}`, name, 'about', `dependency ${installed} ${license}`)),
];
export function settingAvailability(item: SettingsInventoryRow): 'Working' | 'Unavailable' { return SETTINGS_ROWS.some(value => value.id === item.id) ? 'Working' : 'Unavailable'; }
function PreferenceControl({ item, preferences, update, busy }: { item: SettingsInventoryRow; preferences: UiPreferences; update: (value: Partial<UiPreferences>) => Promise<void>; busy: boolean }) {
  const definition = preferenceRows[item.id]!, value = preferences[definition.key];
  if (definition.options) return <Select aria-label={item.title} disabled={busy} value={String(value)} onValueChange={next => void update({ [definition.key]: next })} options={definition.options.map((option, index) => ({ value: option, label: definition.labels?.[index] ?? option }))}/>;
  return <button type="button" role="switch" aria-label={item.title} aria-checked={Boolean(value)} disabled={busy} className="settings-switch" onClick={() => void update({ [definition.key]: !value })}><span/></button>;
}
function ShortcutInput({ action, label, value, save, busy }: { action: string; label: string; value: string; save: (key: string, value: string) => void; busy: boolean }) {
  return <input aria-label={`${label} shortcut`} title="Focus and press a shortcut" readOnly value={value} disabled={busy} onKeyDown={event => { if (event.nativeEvent.isComposing || event.keyCode === 229 || event.key === 'Tab') return; event.preventDefault(); event.stopPropagation(); if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return; const key = event.key === ',' ? 'Comma' : event.key.length === 1 ? event.key.toUpperCase() : event.key; save(action, [event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Meta' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')); }}/>;
}
export interface SettingsActions {
  environmentSettings?: ReactNode; openBrowser?: (url: string) => Promise<void>;
  modelError: string; refresh: () => Promise<void>; loadModels: (refresh?: boolean) => Promise<void>;
  close: () => void; addResource: () => void; initialSection?: string;
}
export function Settings({snapshot, ...actions}: SettingsActions & {snapshot: Snapshot}) {
  return <SettingsView {...actions} data={settingsDataFromSnapshot(snapshot)} draftReferences={() => Promise.resolve(snapshotDraftReferences(snapshot))}/>;
}
export function SettingsView({data, draftReferences, modelError, refresh, loadModels, close, addResource, initialSection = 'general', environmentSettings, openBrowser}: SettingsActions & {data: SettingsData; draftReferences: DraftReferenceSource}) {
  const desktop = useDesktop();
  useLayoutEffect(() => registerEditorHandoff('settings-writes', settleSettingsOperations), []);
  const navigation = useRef<HTMLElement>(null), content = useRef<HTMLElement>(null);
  const target = legacySections[initialSection] ?? initialSection;
  const [section, setSection] = useState(SETTINGS_SECTIONS.some(([id]) => id === target) ? target : 'general');
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [newTaskModels, setNewTaskModels] = useState<ModelInfo[]>([]), [newTaskModelError, setNewTaskModelError] = useState(modelError);
  const catalogRequest = useRef(0), catalogRead = useRef<AbortController|null>(null);
  const selectedAccountsKey = JSON.stringify(Object.entries(data.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const catalogSelection = useRef(selectedAccountsKey); catalogSelection.current = selectedAccountsKey;
  const loadNewTaskModels = useCallback(async (force = false) => {
    const request = ++catalogRequest.current, selection = catalogSelection.current;
    catalogRead.current?.abort(); const controller = new AbortController(); catalogRead.current = controller;
    try { const result = await getModels(force, undefined, controller.signal); if (request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels(result.models); setNewTaskModelError(result.error ?? ''); } }
    catch (cause) { if (!controller.signal.aborted && request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels([]); setNewTaskModelError(cause instanceof Error ? cause.message : 'Models could not be loaded.'); } }
    finally { if (catalogRead.current === controller) catalogRead.current = null; }
  }, []);
  useLayoutEffect(() => { setNewTaskModels([]); setNewTaskModelError(''); void loadNewTaskModels(); return () => { catalogRequest.current++; catalogRead.current?.abort(); catalogRead.current = null; }; }, [loadNewTaskModels, selectedAccountsKey]);
  const refreshModels = async (force = false) => { await Promise.all([loadModels(force), loadNewTaskModels(force)]); };
  const preferences = getPreferences(data.settings);
  const [browserUrl, setBrowserUrl] = useState(preferences.browserStartUrl);
  useLayoutEffect(() => { navigation.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); content.current?.scrollTo(0, 0); }, [section]);
  const persist = async (payload: Record<string, unknown>) => {
    if (busy) return false;
    setBusy(true); setSaved(false); setError('');
    try { await settingsOperation(async () => {await command('settings.update', payload); await refresh();}); setSaved(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved. Retry your change.'); return false; }
    finally { setBusy(false); }
  };
  const update = async (value: Partial<UiPreferences>) => {
    if (!desktop && (value.threadNotifications === 'notifications' || value.threadNotifications === 'both')) {
      if (!('Notification' in window)) { setError('Notifications are unavailable in this browser.'); return; }
      if (await Notification.requestPermission() !== 'granted') { setError('Notification permission was not granted. Your saved preference has not changed.'); return; }
    }
    await persist({ preferences: value });
  };
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean), searching = tokens.length > 0;
  const rows = SETTINGS_ROWS.filter(item => searching ? tokens.every(token => `${item.title} ${item.terms} ${SETTINGS_SECTIONS.find(([id]) => id === item.section)?.[1] ?? ''}`.toLocaleLowerCase().includes(token)) : item.section === section);
  const matches = (id: string) => rows.some(item => item.id === id);
  const subscriptions = searching ? matchingSubscriptionConnections(query).length : 0;
  const heading = searching ? `Search results (${rows.length + subscriptions})` : SETTINGS_SECTIONS.find(([id]) => id === section)?.[1];
  const showAppearance = rows.some(item => item.section === 'appearance');
  // While searching, highlight the first result's section instead of leaving a
  // stale selection; aria-current stays clear so search is not a page change.
  const activeSection = searching ? rows[0]?.section : section;
  const customRows = new Set(['harness-personalization', 'chat-width', 'word-wrap', 'harness-project-colors', 'harness-notification-controls', 'harness-accounts', 'harness-skills', 'harness-integrations', 'browser-start-page', 'app-version']);
  const chooseSection = (id: string) => { setQuery(''); setSection(id); };
  const details = (item: SettingsInventoryRow): { description: string; control: ReactNode } => {
    if (preferenceRows[item.id]) return { description: preferenceRows[item.id]!.description, control: <PreferenceControl item={item} preferences={preferences} update={update} busy={busy}/> };
    if (item.id.startsWith('harness-keybinding-')) { const action = item.id.slice('harness-keybinding-'.length) as keyof UiPreferences['keybindings']; return { description: 'Focus and press a shortcut.', control: <ShortcutInput action={action} label={item.title} value={preferences.keybindings[action]} busy={busy} save={(key, value) => void persist({ preferences: { keybindings: { [key]: value } } })}/> }; }
    if (item.id.startsWith('license-')) { const notice = DEPENDENCY_NOTICES.find(([name]) => name === item.title)!; return { description: `Version ${notice[1]} · ${notice[2]}. Complete LICENSE and NOTICE files remain in the installed package.`, control: <a href={`https://www.npmjs.com/package/${encodeURIComponent(notice[0])}/v/${notice[1]}`} target="_blank" rel="noreferrer">Package notice<ExternalLink size={12}/></a> }; }
    switch (item.id) {
      case 'harness-local-models': return { description: `${newTaskModels.length} models reported by connected runtimes.`, control: <button type="button" className="secondary" disabled={busy} onClick={() => void refreshModels(true)}>Refresh models</button> };
      case 'default-model': return { description: 'Used for new work. Existing conversations keep their selected model and account.', control: <Select aria-label="Default model" disabled={busy || newTaskModels.length === 0} value={data.settings.modelId ?? ''} options={[{ value: '', label: 'Select model', disabled: true }, ...newTaskModels.map(model => ({ value: model.id, label: model.name }))]} onValueChange={modelId => void persist({ modelId })}/> };
      case 'harness-runtime': return { description: desktop ? 'Runs locally in the Windows app.' : 'Uses the local host. Connect a subscription with pnpm agent:login in the project terminal.', control: <span className="settings-value">Local host</span> };
      case 'project-overview': return { description: 'Access stays scoped to each explicit resource grant. Git and working-copy actions remain in the project workspace.', control: <button type="button" className="secondary" onClick={addResource}>Add resource</button> };
      case 'archive': return { description: 'Restore reopens a saved conversation without resuming its run.', control: <span className="settings-value">{data.counts.archivedThreads} archived</span> };
      case 'harness-draft-transfer': return { description: 'Transfer browser-local drafts. Existing or incompatible desktop entries stay available for review.', control: <DraftTransfer references={draftReferences}/> };
      case 'harness-export-diagnostics': return { description: `Accepted event ${data.sequence} · ${data.counts.threads} threads · ${data.counts.artifacts} artifacts · ${data.counts.resources} grants · ${data.counts.uncertainOperations} uncertain operations. Credentials and file contents are excluded.`, control: <button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void refresh().catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Refresh settings</button> };
      case 'harness-licenses': return { description: 'Settings presentation and account selection adapted from T3 Code, pinned 8760d063. Copyright (c) 2026 T3 Tools Inc. Full MIT notice and selective source ranges/hashes: third-party/t3code.', control: <a href="https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/LICENSE" target="_blank" rel="noreferrer">MIT notice<ExternalLink size={12}/></a> };
      case 'harness-hermes-license': return { description: 'Skill learning adapted from Hermes Agent. Copyright (c) 2025 Nous Research. Complete MIT notice retained in third-party/hermes-agent.', control: <a href="https://github.com/NousResearch/hermes-agent/blob/c627ec84664d43e0b18b95d9d86d8963747d56c7/LICENSE" target="_blank" rel="noreferrer">MIT notice<ExternalLink size={12}/></a> };
      case 'harness-dependency-notices': return { description: 'Direct package notices are listed below. Full transitive distribution notices are not assembled in this interface.', control: <span className="settings-value">{DEPENDENCY_NOTICES.length} packages</span> };
      default: return { description: '', control: null };
    }
  };
  return <div className="settings-layout">
    <aside className="settings-navigation"><label className="settings-search"><Search size={14}/><input type="search" aria-label="Search all settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <nav ref={navigation} aria-label="Settings sections" onKeyDown={event => { if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; const buttons = [...event.currentTarget.querySelectorAll('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>
        {SETTINGS_SECTIONS.map(([id, label]) => <button type="button" key={id} className={activeSection === id ? 'selected' : ''} onClick={() => chooseSection(id)} aria-current={!searching && section === id ? 'page' : undefined}>{label}</button>)}
      </nav>
    </aside>
    <main ref={content} className="settings-content" aria-label="Settings content"><div className="settings-page-heading"><h1>{heading}</h1><span className="settings-save-state" role="status">{busy ? 'Saving…' : saved ? <><Check size={12}/>Saved</> : null}</span></div>
      {error && <p role="alert" className="notice error-text">{error}</p>}
      {showAppearance && <AppearanceSettings preferences={preferences} theme={data.settings.theme} projects={data.projects} busy={busy} query={searching ? query : ''} save={(patch, theme) => persist({ preferences: patch, ...(theme ? { theme } : {}) })}/>}
      {rows.filter(item => !customRows.has(item.id)).map(item => { const { description, control } = details(item); return <section key={item.id} className="settings-row" data-setting-id={item.id} data-availability="working"><div className="settings-row-copy"><h2>{item.title}</h2>{searching && <span className="settings-result-section">{SETTINGS_SECTIONS.find(([id]) => id === item.section)?.[1]}</span>}<p>{description}</p></div><div className="settings-row-control">{control}</div></section>; })}
      {matches('harness-notification-controls') && <NotificationSettings preferences={preferences} busy={busy} update={update}/>}
      {matches('harness-runtime') && environmentSettings}
      {matches('harness-skills') && <SkillLibrary snapshot={data} preferences={preferences} update={update} refresh={refresh} busy={busy}/>}
      {matches('harness-integrations') && <IntegrationSettings/>}
      {(matches('harness-accounts') || subscriptions > 0) && <Connections models={newTaskModels} snapshot={data} refresh={refresh} loadModels={refreshModels} query={searching ? query : ''}/>}
      {newTaskModelError && rows.some(item => item.section === 'providers') && <p role="alert" className="error-text">{newTaskModelError}</p>}
      {matches('project-overview') && <div className="settings-records">{data.resources.map(resource => <div key={resource.id}><strong>{resource.label}</strong><span>{resource.kind} · {resource.writable ? 'Approved changes allowed' : 'Read only'}</span><code>{resource.path}</code></div>)}</div>}
      {matches('archive') && <div className="settings-records">{data.counts.archivedThreads !== data.archivedThreads.length && <p className="settings-empty">Showing {data.archivedThreads.length} archived conversations available in navigation. The total also includes conversations outside this list.</p>}{data.archivedThreads?.length ? data.archivedThreads.map(thread => <section className="settings-row" key={thread.id}><div className="settings-row-copy"><h2>{thread.title}</h2><p>{thread.projectName ?? 'Conversation'} · {thread.status}</p></div><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void settingsOperation(() => command('thread.restore', {}, thread.id).then(refresh)).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Restore thread</button></section>) : <p className="settings-empty">{data.counts.archivedThreads ? 'No archived conversations are available in navigation.' : 'No archived threads.'}</p>}</div>}
      {matches('app-version') && <><p className="settings-version">Gen V1 {version} · {desktop ? 'Windows desktop' : 'Browser build'}</p><UpdateControl/></>}
      {matches('browser-start-page') && <section className="settings-card"><h2>Manual browser</h2>{openBrowser ? <form onSubmit={event => { event.preventDefault(); void persist({ preferences: { browserStartUrl: browserUrl } }); }}><label className="field">Start page<input aria-label="Browser start page" type="url" placeholder="Blank page" maxLength={2048} value={browserUrl} disabled={busy} onChange={event => setBrowserUrl(event.target.value)}/></label><div className="settings-inline-controls"><button className="secondary" disabled={busy || browserUrl === preferences.browserStartUrl}>Save start page</button><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void openBrowser(preferences.browserStartUrl).then(close).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Open browser</button></div></form> : <p className="settings-card-intro">Open the manual browser from the Windows desktop workspace. Navigation, reload and stop stay in its toolbar.</p>}</section>}
      {rows.length === 0 && subscriptions === 0 && <p className="settings-empty">No matching settings.</p>}
    </main>
  </div>;
}
