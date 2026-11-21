import {afterEach, describe, expect, it, vi} from 'vitest';
import {createElement, type RefObject} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {useTableControls} from '../apps/web/src/TaskTableControls';
import {columnWidth, cycleSort, keyboardWidth, moveColumn, reconcileOrder, tableCellText, tableView, type TableColumn} from '../apps/web/src/task-table-model';

afterEach(() => vi.unstubAllGlobals());

const columns: TableColumn[] = [
  {key: 'name', label: 'Name'},
  {key: 'tokens', label: 'Tokens', type: 'number'},
];
const rows = [{name: 'beta', tokens: 30}, {name: 'alpha', tokens: 5}];

function Probe({selectable}: {selectable?: boolean}) {
  const scroll = {current: null} as RefObject<HTMLDivElement | null>;
  const controls = useTableControls(columns, rows, scroll, () => {}, selectable ?? false);
  return <><div data-testid="filter">{controls.filter}</div><table><thead><tr>{controls.headers}</tr></thead></table><span data-testid="view-size">{controls.view.length}</span></>;
}

describe('TaskTableControls static contract', () => {
  it('renders every column label with sort, move and resize controls and announces row count', () => {
    const html = renderToStaticMarkup(createElement(Probe));
    for (const label of ['Name', 'Tokens']) {
      expect(html).toContain(`aria-label="Sort ${label}"`);
      expect(html).toContain(`aria-label="Move ${label} column"`);
      expect(html).toContain(`aria-label="Resize ${label} column"`);
    }
    expect(html).toContain('aria-label="Filter rows"');
    expect(html).toContain('aria-valuemax="420"');
    expect(html).toContain('Drag or use Alt+Left/Right to move');
    expect(html).toContain('data-testid="view-size"');
  });
});

describe('task-table-model decisions', () => {
  it('cycleSort rotates ascending -> descending -> none per column', () => {
    expect(cycleSort(null, 'name')).toEqual({key: 'name', direction: 'ascending'});
    expect(cycleSort({key: 'name', direction: 'ascending'}, 'name')).toEqual({key: 'name', direction: 'descending'});
    expect(cycleSort({key: 'name', direction: 'descending'}, 'name')).toBeNull();
    expect(cycleSort({key: 'name', direction: 'descending'}, 'tokens')).toEqual({key: 'tokens', direction: 'ascending'});
  });
  it('tableView filters on settled query and sorts numbers numerically', () => {
    expect(tableView(rows, columns, '', {key: 'tokens', direction: 'descending'}).map(row => row.item.name)).toEqual(['beta', 'alpha']);
    expect(tableView(rows, columns, 'alp', null).map(row => row.item)).toEqual([{name: 'alpha', tokens: 5}]);
    expect(tableView(rows, columns, 'missing', null)).toEqual([]);
  });
  it('moveColumn and reconcileOrder keep the header order consistent', () => {
    expect(moveColumn(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(reconcileOrder(['c', 'gone', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
  });
  it('width helpers clamp to the 90..420 contract', () => {
    expect(columnWidth(10)).toBe(90);
    expect(columnWidth(10_000)).toBe(420);
    expect(keyboardWidth(200, 'ArrowLeft')).toBe(180);
    expect(keyboardWidth(200, 'Home')).toBe(90);
    expect(keyboardWidth(90, 'End')).toBe(420);
  });
  it('tableCellText formats number columns without exponent drift', () => {
    expect(tableCellText(1e21, {type: 'number'})).not.toContain('e+');
    expect(tableCellText(null, {})).toBe('NULL');
  });
});

describe('agent work API requests used by AgentWorkPanel', () => {
  const api = async () => await import('../apps/web/src/agent-work-api.ts');
  const calls: {url: string, init?: RequestInit}[] = [];
  function stub() {
    calls.length = 0;
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({url, init});
      if (url === '/api/bootstrap') return Response.json({csrfToken: 'csrf'});
      if (url === '/api/commands') return Response.json({commandId: 'cmd-1', eventSeq: 1, result: {}});
      return Response.json(url.includes('messages') ? {messages: []} : url.includes('plan') ? {extension: false, planId: 'p'} : {enabled: true, works: [], budget: {}, roles: {}});
    }));
  }

  it('reads work, plan and messages for the owning task', async () => {
    stub();
    const mod = await api();
    await mod.getAgentWork('task-9');
    await mod.getAgentWorkPlan('task-9');
    await mod.getAgentWorkInputs('task-9', 'thread-2');
    expect(calls.map(call => call.url)).toEqual([
      '/api/bootstrap', '/api/agent-work?taskId=task-9', '/api/agent-work/plan?taskId=task-9',
      '/api/agent-work/inputs?taskId=task-9&targetThreadId=thread-2',
    ]);
    expect(calls.every(call => call.init?.credentials === 'same-origin')).toBe(true);
  });

  it('sends the exact commands the panel buttons trigger', async () => {
    stub();
    const mod = await api();
    await mod.stopAgentWork('task-9', 'w-1');
    await mod.resumeAgentWork('task-9', 'w-2');
    await mod.sendAgentInput('task-9', {workId: 'w-3', kind: 'STEER', text: 'focus the build', inputId: 'i-1', dedupeKey: 'd-1'});
    await mod.cancelAgentInput('task-9', 'thread-4', 'i-9');
    await mod.postAgentMessage('task-9', {recipientThreadId: 'thread-5', topic: 't', text: 'body', messageId: 'm-1'});
    const commands = calls.filter(call => call.url === '/api/commands').map(call => JSON.parse(String(call.init!.body)) as {type: string, payload: Record<string, unknown>, threadId: string});
    expect(commands.map(command => command.type)).toEqual(['agentWork.stop', 'agentWork.resume', 'agentWork.input', 'agentWork.input.cancel', 'agentWork.message']);
    expect(commands[0]).toMatchObject({payload: {workId: 'w-1'}, threadId: 'task-9'});
    expect(commands[2]).toMatchObject({payload: {workId: 'w-3', kind: 'STEER', text: 'focus the build', inputId: 'i-1', dedupeKey: 'd-1'}});
    expect(commands[3]).toMatchObject({payload: {targetThreadId: 'thread-4', inputId: 'i-9'}});
    expect(commands[4]).toMatchObject({payload: {recipientThreadId: 'thread-5', topic: 't', text: 'body', messageId: 'm-1'}});
    const posts = calls.filter(call => call.url === '/api/commands');
    expect(posts.every(call => (call.init!.headers as Record<string, string>)['x-harness-csrf'] === 'csrf')).toBe(true);
  });
});
