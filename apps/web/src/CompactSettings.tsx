import {useCallback, useLayoutEffect, useRef, useState, type ComponentProps} from 'react';
import {getPreferences} from '../../../packages/contracts/preferences';
import {SettingsView, type SettingsActions} from './Settings';
import {EnvironmentSettings} from './EnvironmentSettings';
import {loadCompactSettings} from './compact-settings-data';
import {getDraftTransferReferences} from './shell-read-api';
import type {SettingsData} from './settings-data';
import {useAppearance} from './useAppearance';

export type CompactSettingsProps = Pick<SettingsActions, 'close' | 'addResource' | 'initialSection' | 'openBrowser' | 'environmentSettings'> & {
  /** Host identity. Changing it disposes this Settings view and its metadata scope. */
  scopeKey: string;
};
export function CompactSettings({scopeKey, ...actions}: CompactSettingsProps) {
  return <ScopedSettings key={scopeKey} {...actions}/>;
}
function ScopedSettings(actions: Omit<CompactSettingsProps, 'scopeKey'>) {
  const [data, setData] = useState<SettingsData>(), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const generation = useRef(0), read = useRef<AbortController | null>(null), lifetime = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    lifetime.current?.signal.throwIfAborted();
    const request = ++generation.current;
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    setLoading(true); setError('');
    try {
      const next = await loadCompactSettings(controller.signal);
      controller.signal.throwIfAborted();
      if (generation.current === request) setData(next);
    } catch (cause) {
      if (!controller.signal.aborted && generation.current === request) setError(cause instanceof Error ? cause.message : 'Settings could not load.');
      throw cause;
    } finally {
      if (!controller.signal.aborted && generation.current === request) setLoading(false);
    }
  }, []);
  useLayoutEffect(() => {
    lifetime.current = new AbortController();
    void refresh().catch(() => {});
    return () => {generation.current++; read.current?.abort(); lifetime.current?.abort();};
  }, [refresh]);
  const draftReferences = useCallback(async (keys: string[]) => {
    const signal = lifetime.current!.signal;
    signal.throwIfAborted();
    const result = await getDraftTransferReferences(keys, signal);
    signal.throwIfAborted(); return result;
  }, []);
  return <>
    {error && <p className="notice error-text" role="alert">{error} <button className="secondary" disabled={loading} onClick={() => void refresh().catch(() => {})}>Retry settings</button></p>}
    {!data && loading && <p role="status">Opening settings…</p>}
    {data && <AcceptedSettings {...actions} data={data} draftReferences={draftReferences} modelError="" refresh={refresh} loadModels={async () => {}} environmentSettings={actions.environmentSettings ?? <EnvironmentSettings/>}/>}
  </>;
}
function AcceptedSettings(props: ComponentProps<typeof SettingsView>) {
  useAppearance(getPreferences(props.data.settings));
  const theme = props.data.settings.theme;
  useLayoutEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme;};
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return <SettingsView {...props}/>;
}
