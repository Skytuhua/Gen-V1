import { useEffect, useRef, useState } from 'react';
import { Select } from '../../../packages/ui-shell/Select';
import type { TerminalShellCatalog, TerminalShellSelection } from '../../../packages/contracts/terminal-shell.ts';
import { getTerminalShells } from './terminal-shell-api.ts';

const message = (error: unknown) => error instanceof Error ? error.message : 'Could not check available shells.';

/** Shell picker for Settings. The host catalog (not the browser UA) decides availability. */
export function TerminalShellSettings({ selection, busy, save }: { selection: TerminalShellSelection; busy: boolean; save: (value: TerminalShellSelection) => Promise<boolean> }) {
  const [catalog, setCatalog] = useState<TerminalShellCatalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [checking, setChecking] = useState(true);
  const [saveError, setSaveError] = useState('');
  const [draft, setDraft] = useState<TerminalShellSelection | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = async (refresh: boolean) => {
    const ticket = ++generation.current;
    setChecking(true); setCatalogError('');
    try {
      const value = await getTerminalShells(refresh);
      // Discard stale discovery responses after unmount or owner change.
      if (!mounted.current || ticket !== generation.current) return;
      setCatalog(value); setCatalogError('');
    } catch (error) {
      if (!mounted.current || ticket !== generation.current) return;
      setCatalog(null); setCatalogError(message(error) || 'Could not check available shells. Retry.');
    } finally {
      if (mounted.current && ticket === generation.current) setChecking(false);
    }
  };
  useEffect(() => { void load(false); }, []);

  // The attempted choice stays visible and retryable after a failed save.
  const shown = draft ?? selection;
  const choose = (next: TerminalShellSelection) => {
    if (busy) return;
    setDraft(next); setSaveError('');
    void save(next).then(ok => {
      if (!mounted.current) return;
      if (ok) setDraft(null);
      else setSaveError('The terminal shell could not be saved. Retry.');
    });
  };

  const option = catalog?.options.find(item => item.kind === shown.kind);
  const savedOptionMissing = option !== undefined && option.availability !== 'available';
  const selectionMissing = catalog !== null && option === undefined;
  const selectOptions = catalog ? catalog.options.map(item => ({ value: item.kind, label: item.label, disabled: item.availability !== 'available' })) : [];
  if (selectionMissing) selectOptions.unshift({ value: shown.kind, label: shown.kind === 'wsl' ? 'WSL' : shown.kind, disabled: false });
  const distroOptions = catalog?.wsl.distributions.map(name => ({ value: name, label: name })) ?? [];
  if (shown.kind === 'wsl' && shown.distro && catalog && !catalog.wsl.distributions.includes(shown.distro)) distroOptions.unshift({ value: shown.distro, label: shown.distro });

  return <div className="terminal-shell-settings">
    {checking && !catalog && <p role="status">Checking available shells…</p>}
    {catalogError && <p role="alert">Could not check available shells. <button type="button" className="secondary" onClick={() => void load(true)}>Retry</button></p>}
    {catalog && <>
      <Select aria-label="Terminal shell" disabled={busy} value={shown.kind} options={selectOptions} onValueChange={kind => choose({ kind: kind as TerminalShellSelection['kind'] })}/>
      {shown.kind === 'wsl' && <>
        {catalog.wsl.distributions.length === 0 && catalog.wsl.reason ? <p>{catalog.wsl.reason}</p> : null}
        {catalog.wsl.distributions.length > 0 && <Select aria-label="WSL distribution" disabled={busy} value={shown.distro ?? ''} options={[{ value: '', label: 'Default distribution' }, ...distroOptions]} onValueChange={distro => choose(distro ? { kind: 'wsl', distro } : { kind: 'wsl' })}/>}
      </>}
      {selectionMissing && <p>This shell is no longer available. Choose another shell.</p>}
      {savedOptionMissing && <p>{option!.reason ?? 'This shell is no longer available. Choose another shell.'}</p>}
      {shown.kind === 'wsl' && <p>Configured environment values pass to the distribution literally; Windows paths inside values are not translated.</p>}
      <button type="button" className="secondary" disabled={checking} onClick={() => void load(true)}>Refresh</button>
    </>}
    {saveError && <p role="alert">{saveError} <button type="button" className="secondary" onClick={() => draft && choose(draft)}>Retry</button></p>}
    <p>Applies to new project terminals. Running terminals are unchanged.</p>
  </div>;
}
