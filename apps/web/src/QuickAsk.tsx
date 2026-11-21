import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {QuickAskOpen} from '../../../packages/desktop-contract/index';
import type {Snapshot,Thread} from '../../../packages/contracts';
import {getPreferences} from '../../../packages/contracts/preferences';
import {bootstrap,command,getSnapshot,subscribe} from './api';
import {useDesktop,useDesktopReady} from './desktop-context';
import {ComposerView} from './ComposerView';

const emptySnapshot: Snapshot = { seq: 0, threads: [], messages: [], artifacts: [], userStates: [], data: [], requests: [], operations: [], resources: [], usage: {}, settings: { theme: 'dark', modelId: null }, activeThreadId: null };
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';

export type QuickAskTarget = 'new' | 'current';
export interface QuickAskPending { commandId: string; content: string; target: QuickAskTarget; threadId?: string }

export const quickAskDefaultTarget = (open: QuickAskOpen): QuickAskTarget => open.target === 'current' && open.currentThreadSendable ? 'current' : 'new';
export const quickAskSendable = (open: QuickAskOpen | null | undefined, thread: Thread | undefined): boolean => Boolean(open?.currentThreadId && open.currentThreadSendable && thread);
export const quickAskSubmitKey = (sendShortcut: string, event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean =>
  event.key === 'Enter' && !event.shiftKey && (sendShortcut === 'enter' || event.ctrlKey || event.metaKey);
export const quickAskKeyAction = (sendShortcut: string, event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): 'hide' | 'send' | null =>
  event.key === 'Escape' ? 'hide' : quickAskSubmitKey(sendShortcut, event) ? 'send' : null;

/** One send attempt; the caller keeps `pending` alive across retries so the commandId and created threadId are reused. */
export async function runQuickAskSend(pending: QuickAskPending, deps: {
  command: (type: string, payload: Record<string, unknown>, threadId?: string, commandId?: string) => Promise<{ result?: unknown }>;
  currentThreadId: string | null;
  projectId: string | null;
  modelId: string;
  sent?: (notice: { threadId: string; target: QuickAskTarget }) => Promise<unknown>;
}): Promise<string> {
  let threadId = pending.threadId;
  if (!threadId) {
    if (pending.target === 'current') {
      if (!deps.currentThreadId) throw Error('No thread is open in Gen V1.');
      threadId = deps.currentThreadId;
    } else {
      const receipt = await deps.command('thread.create', deps.projectId ? { projectId: deps.projectId } : {});
      const result = receipt.result as { id?: string; threadId?: string; thread?: { id?: string } } | null;
      threadId = result?.id ?? result?.threadId ?? result?.thread?.id;
      if (!threadId) throw Error('The new thread was not returned by the host.');
    }
    pending.threadId = threadId;
  }
  await deps.command('message.send', { content: pending.content, modelId: deps.modelId, thinkingLevel: null }, threadId, pending.commandId);
  await deps.sent?.({ threadId, target: pending.target }).catch(() => {});
  return threadId;
}

/** Quick-ask surface: a one-shot composer pushed context by the main window via the desktop bridge. */
export function QuickAsk() {
  const desktop = useDesktop()!, bridge = desktop.bridge;
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot), [ready, setReady] = useState(false), [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState<QuickAskOpen | null>(null), [target, setTarget] = useState<QuickAskTarget>('new');
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<QuickAskPending | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLDivElement>(null);
  const current = useRef(snapshot); current.current = snapshot;
  const refresh = useCallback(async (value?: Snapshot) => { const next = value ?? await getSnapshot(); if (!current.current || next.seq >= current.current.seq) { current.current = next; setSnapshot(next); } }, []);

  useEffect(() => { let active = true; void bootstrap().then(() => refresh()).then(() => { if (active) setReady(true); }).catch(cause => { if (active) setLoadError(messageOf(cause)); }); return () => { active = false; }; }, [refresh]);
  useEffect(() => { if (!ready) return; return subscribe(current.current.seq, () => { void refresh().catch(() => {}); }, () => {}, () => refresh()); }, [ready, refresh]);
  useDesktopReady(ready);

  useEffect(() => bridge.onQuickAskOpen?.(value => {
    setOpen(value); setError(''); pending.current = null;
    setTarget(quickAskDefaultTarget(value));
    requestAnimationFrame(() => { const box = input.current; if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } });
  }), [bridge]);

  const preferences = getPreferences(snapshot.settings);
  const theme = snapshot.settings.theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : snapshot.settings.theme;
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const thread: Thread | undefined = open?.currentThreadId ? snapshot.threads.find(item => item.id === open.currentThreadId) : undefined;
  const sendable = quickAskSendable(open, thread);
  const modelId = target === 'current' ? thread?.modelId ?? snapshot.settings.modelId ?? '' : snapshot.settings.modelId ?? '';
  const projectMissing = !open?.currentProjectId && target === 'new';

  useEffect(() => {
    const node = panel.current; if (!node || !ready) return;
    let frame = 0;
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { void bridge.quickAskResize?.(Math.ceil(node.scrollHeight) + 24).catch(() => {}); }); };
    const observer = new ResizeObserver(measure); observer.observe(node); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [bridge, ready]);

  const hide = useCallback(() => { void bridge.quickAskHide?.().catch(() => {}); }, [bridge]);
  const send = useCallback(async () => {
    const attempt = pending.current ?? { commandId: crypto.randomUUID(), content: draft.trim(), target };
    if (!attempt.content || busy || projectMissing) return;
    pending.current = attempt; setBusy(true); setError('');
    try {
      await runQuickAskSend(attempt, { command, currentThreadId: open?.currentThreadId ?? null, projectId: open?.currentProjectId ?? null, modelId: attempt.target === 'current' ? thread?.modelId ?? modelId : modelId, sent: bridge.quickAskSent });
      pending.current = null; setDraft(''); setError('');
    } catch (cause) { setError(messageOf(cause)); } finally { setBusy(false); }
  }, [bridge, busy, draft, target, open?.currentThreadId, open?.currentProjectId, thread?.modelId, modelId, projectMissing]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const action = quickAskKeyAction(preferences.sendShortcut, event);
    if (action === 'hide') { event.preventDefault(); hide(); return; }
    if (action === 'send') { event.preventDefault(); void send(); }
  };

  const hint = preferences.sendShortcut === 'enter' ? 'Enter to send · Shift+Enter for a new line · Esc to close' : 'Ctrl+Enter to send · Enter for a new line · Esc to close';
  const mainWindow = desktop.windows.find(info => info.surface.kind === 'main');
  const openMain = () => { if (mainWindow) void bridge.focus(mainWindow.id).catch(() => {}); };

  if (loadError) return <main className="quick-ask"><p role="alert">{loadError}</p></main>;
  return <main className="quick-ask"><div ref={panel} className="quick-ask-panel">
    {projectMissing ? <div className="quick-ask-empty"><p>Add a project in Gen V1 first.</p><button type="button" className="secondary" onClick={openMain}>Open Gen V1</button></div> : <>
      <div className="quick-ask-head" role="radiogroup" aria-label="Send target">
        <button type="button" role="radio" aria-checked={target === 'new'} className={target === 'new' ? 'selected' : ''} onClick={() => setTarget('new')}>New thread</button>
        <button type="button" role="radio" aria-checked={target === 'current'} disabled={!sendable} title={sendable ? undefined : open?.currentThreadId ? 'This thread is busy' : 'No thread is open in Gen V1'} className={target === 'current' ? 'selected' : ''} onClick={() => sendable && setTarget('current')}>Current thread</button>
        <span className="quick-ask-where">{target === 'current' ? `Thread: ${open?.currentThreadTitle ?? ''}` : `Project: ${open?.currentProjectName ?? ''}`}</span>
      </div>
      <ComposerView className="quick-ask-form" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea ref={input} aria-label="Ask Gen V1" placeholder="Ask Gen V1…" rows={1} value={draft} readOnly={busy} onChange={event => setDraft(event.target.value)} onKeyDown={onKeyDown} />
        <button type="submit" aria-label="Send" disabled={busy || !draft.trim() || !modelId} title={modelId ? undefined : 'Choose an available model in Gen V1 first.'}>{busy ? '…' : '↑'}</button>
      </ComposerView>
      {error ? <p role="alert" className="quick-ask-error"><span>{error}</span><button type="button" className="quiet" disabled={busy} onClick={() => void send()}>Retry</button></p> : <p className="quick-ask-hint">{hint}</p>}
    </>}
  </div></main>;
}
