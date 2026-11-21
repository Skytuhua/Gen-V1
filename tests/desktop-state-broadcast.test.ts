import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

it('still publishes desktop state to the main window when another renderer closes', () => {
  const source = ts.createSourceFile('main.ts', readFileSync(new URL('../apps/desktop/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
  const broadcast = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'broadcast');
  if (!broadcast) throw Error('Desktop state publisher is missing');
  const { outputText } = ts.transpileModule(broadcast.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  // Run the real publisher without starting Electron. Only the renderer edge is synthetic.
  const failed = vi.fn(() => { throw Error('Render frame was disposed'); }), stopped = vi.fn(), main = vi.fn();
  const windows = [
    { id: 'closed', surface: { kind: 'thread' }, window: { isDestroyed: () => true, webContents: { send: stopped } } },
    { id: 'detached', surface: { kind: 'thread' }, window: { isDestroyed: () => false, webContents: { send: failed } } },
    { id: 'main', surface: { kind: 'main' }, window: { isDestroyed: () => false, webContents: { send: main } } },
  ];
  const focus = { kind: 'thread', threadId: 'own-thread' };
  const publish = new Function('windows', 'channels', 'snapshot', 'focus', outputText + '\nbroadcast(focus);');
  expect(() => publish(windows, { state: 'state' }, (record: { id: string }) => ({ id: record.id }), focus)).not.toThrow();
  expect(stopped).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith('state', { id: 'detached' });
  expect(main).toHaveBeenCalledExactlyOnceWith('state', { id: 'main', focusSurface: focus });
});

it('publishes the power state in every desktop snapshot', () => {
  const source = ts.createSourceFile('main.ts', readFileSync(new URL('../apps/desktop/main.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest);
  const snapshot = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'snapshot');
  if (!snapshot) throw Error('Desktop snapshot builder is missing');
  const { outputText } = ts.transpileModule(snapshot.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const build = new Function('windows', 'info', 'backendError', 'layoutError', 'updateStatus', 'powerState', 'process', 'record', outputText + '\nreturn snapshot(record);');
  const record = { id: 'main', browser: undefined, dockedBrowser: undefined };
  const state = build(new Map(), () => ({ id: 'main' }), undefined, undefined, { state: 'idle', message: '' }, { state: 'holding', reason: 'tasks' }, { platform: 'linux' }, record) as { power: unknown };
  expect(state.power).toEqual({ state: 'holding', reason: 'tasks' });
});
