import {useCallback, useEffect, useRef, useState} from 'react';
import {Check} from 'lucide-react';
import {authenticated, command, read} from './api';
import {PERSONAL_INSTRUCTIONS_MAX_BYTES, type PersonalInstructionsView} from '../../../packages/contracts/personal-instructions.ts';

const LIMIT = PERSONAL_INSTRUCTIONS_MAX_BYTES;
const getView = (desktop: boolean) => authenticated(() => fetch(`/api/personal-instructions${desktop ? '?desktop=true' : ''}`, {credentials: 'same-origin', cache: 'no-store'})).then(read<PersonalInstructionsView>);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** Personal instructions card (Settings > Chat & Composer): edits the
 * personal AGENTS.md kept in the host data folder. The same validation runs
 * on the host; the card only mirrors limits for faster feedback. */
export function PersonalInstructionsCard({enabled, update, desktop}: {enabled: boolean; update: (patch: {personalInstructionsEnabled: boolean}) => void; desktop?: {personalInstructions?: (action: 'open' | 'reveal') => Promise<void>}}) {
  const [view, setView] = useState<PersonalInstructionsView | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const loaded = useRef<{digest: string | null}>({digest: null});

  const reload = useCallback(async (keepDraft = false) => {
    const next = await getView(Boolean(desktop));
    setView(next);
    loaded.current = {digest: next.digest};
    if (!keepDraft) { setDraft(next.text); setConflict(false); }
    else if (next.digest !== loaded.current.digest) setConflict(true);
  }, [desktop]);
  useEffect(() => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : 'Personal instructions unavailable')); }, [reload]);
  useEffect(() => {
    const onFocus = () => void reload(true).catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(false), 2200); return () => clearTimeout(timer); }, [saved]);

  const bytes = new TextEncoder().encode(draft).length;
  const over = bytes > LIMIT;
  const dirty = view !== null && draft !== view.text;
  const save = async () => {
    if (!dirty || over || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const next = await command('instructions.personal.update', {text: draft, baseDigest: loaded.current.digest}).then(() => getView(Boolean(desktop)));
      setView(next); loaded.current = {digest: next.digest}; setDraft(next.text); setSaved(true); setConflict(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Save failed';
      setError(message);
      if (/changed on disk/i.test(message)) setConflict(true);
    } finally { setSaving(false); }
  };

  return <section className="settings-card personal-instructions" data-setting-id="harness-personal-instructions">
    <div className="settings-row personal-instructions-head">
      <div className="settings-row-copy">
        <h2>Personal instructions</h2>
        <p>Applied to every project, before project AGENTS.md. Project instructions win when they conflict.</p>
      </div>
      <div className="settings-row-control"><button type="button" role="switch" aria-label="Use personal instructions" aria-checked={enabled} className="settings-switch" onClick={() => update({personalInstructionsEnabled: !enabled})}><span/></button></div>
    </div>
    {view?.status === 'EXCLUDED' && <p className="personal-instructions-excluded" role="alert">Not applied: {view.reason === 'SOURCE_TOO_LARGE' ? 'the file is over the size limit' : view.reason === 'UNSUPPORTED_DIRECTIVE' ? 'the file contains an include or hook directive' : view.reason === 'SOURCE_NOT_TEXT' ? 'the file is not plain UTF-8 text' : 'the file is unavailable'}. Fix the text and save.</p>}
    {conflict && <p className="personal-instructions-conflict" role="status">Changed on disk. <button type="button" className="link" onClick={() => void reload()}>Reload</button></p>}
    <textarea id="personal-instructions-editor" aria-label="Personal instructions" aria-describedby="personal-instructions-counter personal-instructions-error" placeholder="e.g. Answer in British English. Prefer pnpm. Ask before committing." value={draft} data-off={!enabled} spellCheck={false}
      onChange={event => { setDraft(event.target.value); setSaved(false); }}
      onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 's') { event.preventDefault(); void save(); } }}/>
    {!enabled && <p className="personal-instructions-off">Off. Saved text is kept but not sent.</p>}
    <div className="personal-instructions-footer">
      <span id="personal-instructions-counter" className={`personal-instructions-counter${over ? ' over' : bytes >= LIMIT * .9 ? ' warn' : ''}`} role="status" aria-live="polite">{kb(bytes)} of {kb(LIMIT)}{over ? ' · too long' : ''}</span>
      <span className="personal-instructions-actions">
        {desktop?.personalInstructions && <><button type="button" className="secondary" onClick={() => void desktop.personalInstructions!('open').catch(cause => setError(String(cause)))}>Open file</button>
        <button type="button" className="secondary" onClick={() => void desktop.personalInstructions!('reveal').catch(cause => setError(String(cause)))}>Show in folder</button></>}
        <button type="button" className="secondary" disabled={!dirty || saving} onClick={() => { if (view) { setDraft(view.text); setConflict(false); } }}>Revert</button>
        <button type="button" className="primary" disabled={!dirty || over || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
      </span>
    </div>
    <p className="personal-instructions-status">
      {error && <span id="personal-instructions-error" role="alert" className="error-text">{error}</span>}
      {saved && !error && <span className="personal-instructions-saved"><Check size={14}/> Saved</span>}
    </p>
  </section>;
}
