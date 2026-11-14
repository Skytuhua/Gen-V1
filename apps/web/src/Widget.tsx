import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import Ajv from 'ajv';
import type { ArtifactRecord } from '../../../packages/contracts';
import { command, getWidgetMount, widgetOrigin } from './api';
import type { UserStateRecord } from '../../../packages/contracts';
import { createWidgetRuntime } from '../../../packages/widgets/controller';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

const ajv = new Ajv({ strict: false, allErrors: true });
function themeTokens(mode: 'light' | 'dark') {
  const style = getComputedStyle(document.documentElement);
  return { colorScheme: mode, '--background': style.getPropertyValue('--canvas').trim(), '--foreground': style.getPropertyValue('--text').trim(), '--card': style.getPropertyValue('--surface').trim(), '--border': style.getPropertyValue('--border').trim(), '--muted': style.getPropertyValue('--subtle').trim(), '--secondary': style.getPropertyValue('--subtle').trim(), '--muted-foreground': style.getPropertyValue('--muted').trim(), '--primary': style.getPropertyValue('--accent').trim(), '--primary-foreground':mode==='dark'?'#101011':'#fff', '--accent-surface':style.getPropertyValue('--accent-soft').trim() };
}
interface Mount { url: string; token: string; mountId: string; revision: number }
export type WidgetHandle = { releaseLease: () => Promise<void> };
export function Widget({ ref: widgetRef, artifact, inputs, values, stateRevision, theme, onAction, onAccepted, onDirty, onEscape }: { ref?: Ref<WidgetHandle>; artifact: ArtifactRecord; inputs: Record<string, unknown>; values: Record<string, unknown>; stateRevision: number; theme: 'light' | 'dark'; onAction: (id: string, payload: unknown, clientId: string) => Promise<void>; onAccepted: (values: Record<string, unknown>, revision: number) => void; onDirty: (dirty: boolean) => void; onEscape?: () => void }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<Mount | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const clientId = useRef<string>(crypto.randomUUID());
  const leaseDirty = useRef(false);
  const editGeneration = useRef(0);
  const runtime = useRef<ReturnType<typeof createWidgetRuntime> | null>(null);
  const leasePending = useRef<Promise<unknown> | null>(null);
  const checkpointPending = useRef<Promise<unknown> | null>(null);
  const releasePending = useRef<Promise<void> | null>(null);
  const leaseSuspended = useRef(false);
  const lease = () => leasePending.current ??= command('edit.begin', { stateId: artifact.stateId, fields: Object.keys(latest.current.values), clientId: clientId.current }, artifact.threadId).finally(() => { leasePending.current = null; });
  const latest = useRef({ artifact, inputs, values, stateRevision, theme, onAction, onAccepted, onDirty, onEscape });
  latest.current = { artifact, inputs, values, stateRevision, theme, onAction, onAccepted, onDirty, onEscape };
  useImperativeHandle(widgetRef, () => ({ releaseLease() {
    if (releasePending.current) return releasePending.current;
    const wasSuspended = leaseSuspended.current, owner = clientId.current;
    leaseSuspended.current = true;
    const pending = (async () => {
      // Explicit discard waits for already-started saves/acquisition. Neither a
      // failed release nor a successful release clears the draft or remounts it.
      await checkpointPending.current?.catch(() => {});
      await leasePending.current?.catch(() => {});
      await command('edit.end', { stateId: artifact.stateId, clientId: owner }, artifact.threadId);
    })().catch(error => { leaseSuspended.current = wasSuspended; throw error; }).finally(() => { releasePending.current = null; });
    releasePending.current = pending;
    return pending;
  } }));
  const resumeLease = () => {
    if (releasePending.current) return Promise.reject(new Error('An edit lease release is in progress.'));
    const wasSuspended = leaseSuspended.current;
    leaseSuspended.current = false;
    // Native focus may already have resumed ownership before the worker emits
    // its action. Reuse that acquisition instead of sending a second begin.
    return wasSuspended && leaseDirty.current ? lease() : leasePending.current ?? Promise.resolve();
  };
  const schemaKey = JSON.stringify([artifact.widget?.inputSchema, artifact.widget?.stateSchema, artifact.widget?.eventSchema]);
  const validators = useMemo(() => {
    if (!artifact.widget) throw new Error('Widget definition is missing.');
    return { state: ajv.compile(artifact.widget.stateSchema), input: ajv.compile(artifact.widget.inputSchema), event: ajv.compile(artifact.widget.eventSchema) };
  }, [schemaKey]);
  const updateKey = JSON.stringify({ inputs, values, stateRevision, theme });

  useEffect(() => {
    let current = true;
    setMount(null); setReady(false); setError(''); setActionError('');
    void getWidgetMount(artifact.id).then(ticket => {
      if (!current) return;
      const url = new URL(ticket.url);
      if (url.origin !== widgetOrigin || url.origin === location.origin || ticket.revision !== artifact.revision) throw new Error('The widget mount origin or revision does not match.');
      clientId.current = `widget:${artifact.id}:${ticket.mountId}`;
      leaseSuspended.current = false;
      setMount(ticket);
    }).catch(error => { if (current) setError(error instanceof Error ? error.message : 'Widget mount failed.'); });
    return () => { current = false; };
  }, [artifact.id, artifact.revision, attempt]);

  useEffect(() => {
    if (!mount) return;
    let active = true;
    let checkpointing = false;
    const send = (type: string, payload: Record<string, unknown> = {}) => {
      if (active) runtime.current?.post({ channel: 'harness-widget', token: mount.token, mountId: mount.mountId, artifactId: artifact.id, type, payload });
    };
    const init = () => {
      const data = latest.current;
      if (!validators.input(data.inputs) || !validators.state(data.values)) { setError('Widget inputs or saved state do not match its schema.'); return; }
      runtime.current?.post({ channel: 'harness-widget', token: mount.token, mountId: mount.mountId, artifactId: artifact.id, type: 'init', inputs: data.inputs, state: data.values, stateRevision: data.stateRevision, theme: themeTokens(data.theme) });
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      const message = event.data;
      if (!active || !message || message.channel !== 'harness-widget' || message.token !== mount.token || message.mountId !== mount.mountId || message.artifactId !== artifact.id) return;
      // Shell controls come directly from native events in the trusted receiver,
      // never from the worker bridge (which is dispatched through handle).
      if (message.type === 'shell.escape' && message.payload?.key === 'Escape') { latest.current.onEscape?.(); return; }
      if (message.type === 'ui.event' && leaseSuspended.current && !releasePending.current) void resumeLease().catch(error => setError(error instanceof Error ? error.message : 'The edit lease could not be resumed.'));
      handle(event.data);
    };
    const handle = (message: Record<string, any>) => {
      if (!active || !message || typeof message !== 'object' || message.channel !== 'harness-widget' || message.token !== mount.token || message.mountId !== mount.mountId || message.artifactId !== artifact.id) return;
      const payload = message.payload;
      if (message.type === 'ready') { setReady(true); init(); return; }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      if (message.type === 'dirty' && typeof payload.dirty === 'boolean') { leaseDirty.current = payload.dirty; if (payload.dirty) editGeneration.current++; latest.current.onDirty(payload.dirty); if (payload.dirty && !leaseSuspended.current) void lease().catch(error => setError(error instanceof Error ? error.message : 'The edit lease could not be acquired.')); return; }
      if (message.type === 'action') {
        const rejectAction = (message: string, actionId?: string) => {
          if (!active) return;
          setActionError(message); send('action.error', { actionId, message });
        };
        const actionId: unknown = payload.actionId;
        const actionPayload: unknown = payload.payload;
        if (typeof actionId !== 'string' || !Object.hasOwn(latest.current.artifact.actions, actionId) || !validators.event(payload)) { rejectAction('This widget action is not registered or does not match its event schema.'); return; }
        const definition = latest.current.artifact.actions[actionId]!;
        if (definition.schema && !ajv.validate(definition.schema, actionPayload)) { rejectAction('Action payload does not match its schema.', actionId); return; }
        void resumeLease().then(() => latest.current.onAction(actionId, actionPayload, clientId.current)).then(() => { if (active) { setActionError(''); send('action.ack', { actionId }); } }).catch(error => rejectAction(error instanceof Error ? error.message : 'Action failed.', actionId));
        return;
      }
      if (message.type !== 'checkpoint' || typeof payload.requestId !== 'string' || payload.requestId.length > 200) return;
      if (checkpointing || releasePending.current || !validators.state(payload.values) || payload.stateSchemaVersion !== artifact.widget?.stateSchemaVersion) { send('checkpoint.error', { requestId: payload.requestId, message: 'Checkpoint is busy or does not match the state schema.' }); return; }
      checkpointing = true;
      leaseSuspended.current = false;
      const checkpointGeneration = editGeneration.current;
      checkpointPending.current = lease().then(() => command('widget.checkpoint', { artifactId: artifact.id, revision: artifact.revision, clientId: clientId.current, baseStateRevision: latest.current.stateRevision, stateSchemaVersion: payload.stateSchemaVersion, values: payload.values }, artifact.threadId)).then(async receipt => {
        const state = receipt.result as UserStateRecord;
        if (state?.id !== artifact.stateId || !Number.isSafeInteger(state.revision)) throw new Error('The accepted checkpoint was not returned by the host.');
        if (!active) return;
        latest.current.onAccepted(state.values, state.revision);
        latest.current.stateRevision = state.revision;
        const stillDirty = editGeneration.current !== checkpointGeneration;
        leaseDirty.current = stillDirty;
        latest.current.onDirty(stillDirty);
        send('checkpoint.ack', { requestId: payload.requestId, stateRevision: state.revision });
        if (!stillDirty) await command('edit.end', { stateId: artifact.stateId, clientId: clientId.current }, artifact.threadId);
      }).catch(error => send('checkpoint.error', { requestId: payload.requestId, message: error instanceof Error ? error.message : 'Checkpoint was not saved.' })).finally(() => { checkpointing = false; checkpointPending.current = null; });
    };
    if (!iframe.current || !artifact.widget) return;
    try {
      runtime.current = createWidgetRuntime({ iframe: iframe.current, identity: { token: mount.token, mountId: mount.mountId, artifactId: artifact.id }, html: artifact.widget.html, stateSchemaVersion: artifact.widget.stateSchemaVersion, onBridge: handle, onFailure: message => { if (active) setError(message); } });
    } catch { setError('The isolated generated-app worker is unavailable.'); return; }
    window.addEventListener('message', receive);
    const heartbeatMs = () => (globalThis as { __genWidgetLeaseHeartbeatMs?: number }).__genWidgetLeaseHeartbeatMs ?? 20000;
    let timer: ReturnType<typeof setTimeout>;
    const beat = () => { if (leaseDirty.current && !leaseSuspended.current) void lease().catch(error => setError(error instanceof Error ? error.message : 'The edit lease expired.')); if (active) timer = setTimeout(beat, heartbeatMs()); };
    timer = setTimeout(beat, heartbeatMs());
    const leaseClientId = clientId.current;
    return () => { active = false; runtime.current?.dispose(); runtime.current = null; clearTimeout(timer); window.removeEventListener('message', receive); if (leaseDirty.current && !leaseSuspended.current) void Promise.resolve(leasePending.current).catch(() => {}).then(() => command('edit.end', { stateId: artifact.stateId, clientId: leaseClientId }, artifact.threadId)).catch(() => {}); };
  }, [mount, artifact.id, artifact.revision, artifact.stateId, artifact.threadId, validators]);

  useEffect(() => {
    if (!mount || !ready) return;
    if (!validators.input(inputs)) { setError('Updated inputs do not match this widget’s schema.'); return; }
    runtime.current?.post({ channel: 'harness-widget', token: mount.token, mountId: mount.mountId, artifactId: artifact.id, type: 'init', inputs, state: values, stateRevision, theme: themeTokens(theme) });
  }, [mount, ready, artifact.id, updateKey, validators]);
  return <div className="widget-container">{error && <ErrorState className="notice widget-mount-error" message={error} retryLabel="Retry widget" onRetry={() => setAttempt(value => value + 1)}/>}{actionError && <div className="notice widget-action-error" role="status">{actionError}<button type="button" className="quiet" aria-label="Dismiss widget action error" onClick={() => setActionError('')}>Dismiss</button></div>}{!ready && !error && <p className="muted widget-loading" role="status">Opening secure widget…</p>}{mount && <iframe ref={iframe} title={artifact.title} src={mount.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="widget-frame" />}</div>;
}
