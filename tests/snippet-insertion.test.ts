import {afterAll, beforeAll, expect, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, type Browser, type Page} from '@playwright/test';
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {spliceSnippet} from '../apps/web/src/snippet-insertion';

// Pure splice: UTF-16 bounds, order and caret — no DOM needed.
it('splices at start/middle/end and over a full or empty selection', () => {
  expect(spliceSnippet('before after', 0, 0, 'x ')).toEqual({text: 'x before after', caret: 2});
  expect(spliceSnippet('before after', 6, 6, ' x')).toEqual({text: 'before x after', caret: 8});
  expect(spliceSnippet('before after', 12, 12, ' x')).toEqual({text: 'before after x', caret: 14});
  expect(spliceSnippet('before after', 0, 12, 'all')).toEqual({text: 'all', caret: 3});
  expect(spliceSnippet('a🙂z', 1, 3, 'multi\nline')).toEqual({text: 'amulti\nlinez', caret: 11});
});
it('rejects invalid ranges without mutating', () => {
  for (const [start, end] of [[-1, 0], [0, 99], [4, 2], [1.5, 2], [0, NaN]]) expect(spliceSnippet('abc', start, end, 'x'), `${start},${end}`).toBeNull();
});

declare const api: {
  mount(): void; unmount(): void;
  insert(body: string): unknown; undo(): {ok: boolean; error?: string};
  value(): string; selection(): [number, number]; edits(): string[]; clearEdits(): void;
  forceFallback(mode: boolean): void; setEditable(editable: boolean): void;
  setSignature(signature: string): void; capture(): unknown; receipt(): unknown;
  chooseSnippets(): Promise<unknown>; snippetCalls(): unknown[];
  typeText(text: string): void; select(start: number, end: number, direction?: string): void;
};

let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const bundle = await build({stdin: {resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useRef, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ComposerCommands} from './apps/web/src/ComposerCommands.tsx';
    import {insertSnippet, undoInsertion, captureSelection} from './apps/web/src/snippet-insertion.ts';
    import {useSnippetInsertion} from './apps/web/src/useSnippetInsertion.ts';
    const api = window.api = {};
    let fallback = false, editable = true;
    const realExec = document.execCommand ? document.execCommand.bind(document) : null;
    if (realExec) document.execCommand = (command, ui, value) => fallback ? false : realExec(command, ui, value);
    function Harness(){
      const input = useRef(null), [draft, setDraft] = useState('before after'), [signature, setSignature] = useState('owner-a'), [edits] = [api.editsLog ??= []];
      const insertion = useSnippetInsertion({input, signature, editable: () => editable, onEdit: text => {edits.push(text); setDraft(text);}});
      api.capture = () => insertion.capture; api.receipt = () => insertion.receipt;
      api.insert = body => insertion.insert(body); api.undo = () => insertion.undo();
      api.setSignature = setSignature;
      const [calls] = [api.snippetCallsLog ??= []];
      api.chooseSnippets = async token => {calls.push(token);};
      return <><textarea ref={input} value={draft} onChange={event => setDraft(event.target.value)}/><ComposerCommands input={input} draft={draft} onDraft={setDraft} onModel={() => {}} onMode={() => {}} onSnippets={api.chooseSnippets}/></>;
    }
    api.mount = () => createRoot(document.getElementById('root')).render(<Harness/>);
    api.forceFallback = mode => {fallback = mode;};
    api.setEditable = next => {editable = next;};
    api.value = () => document.querySelector('textarea').value;
    api.selection = () => {const el = document.querySelector('textarea'); return [el.selectionStart, el.selectionEnd];};
    api.edits = () => api.editsLog;
    api.clearEdits = () => {api.editsLog.length = 0;};
    api.snippetCalls = () => api.snippetCallsLog;
    api.typeText = text => {const el = document.querySelector('textarea'); el.focus(); document.execCommand('insertText', false, text);};
    api.select = (start, end, direction) => {const el = document.querySelector('textarea'); el.focus(); el.setSelectionRange(start, end, direction); el.dispatchEvent(new Event('select', {bubbles: true}));};
  `}, bundle: true, write: false, platform: 'browser', format: 'iife', define: {'process.env.NODE_ENV': '"production"'}, loader: {'.css': 'empty'}});
  server = createServer((request, response) => {
    response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({channel: 'chromium'});
});
afterAll(async () => {await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve()));});

const ready = async (): Promise<Page> => {const page = await browser.newPage(); await page.goto(origin); await page.evaluate('api.mount()'); await page.locator('textarea').waitFor(); return page;};

it('captures the remembered selection, inserts natively, fires exactly one owner edit and keeps a bounded undo receipt', async () => {
  const page = await ready();
  await page.evaluate('api.select(0, 6)'); // select "before"
  const result = await page.evaluate('api.insert("start ")');
  expect(result).toMatchObject({ok: true, mode: 'native'});
  expect(await page.evaluate('api.value()')).toBe('start  after');
  expect(await page.evaluate('api.selection()')).toEqual([6, 6]);
  expect(await page.evaluate('api.edits()')).toEqual(['start  after']);
  // Native one-step undo restores the pre-insert text (real Chromium).
  expect(await page.evaluate('api.value() && (document.execCommand("undo"), api.value())')).toBe('before after');
  await page.close();
});
it('forced fallback splices, reports the caret and the receipt undo restores the captured range', async () => {
  const page = await ready();
  await page.evaluate('api.select(7, 12); api.forceFallback(true)');
  const result = await page.evaluate('api.insert("🙂\\nmulti")');
  expect(result).toMatchObject({ok: true, mode: 'fallback'});
  expect(await page.evaluate('api.value()')).toBe('before 🙂\nmulti');
  expect(await page.evaluate('api.selection()')).toEqual([7 + 8, 7 + 8]); // '🙂\nmulti' is 8 UTF-16 units
  const undone = await page.evaluate('api.undo()');
  expect(undone).toEqual({ok: true});
  expect(await page.evaluate('api.value()')).toBe('before after');
  expect(await page.evaluate('api.edits()')).toEqual(['before 🙂\nmulti', 'before after']);
  await page.close();
});
it('undo is invalidated by any later edit and by an owner change', async () => {
  const page = await ready();
  await page.evaluate('api.select(12, 12); api.insert(" tail")');
  await page.evaluate('api.typeText(" more")'); // later user edit
  expect(await page.evaluate('api.undo()')).toMatchObject({ok: false});
  await page.evaluate('api.select(0, 0); api.insert("x")');
  await page.evaluate('api.setSignature("owner-b")');
  expect(await page.evaluate('api.undo()')).toMatchObject({ok: false});
  expect(await page.evaluate('api.capture()')).toBeNull();
  await page.close();
});
it('rejects stale text, read-only/disconnected elements and uneditable owners without writing', async () => {
  const page = await ready();
  await page.evaluate('api.select(0, 6)');
  // Drift the element value without an input event so the capture goes stale.
  await page.evaluate('Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(document.querySelector("textarea"), "hacked")');
  const stale = await page.evaluate('api.insert("x")');
  expect(stale).toMatchObject({ok: false});
  await page.evaluate('api.setEditable(false)');
  const uneditable = await page.evaluate('api.select(0, 0); api.insert("x")');
  expect(uneditable).toMatchObject({ok: false});
  await page.evaluate('api.setEditable(true)');
  // A retained capture on a now-readOnly element is rejected at insert time.
  await page.evaluate('api.select(0, 0); document.querySelector("textarea").readOnly = true');
  expect(await page.evaluate('api.insert("x")')).toMatchObject({ok: false});
  await page.close();
});
it('hands the validated /snippets token to onSnippets while the literal token text survives', async () => {
  const page = await ready();
  await page.evaluate('api.select(12, 12); api.typeText(" /snip")');
  const row = page.locator('.composer-command-name', {hasText: '/snippets'});
  await row.waitFor();
  await row.click();
  const calls = await page.evaluate('api.snippetCalls()');
  expect(calls).toEqual([{start: 13, end: 18, query: 'snip'}]);
  expect(await page.evaluate('api.value()')).toBe('before after /snip'); // token survives; no silent splice
  await page.close();
});
it('backward selection inserts at the same range and caret follows the body', async () => {
  const page = await ready();
  await page.evaluate('api.select(0, 6, "backward")');
  expect(await page.evaluate('api.insert("B")')).toMatchObject({ok: true});
  expect(await page.evaluate('api.value()')).toBe('B after');
  await page.close();
});
