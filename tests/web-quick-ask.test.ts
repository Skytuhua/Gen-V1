import { describe, expect, it } from 'vitest';
import type { QuickAskOpen } from '../packages/desktop-contract/index';
import { quickAskDefaultTarget, quickAskKeyAction, quickAskSendable, runQuickAskSend, type QuickAskPending, type QuickAskTarget } from '../apps/web/src/QuickAsk';

// The quick-ask renderer sends through the same command() contract as the main
// composer; a kept QuickAskPending reuses commandId and a created threadId on Retry.

const open = (over: Partial<QuickAskOpen> = {}): QuickAskOpen => ({
  currentThreadId: 'th-1', currentThreadTitle: 'Triage', currentThreadSendable: true,
  currentProjectId: 'pr-1', currentProjectName: 'App', target: 'current', ...over,
});
const thread = { id: 'th-1', modelId: 'acme/pro' } as never;

interface Call { type: string; payload: Record<string, unknown>; threadId?: string; commandId?: string }
const makeCommand = (failOn?: string, result?: unknown) => {
  const calls: Call[] = [];
  const command = async (type: string, payload: Record<string, unknown>, threadId?: string, commandId?: string) => {
    calls.push({ type, payload, threadId, commandId });
    if (type === failOn) throw Error(`${type} failed`);
    return { result: type === 'thread.create' ? result ?? { id: 'th-new' } : {} };
  };
  return { calls, command };
};
const pending = (over: Partial<QuickAskPending> = {}): QuickAskPending => ({ commandId: 'cmd-1', content: 'hello', target: 'new', ...over });
const deps = (calls: { command: ReturnType<typeof makeCommand>['command'] }, over: Partial<Parameters<typeof runQuickAskSend>[1]> = {}) =>
  ({ command: calls.command, currentThreadId: 'th-1', projectId: 'pr-1', modelId: 'acme/pro', sent: async () => {}, ...over });

describe('quick-ask send', () => {
  it('new-thread send creates the thread then sends once', async () => {
    const { calls, command } = makeCommand(), sent: Array<{ threadId: string; target: QuickAskTarget }> = [];
    await runQuickAskSend(pending(), { ...deps({ command }), sent: async n => void sent.push(n) });
    expect(calls.map(c => c.type)).toEqual(['thread.create', 'message.send']);
    expect(calls[0].payload).toEqual({ projectId: 'pr-1' });
    expect(calls[1].threadId).toBe('th-new');
    expect(calls[1].commandId).toBe('cmd-1');
    expect(calls[1].payload).toMatchObject({ content: 'hello', modelId: 'acme/pro', thinkingLevel: null });
    expect(sent).toEqual([{ threadId: 'th-new', target: 'new' }]);
  });

  it('current-thread send skips thread.create and targets the open thread', async () => {
    const { calls, command } = makeCommand(), sent: Array<{ threadId: string; target: QuickAskTarget }> = [];
    await runQuickAskSend(pending({ target: 'current' }), { ...deps({ command }), sent: async n => void sent.push(n) });
    expect(calls.map(c => c.type)).toEqual(['message.send']);
    expect(calls[0].threadId).toBe('th-1');
    expect(sent).toEqual([{ threadId: 'th-1', target: 'current' }]);
  });

  it('current-thread send without an open thread fails before any command', async () => {
    const { calls, command } = makeCommand();
    await expect(runQuickAskSend(pending({ target: 'current' }), deps({ command }, { currentThreadId: null }))).rejects.toThrow('No thread is open');
    expect(calls).toEqual([]);
  });

  it('a failed send keeps the pending attempt and Retry reuses the commandId', async () => {
    const { calls, command } = makeCommand('message.send'), attempt = pending();
    await expect(runQuickAskSend(attempt, deps({ command }))).rejects.toThrow('message.send failed');
    await runQuickAskSend(attempt, deps({ command: makeCommand().command }));
    expect(calls.filter(c => c.type === 'message.send').map(c => c.commandId)).toEqual(['cmd-1']);
    expect(attempt.commandId).toBe('cmd-1');
  });

  it('created thread survives a failed send: Retry skips thread.create and reuses it', async () => {
    const first = makeCommand('message.send'), second = makeCommand(), attempt = pending();
    await expect(runQuickAskSend(attempt, deps({ command: first.command }))).rejects.toThrow();
    expect(attempt.threadId).toBe('th-new');
    await runQuickAskSend(attempt, deps({ command: second.command }));
    expect(second.calls.map(c => c.type)).toEqual(['message.send']);
    expect(second.calls[0].threadId).toBe('th-new');
    expect(second.calls[0].commandId).toBe('cmd-1');
  });

  it('no project: thread.create is called with an empty payload', async () => {
    const { calls, command } = makeCommand();
    await runQuickAskSend(pending(), deps({ command }, { projectId: null }));
    expect(calls[0].payload).toEqual({});
  });
});

describe('quick-ask target', () => {
  it('forces New when the pushed target is not sendable', () => {
    expect(quickAskDefaultTarget(open())).toBe('current');
    expect(quickAskDefaultTarget(open({ target: 'current', currentThreadSendable: false }))).toBe('new');
    expect(quickAskDefaultTarget(open({ target: 'new' }))).toBe('new');
  });

  it('Current is disabled unless a sendable thread resolves', () => {
    expect(quickAskSendable(open(), thread)).toBe(true);
    expect(quickAskSendable(open({ currentThreadSendable: false }), thread)).toBe(false);
    expect(quickAskSendable(open({ currentThreadId: null }), undefined)).toBe(false);
    expect(quickAskSendable(open(), undefined)).toBe(false);
  });
});

describe('quick-ask keys', () => {
  const base = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false };
  it.each([
    [{ ...base }, 'enter', 'send'], [{ ...base, ctrlKey: true }, 'mod-enter', 'send'], [{ ...base, metaKey: true }, 'mod-enter-multiline', 'send'],
    [{ ...base }, 'mod-enter', null], [{ ...base, shiftKey: true }, 'enter', null],
  ])('Enter variant %j with %s -> %s', (event, sendShortcut, expected) => {
    expect(quickAskKeyAction(sendShortcut, event)).toBe(expected);
  });
  it('Escape hides and other keys do nothing', () => {
    expect(quickAskKeyAction('enter', { ...base, key: 'Escape' })).toBe('hide');
    expect(quickAskKeyAction('enter', { ...base, key: 'a' })).toBe(null);
  });
});
