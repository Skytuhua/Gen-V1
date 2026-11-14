import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { DEFAULT_PREFERENCES, PROJECT_PALETTE, projectColorSchema, type ProjectAccent, type UiPreferences } from '../../../packages/contracts/preferences';
import { Select } from '../../../packages/ui-shell/Select';
import type { Thread } from '../../../packages/contracts';
import { usagePercent } from './usage-presentation';
import { applyAppearance } from './useAppearance';
import { projectColor, projectColorKey } from './project-colors';
import './appearance-settings.css';

type Theme = 'system' | 'light' | 'dark';
const appearanceKeys = ['appearanceAccent', 'customAccent', 'density', 'interfaceFont', 'promptFont', 'codeFont', 'fontSize', 'uiFontSize', 'chatFontSize', 'codeFontSize', 'controlRadius', 'chatWidth', 'wordWrap', 'contrast', 'motion', 'motionSpeed', 'panelAnimations', 'motionDuration'] as const;
const appearancePatch = (preferences: UiPreferences) => Object.fromEntries(appearanceKeys.map(key => [key, preferences[key]])) as Partial<UiPreferences>;
const applyTheme = (theme: Theme) => { document.documentElement.dataset.theme = theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme; };
export function accentContrast(color: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(color), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function AppearanceRow({ label, children, description, value }: { label: string; children: ReactNode; description?: string; value?: ReactNode }) {
  return <div className="settings-card-row"><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="settings-inline-controls">{value}{children}</div></div>;
}
export function AppearanceSettings({ preferences, theme, threads = [], projects: projectMetadata, busy, save, query = '' }: { preferences: UiPreferences; theme: Theme; threads?: Pick<Thread, 'projectId' | 'projectName'>[]; projects?: {id: string; name: string}[]; busy: boolean; save: (patch: Partial<UiPreferences>, theme?: Theme) => Promise<boolean>; query?: string }) {
  const [draft, setDraft] = useState(preferences), [draftTheme, setDraftTheme] = useState(theme), [preview, setPreview] = useState(false), [error, setError] = useState('');
  const [numberDrafts,setNumberDrafts]=useState<Partial<Record<'uiFontSize'|'chatFontSize'|'codeFontSize',string>>>({});
  const current = useRef({ preferences, theme }); current.current = { preferences, theme };
  useEffect(() => () => { applyAppearance(current.current.preferences); applyTheme(current.current.theme); }, []);
  const dirty = JSON.stringify(appearancePatch(draft)) !== JSON.stringify(appearancePatch(preferences)) || draftTheme !== theme;
  const accentError = draft.customAccent !== null && (!projectColorSchema.safeParse(draft.customAccent).success ? 'Use a six-digit hex color.' : Math.min(accentContrast(draft.customAccent, '#0F0F0F'), accentContrast(draft.customAccent, '#FFFFFF')) < 3 ? 'Choose a color with at least 3:1 contrast on both light and dark surfaces.' : '');
  const change = (patch: Partial<UiPreferences>) => { const next = { ...draft, ...patch }; setDraft(next); setError(''); if (preview && (!next.customAccent || projectColorSchema.safeParse(next.customAccent).success && Math.min(accentContrast(next.customAccent, '#0F0F0F'), accentContrast(next.customAccent, '#FFFFFF')) >= 3)) applyAppearance(next); };
  const restore = () => { setDraft(preferences); setDraftTheme(theme); setPreview(false); setError(''); applyAppearance(preferences); applyTheme(theme); };
  const choices = (key: keyof UiPreferences, label: string, options: readonly (readonly [string, string])[]) => <Select aria-label={label} value={String(draft[key])} disabled={busy} options={options.map(([value, text]) => ({ value, label: text }))} onValueChange={value => change({ [key]: typeof draft[key] === 'number' ? Number(value) : value, ...(key === 'uiFontSize' ? { fontSize: Number(value) } : {}), ...(key === 'motion' ? { panelAnimations: value !== 'off' } : {}) })}/>;
  const size = (key: 'uiFontSize' | 'chatFontSize' | 'codeFontSize', label: string, min: number, max: number) => <input type="number" aria-label={label} min={min} max={max} step={1} disabled={busy} value={numberDrafts[key]??draft[key]} onChange={event => { const text=event.target.value,value=event.target.valueAsNumber;setNumberDrafts(current=>({...current,[key]:text})); if (Number.isInteger(value) && value >= min && value <= max) change({ [key]: value, ...(key === 'uiFontSize' ? { fontSize: value } : {}) }); }} onBlur={()=>setNumberDrafts(current=>{const next={...current};delete next[key];return next;})}/>;
  const fonts = [['Inter', 'Inter'], ['system', 'System'], ['Arial', 'Arial'], ['Georgia', 'Georgia']] as const;
  const projects = projectMetadata ?? [...new Map(threads.filter(thread => thread.projectId).map(thread => [thread.projectId!, { id: thread.projectId!, name: thread.projectName ?? 'Project' }])).values()];
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const rowVisible = (label: string, description = '', terms = '') => tokens.every(token => `${label} ${description} ${terms}`.toLocaleLowerCase().includes(token));
  const appearanceRows: { label: string; description?: string; terms?: string; control: ReactNode }[] = [
    { label: 'Theme', terms: 'color scheme dark light system', control: <Select aria-label="Color scheme" disabled={busy} value={draftTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} onValueChange={value => { setDraftTheme(value as Theme); if (preview) applyTheme(value as Theme); }}/> },
    { label: 'Accent', terms: 'color palette', control: <div className="color-swatches" role="group" aria-label="Interface accent">{Object.entries(PROJECT_PALETTE).map(([name, color]) => <button type="button" key={name} className="color-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`${name} accent`} aria-pressed={draft.customAccent === null && draft.appearanceAccent === name} onClick={() => change({ appearanceAccent: name as ProjectAccent, customAccent: null })}>{draft.customAccent === null && draft.appearanceAccent === name && <Check size={12}/>}</button>)}</div> },
    { label: 'Custom accent', description: 'Hex color; checked against light and dark surfaces.', terms: 'hex color', control: <input aria-label="Custom accent" placeholder="#4F6EFF" maxLength={7} value={draft.customAccent ?? ''} aria-invalid={Boolean(accentError)} aria-describedby={accentError ? 'appearance-accent-error' : undefined} onChange={event => change({ customAccent: event.target.value || null })}/> },
    { label: 'Density', terms: 'compact comfortable touch', control: choices('density', 'Density', [['compact', 'Compact · 32 px'], ['comfortable', 'Comfortable · 36 px'], ['touch', 'Touch · 44 px']]) },
    { label: 'Interface font', terms: 'typeface', control: choices('interfaceFont', 'Interface font', fonts) },
    { label: 'Composer font', terms: 'typeface', control: choices('promptFont', 'Composer font', fonts) },
    { label: 'Code font', terms: 'typeface monospace', control: choices('codeFont', 'Code font', [['monospace', 'System monospace'], ['Consolas', 'Consolas'], ['Cascadia Code', 'Cascadia Code']]) },
    { label: 'UI size', terms: 'px pixels', control: <>{size('uiFontSize', 'UI size', 13, 16)}<span>px</span></> },
    { label: 'Chat size', terms: 'px pixels', control: <>{size('chatFontSize', 'Chat size', 14, 20)}<span>px</span></> },
    { label: 'Code size', terms: 'px pixels', control: <>{size('codeFontSize', 'Code size', 12, 18)}<span>px</span></> },
    { label: 'Control radius', terms: 'square rounded soft corners', control: choices('controlRadius', 'Control radius', [['0', 'Square · 0 px'], ['6', 'Rounded · 6 px'], ['10', 'Soft · 10 px']]) },
    { label: 'Chat width', terms: '680 760 full comfortable wide', control: choices('chatWidth', 'Chat width', [['comfortable', '680 px'], ['wide', '760 px'], ['full', 'Full available width']]) },
    { label: 'Code line wrap', terms: 'wrap lines', control: <button type="button" role="switch" className="settings-switch" aria-label="Code line wrap" aria-checked={draft.wordWrap} onClick={() => change({ wordWrap: !draft.wordWrap })}><span/></button> },
    { label: 'Contrast', terms: 'standard high', control: choices('contrast', 'Contrast', [['normal', 'Standard'], ['high', 'High']]) },
    { label: 'Motion', terms: 'system reduced off animation', control: choices('motion', 'Motion', [['system', 'System'], ['reduced', 'Reduced'], ['off', 'Off']]) },
    { label: 'Motion speed', terms: '0.75 1 1.25 duration', control: choices('motionSpeed', 'Motion speed', [['0.75', '0.75×'], ['1', '1×'], ['1.25', '1.25×']]) },
  ];
  const visibleRows = appearanceRows.filter(row => rowVisible(row.label, row.description, row.terms));
  const showProjectColors = rowVisible('Project colors', 'palette custom hex color') || projects.some(project => rowVisible(project.name));
  return <div className="appearance-settings">
    {visibleRows.length > 0 && <fieldset className="settings-card" disabled={busy}><legend>Appearance</legend>
      {visibleRows.map(row => <AppearanceRow key={row.label} label={row.label} description={row.description}>{row.control}</AppearanceRow>)}
      {accentError && <p id="appearance-accent-error" role="alert" className="error-text appearance-error">{accentError}</p>}
      {error && <p role="alert" className="error-text appearance-error">{error}</p>}
      <div className="appearance-actions"><button type="button" className="quiet" onClick={() => { setDraft({ ...preferences, ...appearancePatch(DEFAULT_PREFERENCES) }); setDraftTheme('dark'); setPreview(false); applyAppearance(preferences); applyTheme(theme); }}><RotateCcw size={13}/>Reset appearance</button><span/>{preview && <span role="status">Preview</span>}<button type="button" className="secondary" disabled={!dirty || Boolean(accentError)} onClick={() => { applyAppearance(draft); applyTheme(draftTheme); setPreview(true); }}>Preview</button><button type="button" className="quiet" disabled={!dirty && !preview} onClick={restore}>Cancel</button><button type="button" className="primary" disabled={!dirty || Boolean(accentError)} onClick={() => { void save(appearancePatch(draft), draftTheme).then(ok => { if (ok) setPreview(false); else setError('Appearance could not be saved. Your changes are ready to retry.'); }); }}>Apply</button></div>
    </fieldset>}
    {showProjectColors && <section className="settings-card" aria-labelledby="project-colors-heading"><h2 id="project-colors-heading">Project colors</h2>{projects.length > 0 ? projects.map(project => {
      const key = projectColorKey({ kind: 'local' }, project.id), selected = projectColor({ kind: 'local' }, project.id, preferences.projectColors);
      return <div className="settings-card-row" key={project.id}><strong>{project.name}</strong><div className="settings-inline-controls"><div className="color-swatches" role="group" aria-label={`Color for ${project.name}`}>{Object.entries(PROJECT_PALETTE).map(([name, color]) => <button type="button" key={name} className="color-swatch" style={{ '--swatch': color } as CSSProperties} disabled={busy} aria-label={`${name} for ${project.name}`} aria-pressed={selected === color} onClick={() => void save({ projectColors: { ...preferences.projectColors, [key]: color } })}>{selected === color && <Check size={12}/>}</button>)}</div><form className="project-custom-color" onSubmit={event => { event.preventDefault(); const color = String(new FormData(event.currentTarget).get('color')); if (!projectColorSchema.safeParse(color).success) { setError('Use a six-digit project hex color.'); return; } void save({ projectColors: { ...preferences.projectColors, [key]: color } }); }}><input name="color" key={selected} aria-label={`Custom color for ${project.name}`} defaultValue={selected} pattern="#[0-9a-fA-F]{6}" maxLength={7} disabled={busy}/><button className="secondary" disabled={busy}>Save color</button></form>{preferences.projectColors[key] && <button type="button" className="quiet" disabled={busy} aria-label={`Reset color for ${project.name}`} onClick={() => { const next = { ...preferences.projectColors }; delete next[key]; void save({ projectColors: next }); }}><RotateCcw size={13}/></button>}</div></div>;
    }) : <p className="settings-card-intro">Project colors appear when a conversation is connected to a project.</p>}</section>}
  </div>;
}

export function NotificationSettings({ preferences, busy, update }: { preferences: UiPreferences; busy: boolean; update: (patch: Partial<UiPreferences>) => Promise<void> }) {
  const hours = preferences.notificationQuietHours;
  const previewSound = async () => { const Audio = window.AudioContext; if (!Audio) return; const context = new Audio(); try { const tone = context.createOscillator(), gain = context.createGain(); tone.type = 'sine'; tone.frequency.value = 660; gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(preferences.notificationVolume * .12, context.currentTime + .025); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .25); tone.connect(gain).connect(context.destination); tone.start(); tone.stop(context.currentTime + .28); tone.onended = () => { void context.close(); }; } catch { await context.close(); } };
  return <section className="settings-card" aria-labelledby="notification-options-heading"><h2 id="notification-options-heading">Notification preferences</h2>
    <AppearanceRow label="Sound volume" value={<output htmlFor="notification-volume">{usagePercent(preferences.notificationVolume * 100)}</output>}><label className="settings-range"><input id="notification-volume" type="range" aria-label="Notification volume" min="0" max="1" step=".05" disabled={busy} value={preferences.notificationVolume} onChange={event => void update({ notificationVolume: Number(event.target.value) })}/></label><button type="button" className="quiet" disabled={busy} onClick={() => void previewSound()}>Preview sound</button></AppearanceRow>
    <AppearanceRow label="Preview privacy"><Select aria-label="Notification preview privacy" disabled={busy} value={preferences.notificationPreview} options={[{ value: 'full', label: 'Message preview' }, { value: 'title', label: 'Title only' }, { value: 'private', label: 'Private · no content' }]} onValueChange={value => void update({ notificationPreview: value as UiPreferences['notificationPreview'] })}/></AppearanceRow>
    <AppearanceRow label="Quiet hours" description="Keep items in Inbox without popups or sound."><button type="button" role="switch" className="settings-switch" aria-label="Quiet hours" aria-checked={hours.enabled} disabled={busy} onClick={() => void update({ notificationQuietHours: { ...hours, enabled: !hours.enabled } })}><span/></button></AppearanceRow>
    {hours.enabled && <div className="settings-card-row quiet-hours-times"><label>From<input type="time" aria-label="Quiet hours start" disabled={busy} value={hours.start} onChange={event => { if (event.target.value) void update({ notificationQuietHours: { ...hours, start: event.target.value } }); }}/></label><label>Until<input type="time" aria-label="Quiet hours end" disabled={busy} value={hours.end} onChange={event => { if (event.target.value) void update({ notificationQuietHours: { ...hours, end: event.target.value } }); }}/></label><small>Device time</small></div>}
  </section>;
}
