import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { DEFAULT_PREFERENCES, PROJECT_PALETTE, projectColorSchema, type ProjectAccent, type UiPreferences } from '../../../packages/contracts/preferences';
import { Select } from '../../../packages/ui-shell/Select';
import type { Thread } from '../../../packages/contracts';
import { usagePercent } from './usage-presentation';
import { applyAppearance } from './useAppearance';
import { projectColor, projectColorKey } from './project-colors';
import { appearanceKeys, appearancePatch, rebaseAppearanceDraft, editedAppearancePatch } from './appearance-draft';
import './appearance-settings.css';

type Theme = 'system' | 'light' | 'dark';
const applyTheme = (theme: Theme) => { document.documentElement.dataset.theme = theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : theme; };
export function accentContrast(color: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const a = luminance(color), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
function AppearanceRow({ id, label, children, description, value }: { id?: string; label: string; children: ReactNode; description?: string; value?: ReactNode }) {
  return <div className="settings-card-row" data-setting-id={id}><div><strong>{label}</strong>{description && <p>{description}</p>}</div><div className="settings-inline-controls">{value}{children}</div></div>;
}
// Single source for the nested appearance fields: the registry searches these ids/terms,
// and the panel renders the matching controls (T06 — no independent child query filter).
export const APPEARANCE_FIELDS: readonly { id: string; label: string; terms: string; description?: string }[] = [
  { id: 'appearance-theme', label: 'Theme', terms: 'color scheme dark light system' },
  { id: 'appearance-appearanceAccent', label: 'Accent', terms: 'color palette' },
  { id: 'appearance-customAccent', label: 'Custom accent', terms: 'hex color', description: 'Hex color; checked against light and dark surfaces.' },
  { id: 'appearance-density', label: 'Density', terms: 'compact comfortable touch' },
  { id: 'appearance-interfaceFont', label: 'Interface font', terms: 'typeface' },
  { id: 'appearance-promptFont', label: 'Composer font', terms: 'typeface prompt' },
  { id: 'appearance-codeFont', label: 'Code font', terms: 'typeface monospace' },
  { id: 'appearance-uiFontSize', label: 'UI size', terms: 'px pixels' },
  { id: 'appearance-chatFontSize', label: 'Chat size', terms: 'px pixels' },
  { id: 'appearance-codeFontSize', label: 'Code size', terms: 'px pixels' },
  { id: 'appearance-controlRadius', label: 'Control radius', terms: 'square rounded soft corners' },
  { id: 'chat-width', label: 'Chat width', terms: '680 760 full comfortable wide' },
  { id: 'word-wrap', label: 'Code line wrap', terms: 'wrap lines' },
  { id: 'appearance-contrast', label: 'Contrast', terms: 'standard high' },
  { id: 'appearance-motion', label: 'Motion', terms: 'system reduced off animation' },
  { id: 'appearance-motionSpeed', label: 'Motion speed', terms: '0.75 1 1.25 duration' },
];
export function AppearanceSettings({ preferences, theme, threads = [], projects: projectMetadata, busy, save }: { preferences: UiPreferences; theme: Theme; threads?: Pick<Thread, 'projectId' | 'projectName'>[]; projects?: {id: string; name: string}[]; busy: boolean; save: (patch: Partial<UiPreferences>, theme?: Theme) => Promise<boolean> }) {
  const [draft, setDraft] = useState(preferences), [draftTheme, setDraftTheme] = useState(theme), [preview, setPreview] = useState(false), [error, setError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [numberDrafts,setNumberDrafts]=useState<Partial<Record<'uiFontSize'|'chatFontSize'|'codeFontSize',string>>>({});
  const edited = useRef(new Set<string>());
  const current = useRef({ preferences, theme }); current.current = { preferences, theme };
  useEffect(() => () => { applyAppearance(current.current.preferences); applyTheme(current.current.theme); }, []);
  // Rebase untouched fields from the latest acknowledged preferences; keep user-edited fields (AUD-08).
  useEffect(() => { setDraft(value => rebaseAppearanceDraft(value, preferences, edited.current)); if (!edited.current.has('theme')) setDraftTheme(theme); }, [preferences, theme]);
  const dirty = JSON.stringify(appearancePatch(draft)) !== JSON.stringify(appearancePatch(preferences)) || draftTheme !== theme;
  const accentError = draft.customAccent !== null && (!projectColorSchema.safeParse(draft.customAccent).success ? 'Use a six-digit hex color.' : Math.min(accentContrast(draft.customAccent, '#0F0F0F'), accentContrast(draft.customAccent, '#FFFFFF')) < 3 ? 'Choose a color with at least 3:1 contrast on both light and dark surfaces.' : '');
  const change = (patch: Partial<UiPreferences>) => { for (const key of Object.keys(patch)) edited.current.add(key); const next = { ...draft, ...patch }; setDraft(next); setError(''); if (preview && (!next.customAccent || projectColorSchema.safeParse(next.customAccent).success && Math.min(accentContrast(next.customAccent, '#0F0F0F'), accentContrast(next.customAccent, '#FFFFFF')) >= 3)) applyAppearance(next); };
  const restore = () => { edited.current.clear(); setDraft(preferences); setDraftTheme(theme); setPreview(false); setError(''); setProjectError(''); applyAppearance(preferences); applyTheme(theme); };
  const choices = (key: keyof UiPreferences, label: string, options: readonly (readonly [string, string])[]) => <Select aria-label={label} value={String(draft[key])} disabled={busy} options={options.map(([value, text]) => ({ value, label: text }))} onValueChange={value => change({ [key]: typeof draft[key] === 'number' ? Number(value) : value, ...(key === 'uiFontSize' ? { fontSize: Number(value) } : {}), ...(key === 'motion' ? { panelAnimations: value !== 'off' } : {}) })}/>;
  const size = (key: 'uiFontSize' | 'chatFontSize' | 'codeFontSize', label: string, min: number, max: number) => <input type="number" aria-label={label} min={min} max={max} step={1} disabled={busy} value={numberDrafts[key]??draft[key]} onChange={event => { const text=event.target.value,value=event.target.valueAsNumber;setNumberDrafts(current=>({...current,[key]:text})); if (Number.isInteger(value) && value >= min && value <= max) change({ [key]: value, ...(key === 'uiFontSize' ? { fontSize: value } : {}) }); }} onBlur={()=>setNumberDrafts(current=>{const next={...current};delete next[key];return next;})}/>;
  const fonts = [['Inter', 'Inter'], ['system', 'System'], ['Arial', 'Arial'], ['Georgia', 'Georgia']] as const;
  const projects = projectMetadata ?? [...new Map(threads.filter(thread => thread.projectId).map(thread => [thread.projectId!, { id: thread.projectId!, name: thread.projectName ?? 'Project' }])).values()];
  const controls: Record<string, ReactNode> = {
    'appearance-theme': <Select aria-label="Color scheme" disabled={busy} value={draftTheme} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} onValueChange={value => { edited.current.add('theme'); setDraftTheme(value as Theme); if (preview) applyTheme(value as Theme); }}/>,
    'appearance-appearanceAccent': <div className="color-swatches" role="group" aria-label="Interface accent">{Object.entries(PROJECT_PALETTE).map(([name, color]) => <button type="button" key={name} className="color-swatch" style={{ '--swatch': color } as CSSProperties} aria-label={`${name} accent`} aria-pressed={draft.customAccent === null && draft.appearanceAccent === name} onClick={() => change({ appearanceAccent: name as ProjectAccent, customAccent: null })}>{draft.customAccent === null && draft.appearanceAccent === name && <Check size={12}/>}</button>)}</div>,
    'appearance-customAccent': <input aria-label="Custom accent" placeholder="#4F6EFF" maxLength={7} value={draft.customAccent ?? ''} aria-invalid={Boolean(accentError)} aria-describedby={accentError ? 'appearance-accent-error' : undefined} onChange={event => change({ customAccent: event.target.value || null })}/>,
    'appearance-density': choices('density', 'Density', [['compact', 'Compact · 32 px'], ['comfortable', 'Comfortable · 36 px'], ['touch', 'Touch · 44 px']]),
    'appearance-interfaceFont': choices('interfaceFont', 'Interface font', fonts),
    'appearance-promptFont': choices('promptFont', 'Composer font', fonts),
    'appearance-codeFont': choices('codeFont', 'Code font', [['monospace', 'System monospace'], ['Consolas', 'Consolas'], ['Cascadia Code', 'Cascadia Code']]),
    'appearance-uiFontSize': <>{size('uiFontSize', 'UI size', 13, 16)}<span>px</span></>,
    'appearance-chatFontSize': <>{size('chatFontSize', 'Chat size', 14, 20)}<span>px</span></>,
    'appearance-codeFontSize': <>{size('codeFontSize', 'Code size', 12, 18)}<span>px</span></>,
    'appearance-controlRadius': choices('controlRadius', 'Control radius', [['0', 'Square · 0 px'], ['6', 'Rounded · 6 px'], ['10', 'Soft · 10 px']]),
    'chat-width': choices('chatWidth', 'Chat width', [['comfortable', '680 px'], ['wide', '760 px'], ['full', 'Full available width']]),
    'word-wrap': <button type="button" role="switch" className="settings-switch" aria-label="Code line wrap" aria-checked={draft.wordWrap} onClick={() => change({ wordWrap: !draft.wordWrap })}><span/></button>,
    'appearance-contrast': choices('contrast', 'Contrast', [['normal', 'Standard'], ['high', 'High']]),
    'appearance-motion': choices('motion', 'Motion', [['system', 'System'], ['reduced', 'Reduced'], ['off', 'Off']]),
    'appearance-motionSpeed': choices('motionSpeed', 'Motion speed', [['0.75', '0.75×'], ['1', '1×'], ['1.25', '1.25×']]),
  };
  return <div className="appearance-settings">
    <fieldset className="settings-card" disabled={busy}><legend>Appearance</legend>
      {APPEARANCE_FIELDS.map(field => <AppearanceRow key={field.id} id={field.id} label={field.label} description={field.description}>{controls[field.id]}</AppearanceRow>)}
      {accentError && <p id="appearance-accent-error" role="status" className="error-text appearance-error">{accentError}</p>}
      {error && <p role="status" className="error-text appearance-error">{error}</p>}
      <div className="appearance-actions"><button type="button" className="quiet" onClick={() => { appearanceKeys.forEach(key => edited.current.add(key)); edited.current.add('theme'); setDraft({ ...preferences, ...appearancePatch(DEFAULT_PREFERENCES) }); setDraftTheme('dark'); setPreview(false); applyAppearance(preferences); applyTheme(theme); }}><RotateCcw size={13}/>Reset appearance</button><span/>{dirty && <span className="appearance-dirty" role="status">Unsaved changes — Apply to keep them</span>}{preview && <span role="status">Preview</span>}<button type="button" className="secondary" disabled={!dirty || Boolean(accentError)} onClick={() => { applyAppearance(draft); applyTheme(draftTheme); setPreview(true); }}>Preview</button><button type="button" className="quiet" disabled={!dirty && !preview} onClick={restore}>Cancel</button><button type="button" className="primary" disabled={!dirty || Boolean(accentError)} onClick={() => { const patch = editedAppearancePatch(draft, edited.current); const themeArg = edited.current.has('theme') ? draftTheme : undefined; void save(patch, themeArg).then(ok => { if (ok) { edited.current.clear(); setPreview(false); } else setError('Appearance could not be saved. Your changes are ready to retry.'); }); }}>Apply</button></div>
    </fieldset>
    <section className="settings-card" data-setting-id="harness-project-colors" aria-labelledby="project-colors-heading"><h2 id="project-colors-heading">Project colors</h2>{projectError && <p role="status" className="error-text appearance-error">{projectError}</p>}{projects.length > 0 ? projects.map(project => {
      const key = projectColorKey({ kind: 'local' }, project.id), selected = projectColor({ kind: 'local' }, project.id, preferences.projectColors);
      return <div className="settings-card-row" key={project.id}><strong>{project.name}</strong><div className="settings-inline-controls"><div className="color-swatches" role="group" aria-label={`Color for ${project.name}`}>{Object.entries(PROJECT_PALETTE).map(([name, color]) => <button type="button" key={name} className="color-swatch" style={{ '--swatch': color } as CSSProperties} disabled={busy} aria-label={`${name} for ${project.name}`} aria-pressed={selected === color} onClick={() => void save({ projectColors: { ...preferences.projectColors, [key]: color } })}>{selected === color && <Check size={12}/>}</button>)}</div><form className="project-custom-color" noValidate onSubmit={event => { event.preventDefault(); const color = String(new FormData(event.currentTarget).get('color')); if (!projectColorSchema.safeParse(color).success) { setProjectError('Use a six-digit project hex color.'); return; } setProjectError(''); void save({ projectColors: { ...preferences.projectColors, [key]: color } }); }}><input name="color" key={selected} aria-label={`Custom color for ${project.name}`} defaultValue={selected} pattern="#[0-9a-fA-F]{6}" maxLength={7} disabled={busy}/><button className="secondary" disabled={busy}>Save color</button></form>{preferences.projectColors[key] && <button type="button" className="quiet" disabled={busy} aria-label={`Reset color for ${project.name}`} onClick={() => { const next = { ...preferences.projectColors }; delete next[key]; void save({ projectColors: next }); }}><RotateCcw size={13}/></button>}</div></div>;
    }) : <p className="settings-card-intro">Project colors appear when a conversation is connected to a project.</p>}</section>
  </div>;
}

export function NotificationSettings({ preferences, busy, update, desktop = true }: { preferences: UiPreferences; busy: boolean; update: (patch: Partial<UiPreferences>) => Promise<void>; desktop?: boolean }) {
  const hours = preferences.notificationQuietHours;
  const previewSound = async () => { const Audio = window.AudioContext; if (!Audio) return; const context = new Audio(); try { const tone = context.createOscillator(), gain = context.createGain(); tone.type = 'sine'; tone.frequency.value = 660; gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(preferences.notificationVolume * .12, context.currentTime + .025); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .25); tone.connect(gain).connect(context.destination); tone.start(); tone.stop(context.currentTime + .28); tone.onended = () => { void context.close(); }; } catch { await context.close(); } };
  return <section className="settings-card" aria-labelledby="notification-options-heading"><h2 id="notification-options-heading">Notification preferences</h2>
    {!desktop && <p className="panel-note">System notifications and sound require the Windows app.</p>}
    <AppearanceRow label="Sound volume" value={<output htmlFor="notification-volume">{usagePercent(preferences.notificationVolume * 100)}</output>}><label className="settings-range"><input id="notification-volume" type="range" aria-label="Notification volume" min="0" max="1" step=".05" disabled={busy} value={preferences.notificationVolume} onChange={event => void update({ notificationVolume: Number(event.target.value) })}/></label><button type="button" className="quiet" disabled={busy} onClick={() => void previewSound()}>Preview sound</button></AppearanceRow>
    <AppearanceRow label="Preview privacy"><Select aria-label="Notification preview privacy" disabled={busy} value={preferences.notificationPreview} options={[{ value: 'full', label: 'Message preview' }, { value: 'title', label: 'Title only' }, { value: 'private', label: 'Private · no content' }]} onValueChange={value => void update({ notificationPreview: value as UiPreferences['notificationPreview'] })}/></AppearanceRow>
    <AppearanceRow label="Quiet hours" description="Keep items in Inbox without popups or sound."><button type="button" role="switch" className="settings-switch" aria-label="Quiet hours" aria-checked={hours.enabled} disabled={busy} onClick={() => void update({ notificationQuietHours: { ...hours, enabled: !hours.enabled } })}><span/></button></AppearanceRow>
    {hours.enabled && <div className="settings-card-row quiet-hours-times"><label>From<input type="time" aria-label="Quiet hours start" disabled={busy} value={hours.start} onChange={event => { if (event.target.value) void update({ notificationQuietHours: { ...hours, start: event.target.value } }); }}/></label><label>Until<input type="time" aria-label="Quiet hours end" disabled={busy} value={hours.end} onChange={event => { if (event.target.value) void update({ notificationQuietHours: { ...hours, end: event.target.value } }); }}/></label><small>Device time</small></div>}
  </section>;
}
