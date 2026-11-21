import {settingsOperation, settleSettingsOperations} from './settings-operations';
import {registerEditorHandoff} from './editor-handoff';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {notifyAccountAuthChanged,onAccountCatalogChanged,mergeAccountModels} from './account-api';
import type {AccountAuthTarget} from '../../../packages/contracts/authentication';
import { Bell, Boxes, Check, Database, ExternalLink, Folder, GitBranch, Globe, Info, Keyboard, MessageSquare, Palette, Plug, Search, Settings2, type LucideIcon } from 'lucide-react';
import type { ModelInfo, Snapshot } from '../../../packages/contracts';
import { getPreferences, type UiPreferences } from '../../../packages/contracts/preferences';
import { Select } from '../../../packages/ui-shell/Select';
import { command, getModels } from './api';
import type { SettingsInventoryRow } from './settings-inventory';
import { buildSupportedSettings, searchSettings, GROUPS, type SupportedSettingRow } from './settings-registry';
import { PREFERENCE_BINDINGS, chordFor } from './keyboard-bindings';
import { matchesShortcut } from './shell-layout';
import { KeyboardReference } from './KeyboardReference';
import { DEPENDENCY_NOTICES } from './dependency-notices';
import { DraftTransfer } from './DraftTransfer';
import { useDesktop } from './desktop-context';
import { Connections } from './Connections';
import { SUBSCRIPTION_CONNECTIONS } from '../../../packages/contracts/connections';
import { SkillLibrary } from './SkillLibrary';
import { IntegrationSettings } from './IntegrationSettings';
import { UpdateControl } from './UpdateControl';
import { AppearanceSettings, NotificationSettings, APPEARANCE_FIELDS } from './AppearanceSettings';
import { PairedDevicesPanel } from './PairedDevicesPanel';
import { AgentFileProtection } from './AgentFileProtection';
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
const SECTION_ICONS: Record<string, LucideIcon> = {general: Settings2, appearance: Palette, chat: MessageSquare, providers: Plug, projects: Folder, diffs: GitBranch, skills: Boxes, notifications: Bell, browser: Globe, keybindings: Keyboard, maintenance: Database, about: Info};
const legacySections: Record<string, string> = { threads: 'chat', integrations: 'skills', connections: 'providers', 'source-control': 'diffs', worktrees: 'projects', archived: 'maintenance', diagnostics: 'maintenance', licenses: 'about' };
const preferenceRows: Record<string, { key: keyof UiPreferences; options?: readonly string[]; labels?: readonly string[]; description: string }> = {
  'time-format': { key: 'timeFormat', options: ['system', '12h', '24h'], labels: ['System', '12 hour', '24 hour'], description: 'Clock format for thread and activity timestamps.' },
  'archive-confirmation': { key: 'archiveConfirmation', description: 'Ask before archiving.' },
  'unpin-confirmation': { key: 'unpinConfirmation', description: 'Ask before removing a pinned thread.' },
  'composer-context': { key: 'showComposerContext', description: 'Show conversation capacity beside the composer.' },
  'harness-composer-predictions': { key: 'composerPredictions', description: 'Uses the selected model and subscription quota.' },
  'thread-details-items': { key: 'showThreadDetails', description: 'Show task status in the conversation header.' },
  'project-grouping': { key: 'projectGrouping', description: 'Group sidebar threads by project.' },
  'project-order': { key: 'projectOrder', options: ['recent', 'created', 'manual'], labels: ['Recent activity', 'Creation time', 'Manual'], description: 'Order project groups in the sidebar.' },
  'working-shelf': { key: 'showWorkingSection', description: 'Group active tasks in the Working section.' },
  'thread-notifications': { key: 'threadNotifications', options: ['off', 'notifications', 'sound', 'both'], labels: ['Off', 'Popups', 'Sound', 'Popups and sound'], description: 'Task completion, failure, and input requests.' },
  'in-app-notifications': { key: 'inAppNotifications', description: 'Show notices for other tasks in the app.' },
  'live-usage': { key: 'showUsageFooter', description: 'Show the compact Live usage summary.' },
  'send-shortcut': { key: 'sendShortcut', options: ['enter', 'mod-enter-multiline', 'mod-enter'], labels: ['Enter to send', 'Ctrl / ⌘ Enter; expandable input', 'Ctrl / ⌘ Enter to send'], description: 'Shift Enter inserts a new line.' },
  'diff-layout': { key: 'diffLayout', options: ['stacked', 'split'], labels: ['Stacked', 'Side by side'], description: 'Layout for recorded before/after comparisons. Unified source patches stay verbatim.' },
  'hide-whitespace-changes': { key: 'hideWhitespace', description: 'Hide whitespace-only differences and unchanged lines in recorded before/after comparisons.' },
  'default-diff-file-state': { key: 'diffDefaultExpanded', description: 'Expand executor diff records when opening review.' },
  'diff-color-scheme': { key: 'diffColors', options: ['red-green', 'blue-orange'], labels: ['Red and green', 'Blue and orange'], description: 'Before/after tint for recorded comparisons.' },
};
const row = (id: string, title: string, section: string, terms = ''): SettingsInventoryRow => ({ id, title, section, terms });
export const SETTINGS_ROWS: SettingsInventoryRow[] = [
  row('time-format', 'Time format', 'general'), row('archive-confirmation', 'Archive confirmation', 'general'), row('unpin-confirmation', 'Unpin confirmation', 'general'),
  row('harness-personalization', 'Appearance', 'appearance', 'theme dark light system accent custom contrast density compact comfortable touch fonts interface prompt code size radius motion speed reduced preview reset'),
  row('chat-width', 'Chat width', 'appearance', '680 760 full comfortable wide message composer'), row('word-wrap', 'Code line wrap', 'appearance'), row('harness-project-colors', 'Project colors', 'appearance', 'palette custom hex'),
  row('send-shortcut', 'Send shortcut', 'chat'), row('composer-context', 'Composer context', 'chat'), row('harness-composer-predictions', 'Suggest my next message', 'chat'), row('thread-details-items', 'Thread details', 'chat'), row('project-grouping', 'Group threads by project', 'chat'), row('project-order', 'Project order', 'chat'), row('working-shelf', 'Working section', 'chat'),
  row('harness-local-models', 'Available models', 'providers', 'refresh runtime'), row('default-model', 'Default model', 'providers'), row('harness-accounts', 'Accounts', 'providers', 'subscriptions sign in credentials'), row('harness-runtime', 'Local runtime & environments', 'providers', 'environment variables secret local host'),
  ...SUBSCRIPTION_CONNECTIONS.map(connection => row(`provider-${connection.id}`, connection.label, 'providers', `${connection.id} ${connection.description}`)),
  ...APPEARANCE_FIELDS.filter(field => field.id !== 'chat-width' && field.id !== 'word-wrap').map(field => row(field.id, field.label, 'appearance', field.terms)),
  row('project-overview', 'Granted resources', 'projects', 'project folder working copies permissions access'),
  row('agent-file-protection', 'Agent file protection', 'projects', 'secret deny agent file .env rules blocked pattern privacy'),
  row('diff-layout', 'Diff layout', 'diffs'), row('hide-whitespace-changes', 'Hide whitespace changes', 'diffs'), row('default-diff-file-state', 'Expand diffs', 'diffs'), row('diff-color-scheme', 'Diff colors', 'diffs'),
  row('harness-skills', 'Skills & learning', 'skills', 'library proposals automatic learning review archive restore rollback'), row('harness-integrations', 'Bundled integrations', 'skills', 'humanizer impeccable graphify superpowers ponytail tools hooks mcp'),
  row('thread-notifications', 'Task notifications', 'notifications', 'sound popup'), row('in-app-notifications', 'In-app notifications', 'notifications'), row('live-usage', 'Live usage', 'notifications'), row('harness-notification-controls', 'Notification preferences', 'notifications', 'volume sound preview privacy quiet hours'),
  row('browser-start-page', 'Start page', 'browser', 'manual browser address website'),
  ...PREFERENCE_BINDINGS.map(({ preference, label }) => row(`harness-keybinding-${preference}`, label, 'keybindings', `keyboard shortcut ${preference}`)),
  row('harness-keyboard-reference', 'Shortcut reference', 'keybindings', 'all shortcuts cheat sheet kbd keys chords bindings list'),
  row('harness-draft-transfer', 'Move browser drafts', 'maintenance', 'import export recovery transfer'), row('archive', 'Archived threads', 'maintenance', 'restore recovery'), row('harness-export-diagnostics', 'Workspace diagnostics', 'maintenance', 'snapshot counts uncertain operations refresh'), row('harness-paired-devices', 'Paired devices', 'maintenance', 'remote sync phone tablet pairing revoke read only'),
  row('app-version', 'Version & updates', 'about', 'update'), row('harness-licenses', 'T3 Code', 'about', 'copyright MIT license attribution settings account picker'), row('harness-hermes-license', 'Hermes Agent learning', 'about', 'Nous Research MIT license'), row('harness-dependency-notices', 'Dependency notices', 'about', 'licenses'),
  ...DEPENDENCY_NOTICES.map(([name, installed, license]) => row(`license-${name}`, name, 'about', `dependency ${installed} ${license}`)),
];
// Registration support only — functional effect evidence lives in the T07 effect inventory, never inferred here.
export function settingAvailability(item: SettingsInventoryRow): 'Registered' | 'Unavailable' { return SETTINGS_ROWS.some(value => value.id === item.id) ? 'Registered' : 'Unavailable'; }
const SUPPORTED_SETTINGS = buildSupportedSettings(SETTINGS_ROWS, SETTINGS_SECTIONS);
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
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [connectionProvider,setConnectionProvider]=useState('openai');
  const [connectionsOpened,setConnectionsOpened]=useState(target==='providers');
  const [newTaskModels, setNewTaskModels] = useState<ModelInfo[]>([]), [newTaskModelError, setNewTaskModelError] = useState(modelError);
  const catalogRequest = useRef(0), catalogRead = useRef<AbortController|null>(null);
  const selectedAccountsKey = JSON.stringify(Object.entries(data.settings.selectedAccounts ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const catalogSelection = useRef(selectedAccountsKey); catalogSelection.current = selectedAccountsKey;
  const selectedAccounts=useRef(data.settings.selectedAccounts);selectedAccounts.current=data.settings.selectedAccounts;
  const loadNewTaskModels = useCallback(async (force = false,target?:AccountAuthTarget) => {
    const request = ++catalogRequest.current, selection = catalogSelection.current;
    catalogRead.current?.abort(); const controller = new AbortController(); catalogRead.current = controller;
    try { const result = await getModels(force, undefined, controller.signal,target); if (request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels(current=>mergeAccountModels(current,result.models,target)); setNewTaskModelError(result.error ?? ''); } }
    catch (cause) { if (!controller.signal.aborted && request === catalogRequest.current && selection === catalogSelection.current) { setNewTaskModels(current=>mergeAccountModels(current,[],target)); setNewTaskModelError(cause instanceof Error ? cause.message : 'Models could not be loaded.'); } }
    finally { if (catalogRead.current === controller) catalogRead.current = null; }
  }, []);
  useLayoutEffect(() => { setNewTaskModels([]); setNewTaskModelError(''); void loadNewTaskModels(true); return () => { catalogRequest.current++; catalogRead.current?.abort(); catalogRead.current = null; }; }, [loadNewTaskModels, selectedAccountsKey]);
  useEffect(()=>onAccountCatalogChanged(async (target,reason)=>{if(reason!=='reconciled'&&(selectedAccounts.current?.[target.providerId]??null)===target.accountId)await loadNewTaskModels(true,target);}),[loadNewTaskModels]);
  const refreshModels = async (force = false) => { await Promise.all([loadModels(force), loadNewTaskModels(force)]); };
  const preferences = getPreferences(data.settings);
  const [browserUrl, setBrowserUrl] = useState(preferences.browserStartUrl);
  useLayoutEffect(() => { navigation.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); content.current?.scrollTo(0, 0); }, [section]);
  // A selected search result scrolls to its real target and focuses its control (T06).
  useLayoutEffect(() => {
    if (!pendingTarget) return;
    const node = content.current?.querySelector<HTMLElement>(`[data-setting-id="${CSS.escape(pendingTarget)}"]`);
    setPendingTarget(null);
    if (!node) { if (content.current) { content.current.tabIndex = -1; content.current.focus(); } return; }
    if (node instanceof HTMLDetailsElement) node.open = true;
    const viewport=content.current!,target=node.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();
    const scale=bounds.height/viewport.offsetHeight||1;
    viewport.scrollTop+=(target.top-bounds.top)/scale-Math.max(0,(viewport.clientHeight-target.height/scale)/2);
    const focusable = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary, [tabindex]')].find(element=>!element.matches(':disabled')&&element.tabIndex>=0&&element.getClientRects().length&&!element.closest('[inert], [hidden]')&&getComputedStyle(element).visibility!=='hidden');
    if (focusable) focusable.focus({preventScroll:true}); else { node.tabIndex = -1; node.focus({preventScroll:true}); }
  }, [pendingTarget, section]);
  const persist = async (payload: Record<string, unknown>) => {
    if (busy) return false;
    setBusy(true); setSaved(false); setError('');
    try { await settingsOperation(async () => {await command('settings.update', payload); await refresh();}); setSaved(true); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Settings could not be saved. Retry your change.'); return false; }
    finally { setBusy(false); }
  };
  const update = async (value: Partial<UiPreferences>) => {
    // System popup/sound delivery exists only in the Windows app (host attentionRead);
    // the browser keeps in-app notices, so no browser permission is requested (T07).
    await persist({ preferences: value });
  };
  const searching = query.trim().length > 0;
  const rows = searching ? searchSettings(query, SUPPORTED_SETTINGS, desktop ? 'desktop' : 'browser') : SUPPORTED_SETTINGS.filter(item => item.section === section);
  const matches = (id: string) => rows.some(item => item.id === id);
  const heading = searching ? `Search results (${rows.length})` : SETTINGS_SECTIONS.find(([id]) => id === section)?.[1];
  const HeadingIcon = searching ? Search : SECTION_ICONS[section] ?? Settings2;
  const showAppearance = !searching && section === 'appearance';
  const customRows = new Set(['harness-personalization', 'chat-width', 'word-wrap', 'harness-project-colors', 'harness-notification-controls', 'harness-accounts', 'harness-skills', 'harness-integrations', 'harness-keyboard-reference', 'harness-paired-devices', 'browser-start-page', 'app-version', 'agent-file-protection', ...APPEARANCE_FIELDS.map(field => field.id), ...SUBSCRIPTION_CONNECTIONS.map(connection => `provider-${connection.id}`)]);
  const chooseSection = (id: string) => { if(id==='providers')setConnectionsOpened(true);setQuery(''); setSection(id); };
  const revealTarget = (item: SupportedSettingRow) => { if(item.targetId.startsWith('provider-'))setConnectionProvider(item.targetId.slice('provider-'.length));chooseSection(item.section); setPendingTarget(item.targetId); };
  const details = (item: SettingsInventoryRow): { description: string; control: ReactNode } => {
    if (item.id === 'thread-notifications') return { description: desktop ? preferenceRows[item.id]!.description : `${preferenceRows[item.id]!.description} System popups and sound are unavailable in this browser build; in-app notices stay active.`, control: <PreferenceControl item={item} preferences={preferences} update={update} busy={busy}/> };
    if (preferenceRows[item.id]) return { description: preferenceRows[item.id]!.description, control: <PreferenceControl item={item} preferences={preferences} update={update} busy={busy}/> };
    if (item.id.startsWith('harness-keybinding-')) { const action = item.id.slice('harness-keybinding-'.length) as keyof UiPreferences['keybindings']; return { description: 'Focus and press a shortcut.', control: <ShortcutInput action={action} label={item.title} value={preferences.keybindings[action]} busy={busy} save={(key, value) => void persist({ preferences: { keybindings: { [key]: value } } })}/> }; }
    if (item.id.startsWith('license-')) { const notice = DEPENDENCY_NOTICES.find(([name]) => name === item.title)!; return { description: `Version ${notice[1]} · ${notice[2]}. Complete LICENSE and NOTICE files remain in the installed package.`, control: <a href={`https://www.npmjs.com/package/${encodeURIComponent(notice[0])}/v/${notice[1]}`} target="_blank" rel="noreferrer">Package notice<ExternalLink size={12}/></a> }; }
    switch (item.id) {
      case 'harness-local-models': return { description: `${newTaskModels.length} ${newTaskModels.length === 1 ? 'model' : 'models'} reported by connected runtimes.`, control: <button type="button" className="secondary" disabled={busy} onClick={() => void refreshModels(true)}>Refresh models</button> };
      case 'default-model': return { description: 'New conversations only.', control: <Select aria-label="Default model" disabled={busy || newTaskModels.length === 0} value={data.settings.modelId ?? ''} options={[{ value: '', label: 'Select model', disabled: true }, ...newTaskModels.map(model => ({ value: model.id, label: model.name }))]} onValueChange={modelId => void persist({ modelId })}/> };
      case 'harness-runtime': return { description: desktop ? 'Runs locally in the Windows app.' : '', control: <span className="settings-value">Local host</span> };
      case 'project-overview': return { description: 'Files, folders and databases.', control: <button type="button" className="secondary" onClick={addResource}>Add resource</button> };
      case 'archive': return { description: 'Restore reopens a saved conversation without resuming its run.', control: <span className="settings-value">{data.counts.archivedThreads} archived</span> };
      case 'harness-draft-transfer': return { description: '', control: <DraftTransfer references={draftReferences}/> };
      case 'harness-export-diagnostics': return { description: `Accepted event ${data.sequence} · ${data.counts.threads} threads · ${data.counts.artifacts} artifacts · ${data.counts.resources} grants · ${data.counts.uncertainOperations} uncertain operations. Credentials and file contents are excluded.`, control: <button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void refresh().catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Refresh settings</button> };
      case 'harness-licenses': return { description: 'Settings presentation and account selection adapted from T3 Code, pinned 8760d063. Copyright (c) 2026 T3 Tools Inc. Full MIT notice and selective source ranges/hashes: third-party/t3code.', control: <a href="https://github.com/pingdotgg/t3code/blob/8760d063e903406c8e8f695b0852c0a15fc1e00f/LICENSE" target="_blank" rel="noreferrer">MIT notice<ExternalLink size={12}/></a> };
      case 'harness-hermes-license': return { description: 'Skill learning adapted from Hermes Agent. Copyright (c) 2025 Nous Research. Complete MIT notice retained in third-party/hermes-agent.', control: <a href="https://github.com/NousResearch/hermes-agent/blob/c627ec84664d43e0b18b95d9d86d8963747d56c7/LICENSE" target="_blank" rel="noreferrer">MIT notice<ExternalLink size={12}/></a> };
      case 'harness-dependency-notices': return { description: 'Direct package notices are listed below. Full transitive distribution notices are not assembled in this interface.', control: <span className="settings-value">{DEPENDENCY_NOTICES.length} packages</span> };
      default: return { description: '', control: null };
    }
  };
  return <div className={matches('harness-skills') ? 'settings-layout settings-skills' : 'settings-layout'} onKeyDown={event => { if (searching && !event.nativeEvent.isComposing && matchesShortcut(event, chordFor('settings-clear-search'))) { event.preventDefault(); event.stopPropagation(); setQuery(''); } }}>
    <aside className="settings-navigation"><label className="settings-search"><Search size={14}/><input type="search" aria-label="Search all settings" placeholder="Search settings" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="settings-section-select"><Select aria-label="Settings section" value={section} options={SETTINGS_SECTIONS.map(([value, label]) => ({value, label}))} onValueChange={chooseSection}/></div>
      <nav ref={navigation} aria-label="Settings sections" onKeyDown={event => { if (event.nativeEvent.isComposing) return; const intent = matchesShortcut(event, chordFor('settings-next-section')) ? 'next' : matchesShortcut(event, chordFor('settings-previous-section')) ? 'previous' : matchesShortcut(event, chordFor('settings-first-section')) ? 'first' : matchesShortcut(event, chordFor('settings-last-section')) ? 'last' : null; if (!intent) return; const buttons = [...event.currentTarget.querySelectorAll('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement); event.preventDefault(); buttons[intent === 'first' ? 0 : intent === 'last' ? buttons.length - 1 : (index + (intent === 'next' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }}>
        {[...new Set(SETTINGS_SECTIONS.map(([id]) => GROUPS[id] ?? id))].map(group => {
          const sections = SETTINGS_SECTIONS.filter(([id]) => (GROUPS[id] ?? id) === group);
          return <div className="settings-nav-group" key={group}>{sections.length > 1 && <h2>{group}</h2>}{sections.map(([id, label]) => {const Icon = SECTION_ICONS[id] ?? Settings2;return <button type="button" key={id} className={!searching && section === id ? 'selected' : ''} onClick={() => chooseSection(id)} aria-current={!searching && section === id ? 'page' : undefined}><Icon size={17} aria-hidden="true"/><span>{label}</span></button>;})}</div>;
        })}
      </nav>
    </aside>
    <main ref={content} className="settings-content" aria-label="Settings content"><div className="settings-page-heading"><span className="settings-heading-icon"><HeadingIcon size={21} aria-hidden="true"/></span><div><h1>{heading}</h1></div><span className="settings-save-state" data-state={busy ? 'saving' : saved ? 'saved' : 'idle'} role="status">{busy ? 'Saving…' : saved ? <><Check size={12}/>Saved</> : null}</span></div>
      {error && <p role="status" className="notice error-text">{error}</p>}
      {connectionsOpened && <div data-setting-id="harness-accounts" hidden={searching||section!=='providers'}><Connections snapshot={data} refresh={refresh} loadModels={refreshModels} onAuthChanged={notifyAccountAuthChanged} providerId={connectionProvider} onProviderChange={setConnectionProvider}/></div>}
      {searching ? <>
        <div className="settings-results">
          {rows.map(item => <button type="button" key={item.id} className="settings-result" onClick={() => revealTarget(item)}><strong>{item.title}</strong><span className="settings-result-section">{item.group} · {item.sectionLabel}</span></button>)}
        </div>
        {rows.length === 0 && <p className="settings-empty">No matching settings.</p>}
      </> : <>
      {showAppearance && <div data-setting-id="harness-personalization"><AppearanceSettings preferences={preferences} theme={data.settings.theme} projects={data.projects} busy={busy} save={(patch, theme) => persist({ preferences: patch, ...(theme ? { theme } : {}) })}/></div>}
      {rows.filter(item => !customRows.has(item.id)).map(item => { const { description, control } = details(item); return <section key={item.id} className="settings-row" data-setting-id={item.id==='harness-runtime'?'harness-runtime-summary':item.id}><div className="settings-row-copy"><h2>{item.title}</h2>{description&&<p>{description}</p>}</div><div className="settings-row-control">{control}</div></section>; })}
      {matches('harness-keyboard-reference') && <div data-setting-id="harness-keyboard-reference"><KeyboardReference keybindings={preferences.keybindings}/></div>}
      {matches('harness-notification-controls') && <div data-setting-id="harness-notification-controls"><NotificationSettings preferences={preferences} busy={busy} update={update} desktop={Boolean(desktop)}/></div>}
      {matches('harness-runtime') && <details className="settings-runtime-details" data-setting-id="harness-runtime"><summary>Environment variables and advanced runtime settings</summary>{environmentSettings ?? <p className="settings-card-intro">Environment controls are unavailable in this view.</p>}</details>}
      {matches('harness-skills') && <div data-setting-id="harness-skills"><SkillLibrary snapshot={data} preferences={preferences} update={update} refresh={refresh} busy={busy}/></div>}
      {matches('harness-integrations') && <div data-setting-id="harness-integrations"><IntegrationSettings/></div>}
      {matches('harness-paired-devices') && <div data-setting-id="harness-paired-devices"><PairedDevicesPanel/></div>}
      {newTaskModelError && rows.some(item => item.section === 'providers') && <p role="status" className="error-text">{newTaskModelError}</p>}
      {matches('agent-file-protection') && <AgentFileProtection projects={data.projects.map(project => ({id: `project:${project.id}`, label: project.name}))} busy={busy}/>}
      {matches('project-overview') && <div className="settings-records">{data.resources.map(resource => <div key={resource.id}><strong>{resource.label}</strong><span>{resource.kind} · {resource.writable ? 'Approved changes allowed' : 'Read only'}</span><code>{resource.path}</code></div>)}</div>}
      {matches('archive') && <div className="settings-records">{data.counts.archivedThreads !== data.archivedThreads.length && <p className="settings-empty">Showing {data.archivedThreads.length} archived conversations available in navigation. The total also includes conversations outside this list.</p>}{data.archivedThreads?.length ? data.archivedThreads.map(thread => <section className="settings-row" key={thread.id}><div className="settings-row-copy"><h2>{thread.title}</h2><p>{thread.projectName ?? 'Conversation'} · {thread.status}</p></div><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void settingsOperation(() => command('thread.restore', {}, thread.id).then(refresh)).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Restore thread</button></section>) : <p className="settings-empty">{data.counts.archivedThreads ? 'No archived conversations are available in navigation.' : 'No archived threads.'}</p>}</div>}
      {matches('app-version') && <div data-setting-id="app-version"><p className="settings-version">Gen V1 {version} · {desktop ? 'Windows desktop' : 'Browser build'}</p><UpdateControl/></div>}
      {matches('browser-start-page') && <section className="settings-card" data-setting-id="browser-start-page"><h2>Manual browser</h2>{openBrowser ? <form onSubmit={event => { event.preventDefault(); void persist({ preferences: { browserStartUrl: browserUrl } }); }}><label className="field">Start page<input aria-label="Browser start page" type="url" placeholder="Blank page" maxLength={2048} value={browserUrl} disabled={busy} onChange={event => setBrowserUrl(event.target.value)}/></label><div className="settings-inline-controls"><button className="secondary" disabled={busy || browserUrl === preferences.browserStartUrl}>Save start page</button><button type="button" className="secondary" disabled={busy} onClick={() => { setBusy(true); void openBrowser(preferences.browserStartUrl).then(close).catch(cause => setError(String(cause))).finally(() => setBusy(false)); }}>Open browser</button></div></form> : <p className="settings-card-intro">Open the manual browser from the Windows desktop workspace. Navigation, reload and stop stay in its toolbar.</p>}</section>}
      </>}
    </main>
  </div>;
}
