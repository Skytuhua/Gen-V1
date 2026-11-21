import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Ban, ChevronRight, Plus, ShieldAlert } from 'lucide-react';
import { Select } from '../../../packages/ui-shell/Select';
import { loadHooks, removeHook, saveHook, setHooksEnabled, testHook, type HookDraft } from './hooks-api.ts';
import { HOOK_EVENTS, type Hook, type HookEvent, type HookRunRecord, type HooksView } from '../../../packages/contracts/hooks.ts';
import { ApiError } from './api.ts';
import './hook-settings.css';

const EVENT_LABELS: Record<HookEvent, string> = { PreToolUse: 'Before tool', PostToolUse: 'After tool', UserPromptSubmit: 'Prompt submitted', Stop: 'Turn ended' };
const MATCHER_EVENTS: readonly HookEvent[] = ['PreToolUse', 'PostToolUse'];
const ON_ERROR_EVENTS: readonly HookEvent[] = ['PreToolUse', 'UserPromptSubmit'];
const draftOf = (hook: Hook): HookDraft => ({ name: hook.name, event: hook.event, matcher: hook.matcher, command: hook.command, timeoutSeconds: hook.timeoutSeconds, onError: hook.onError, enabled: hook.enabled, id: hook.id });
const blankDraft = (): HookDraft => ({ name: '', event: 'PreToolUse', matcher: '', command: '', timeoutSeconds: 30, onError: 'continue', enabled: true });
const sameDraft = (a: HookDraft, b: HookDraft) => a.name === b.name && a.event === b.event && a.matcher === b.matcher && a.command === b.command && a.timeoutSeconds === b.timeoutSeconds && a.onError === b.onError && a.enabled === b.enabled;
const ago = (iso: string): string => { const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000); if (seconds < 60) return 'just now'; const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes} min ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} h ago`; return `${Math.floor(hours / 24)} d ago`; };
const lastRunText = (record: HookRunRecord | null): { text: string; tone: 'ok' | 'warn' | 'danger' } => {
  if (!record) return { text: 'Never run', tone: 'ok' };
  if (record.outcome === 'blocked') return { text: `Blocked ${ago(record.startedAt)}`, tone: 'warn' };
  if (record.outcome === 'timed_out') return { text: 'Timed out', tone: 'danger' };
  if (record.outcome === 'succeeded') return { text: `Ran ${ago(record.startedAt)}`, tone: 'ok' };
  return { text: record.outcome === 'spawn_failed' ? 'Failed to start' : 'Failed', tone: 'danger' };
};
const matcherOk = (matcher: string): boolean => { if (!matcher || matcher === '*') return true; try { new RegExp(matcher); return true; } catch { return false; } };
const testLine = (record: HookRunRecord): string => record.outcome === 'timed_out' ? `Timed out after ${Math.round(record.durationMs / 1000)} s` : `Exit ${record.exitCode ?? '—'} · ${record.outcome === 'succeeded' ? 'Succeeded' : record.outcome === 'blocked' ? 'Blocked' : record.outcome === 'cancelled' ? 'Cancelled' : 'Failed'} · ${(record.durationMs / 1000).toFixed(1)} s`;

type SavedHook = HooksView['hooks'][number];
interface CardState { key: string; draft: HookDraft; saved?: SavedHook; open: boolean; test?: HookRunRecord; testing: boolean; saving: boolean; error: string; removing: boolean }

export function HookSettings() {
  const [view, setView] = useState<HooksView | null>(null);
  const [cards, setCards] = useState<CardState[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cardKeys = useRef(0);
  const editButtons = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => { let alive = true; loadHooks().then(value => { if (!alive) return; setView(value); setCards(value.hooks.map(hook => ({ key: hook.id, draft: draftOf(hook), saved: hook, open: false, testing: false, saving: false, error: '', removing: false }))); }).catch(cause => alive && setError(String(cause))); return () => { alive = false; }; }, []);

  const refresh = () => loadHooks().then(value => { setView(value); setCards(current => value.hooks.map(hook => { const open = current.find(card => card.saved?.id === hook.id && card.open && sameDraft(card.draft, draftOf(hook))); return { key: hook.id, draft: draftOf(hook), saved: hook, open: Boolean(open), testing: false, saving: false, error: '', removing: false }; })); });
  const patch = (key: string, update: Partial<CardState>) => setCards(current => current.map(card => card.key === key ? { ...card, ...update } : card));
  const fail = (cause: unknown) => {
    if (cause instanceof ApiError && cause.code === 'HOOKS_CHANGED') { setError('Hooks changed elsewhere. Reloaded the latest version.'); void refresh().catch(reason => setError(String(reason))); return; }
    setError(cause instanceof ApiError ? cause.message : String(cause));
  };

  const toggleMaster = (enabled: boolean) => {
    if (!view) return;
    setBusy(true);
    void setHooksEnabled(enabled, view.revision).then(() => refresh()).catch(fail).finally(() => setBusy(false));
  };
  const toggleHook = (card: CardState, enabled: boolean) => {
    if (!view || !card.saved) return;
    patch(card.key, { draft: { ...card.draft, enabled } });
    void saveHook({ ...draftOf(card.saved), enabled }, view.revision).then(setView).catch(fail);
  };
  const save = (card: CardState) => {
    if (!view) return;
    patch(card.key, { saving: true, error: '' });
    void saveHook(card.draft, view.revision).then(value => {
      setView(value);
      const saved = value.hooks.find(hook => hook.id === card.draft.id) ?? value.hooks.find(hook => sameDraft(hook, card.draft));
      setCards(current => current.map(item => item.key === card.key ? { key: saved?.id ?? item.key, draft: saved ? draftOf(saved) : item.draft, saved, open: false, testing: false, saving: false, error: '', removing: false } : item));
      if (saved) requestAnimationFrame(() => editButtons.current.get(saved.id)?.focus());
    }).catch(cause => { patch(card.key, { saving: false, error: cause instanceof ApiError ? cause.message : String(cause) }); fail(cause); });
  };
  const remove = (card: CardState) => {
    if (!view || !card.saved || !window.confirm(`Remove hook "${card.saved.name || card.saved.command.slice(0, 60)}"?`)) return;
    const index = cards.findIndex(item => item.key === card.key);
    patch(card.key, { removing: true });
    void removeHook(card.saved.id, view.revision).then(() => refresh()).then(() => {
      const next = cards[index + 1]?.saved ?? cards[index - 1]?.saved;
      if (next) requestAnimationFrame(() => editButtons.current.get(next.id)?.focus());
    }).catch(fail);
  };
  const runTest = (card: CardState) => {
    patch(card.key, { testing: true, error: '' });
    void testHook(card.draft).then(record => patch(card.key, { testing: false, test: record })).catch(cause => patch(card.key, { testing: false, error: String(cause) }));
  };
  const addHook = () => {
    const key = `new-${++cardKeys.current}`;
    setCards(current => [...current, { key, draft: blankDraft(), open: true, testing: false, saving: false, error: '', removing: false }]);
  };

  const saveDisabled = (card: CardState) => card.saving || !card.draft.command.trim() || !matcherOk(card.draft.matcher) || (card.saved ? sameDraft(card.draft, draftOf(card.saved)) : false);

  return <div className="hook-settings" data-enabled={view?.enabled !== false}>
    {error && <p role="status" className="notice error-text">{error}</p>}
    <section className="settings-row" data-setting-id="hooks-enabled"><div className="settings-row-copy"><h2>Run hooks</h2><p>Run your own commands when the agent uses tools, when you send a message, and when a turn ends.</p></div>
      <div className="settings-row-control"><button type="button" role="switch" aria-label="Run hooks" aria-checked={view?.enabled ?? false} disabled={!view || busy} className="settings-switch" onClick={() => toggleMaster(!(view?.enabled ?? false))}><span/></button></div></section>
    <p className="hook-warning"><ShieldAlert size={16} aria-hidden="true"/>Hooks run on your computer with your permissions. Only add commands you trust.</p>
    {view && <details className="hook-coverage"><summary>What hooks can see</summary>
      <div className="hook-coverage-lists"><div><h3>Covered</h3><ul>{view.coverage.covered.map(item => <li key={item}>{item}</li>)}</ul></div>
      <div><h3>Not covered yet</h3><ul>{view.coverage.notCovered.map(item => <li key={item}>{item}</li>)}</ul></div></div></details>}
    {view && !view.enabled && <p className="hook-off-note" role="status">Hooks are off. None will run.</p>}
    <div role="list" className="hook-list" data-setting-id="hooks-list">
      {view && view.hooks.length === 0 && cards.every(card => card.saved) && <p className="hook-empty">No hooks yet. Add one to run a command on agent events.</p>}
      {cards.map(card => {
        const last = lastRunText(card.saved?.lastRun ?? null), invalidMatcher = !matcherOk(card.draft.matcher);
        return <section role="listitem" key={card.key} className={`settings-card hook-card${card.open ? ' open' : ''}${card.removing ? ' removing' : ''}`} data-hook-id={card.saved?.id}>
          <header className="hook-card-head">
            <span className="hook-event-pill">{EVENT_LABELS[card.draft.event]}</span>
            <code className="hook-card-name">{card.draft.name || card.draft.command || 'New hook'}</code>
            {MATCHER_EVENTS.includes(card.draft.event) && <code className="hook-card-matcher">{card.draft.matcher || '*'}</code>}
            <span className={`hook-last-run hook-${last.tone}`} aria-live="polite">{last.tone === 'danger' ? <AlertCircle size={13} aria-hidden="true"/> : last.tone === 'warn' ? <Ban size={13} aria-hidden="true"/> : null}{last.text}</span>
            <button type="button" role="switch" aria-label={`Enable ${card.draft.name || 'hook'}`} aria-checked={card.draft.enabled} disabled={!card.saved || busy} className="settings-switch" onClick={() => toggleHook(card, !card.draft.enabled)}><span/></button>
            <button type="button" className="hook-edit" ref={element => { if (card.saved) editButtons.current.set(card.saved.id, element); }} aria-expanded={card.open} aria-label={card.open ? 'Close hook editor' : `Edit ${card.draft.name || 'hook'}`} onClick={() => patch(card.key, { open: !card.open })}>Edit<ChevronRight size={14} className="hook-chevron" aria-hidden="true"/></button>
          </header>
          <div className="hook-card-body"><div className="hook-card-form">
            <label className="field">Event<Select aria-label="Event" value={card.draft.event} options={HOOK_EVENTS.map(event => ({ value: event, label: EVENT_LABELS[event] }))} onValueChange={event => patch(card.key, { draft: { ...card.draft, event: event as HookEvent } })}/></label>
            <label className="field">Name (optional)<input type="text" maxLength={80} value={card.draft.name} onChange={event => patch(card.key, { draft: { ...card.draft, name: event.target.value } })}/></label>
            {MATCHER_EVENTS.includes(card.draft.event) && <label className="field">Tool matcher<input type="text" placeholder="*" maxLength={200} value={card.draft.matcher} aria-invalid={invalidMatcher} onChange={event => patch(card.key, { draft: { ...card.draft, matcher: event.target.value } })}/><span className="field-help">Tool name or regular expression, e.g. op:file.replace or operation_execute|repository_test_prepare{invalidMatcher && <strong className="error-text"> Not a valid regular expression.</strong>}</span></label>}
            <label className="field hook-command">Command<textarea rows={3} spellCheck={false} maxLength={4000} value={card.draft.command} onChange={event => { event.target.rows = Math.min(8, Math.max(3, event.target.value.split('\n').length)); patch(card.key, { draft: { ...card.draft, command: event.target.value } }); }}/><span className="field-help">Gets the event as JSON on standard input.{card.draft.event === 'PreToolUse' || card.draft.event === 'UserPromptSubmit' ? ' Exit 2 to block.' : ''}</span></label>
            <label className="field">Timeout<span className="hook-timeout"><input type="number" min={1} max={120} value={card.draft.timeoutSeconds} onChange={event => patch(card.key, { draft: { ...card.draft, timeoutSeconds: Math.max(1, Math.min(120, Number(event.target.value) || 30)) } })}/>seconds</span></label>
            {ON_ERROR_EVENTS.includes(card.draft.event) && <label className="field">If the hook fails<Select aria-label="If the hook fails" value={card.draft.onError} options={[{ value: 'continue', label: 'Continue' }, { value: 'block', label: 'Block' }]} onValueChange={onError => patch(card.key, { draft: { ...card.draft, onError: onError as Hook['onError'] } })}/></label>}
            {card.error && <p role="alert" className="error-text">{card.error}</p>}
            <div className="hook-card-actions">
              <button type="button" className="secondary" disabled={card.testing || !card.draft.command.trim() || invalidMatcher || view?.enabled === false} aria-busy={card.testing} onClick={() => runTest(card)}>{card.testing ? 'Testing…' : 'Test'}</button>
              {card.saved && <button type="button" className="secondary hook-remove" disabled={card.saving} onClick={() => remove(card)}>Remove</button>}
              <span className="hook-card-spacer"/>
              <button type="button" className="secondary" disabled={card.saving} onClick={() => patch(card.key, card.saved ? { open: false, draft: draftOf(card.saved) } : { open: false })}>Cancel</button>
              <button type="button" className="primary" disabled={saveDisabled(card)} onClick={() => save(card)}>{card.saving ? 'Saving…' : 'Save'}</button>
            </div>
            {card.test && <div className="hook-test-result" aria-live="polite">
              <p className={`hook-test-line hook-${card.test.outcome === 'blocked' ? 'warn' : card.test.outcome === 'succeeded' ? 'ok' : 'danger'}`}>{card.test.outcome === 'blocked' ? <Ban size={13} aria-hidden="true"/> : card.test.outcome !== 'succeeded' ? <AlertCircle size={13} aria-hidden="true"/> : null}{testLine(card.test)}{card.test.reason ? ` — ${card.test.reason}` : ''}</p>
              {card.test.stdout && <><span className="hook-output-label">Output</span><pre className="hook-output">{card.test.stdout}</pre></>}
              {card.test.stderr && <><span className="hook-output-label">Errors</span><pre className="hook-output">{card.test.stderr}</pre></>}
              {card.test.ignoredFields.length > 0 && <p className="hook-ignored">Not supported yet: {card.test.ignoredFields.join(', ')}</p>}
            </div>}
          </div></div>
        </section>;
      })}
    </div>
    <button type="button" className="secondary hook-add" disabled={!view} onClick={addHook}><Plus size={14} aria-hidden="true"/>Add hook</button>
  </div>;
}
