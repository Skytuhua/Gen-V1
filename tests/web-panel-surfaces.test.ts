import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, type Browser} from '@playwright/test';

const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ControlConsentPanel} from './apps/web/src/ControlConsentPanel';
import {IntegrationSecretReferences} from './apps/web/src/IntegrationSecretReferences';

window.__requests = [];
window.__respond = () => new Response(JSON.stringify({error:{code:'UNCONFIGURED',message:'unhandled'}}),{status:404,headers:{'Content-Type':'application/json'}});
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  window.__requests.push({url, method: init?.method ?? 'GET', body: init?.body});
  if (url === '/api/bootstrap') return Response.json({csrfToken: 'synthetic'});
  return window.__respond(url, init);
};
window.__mountConsent = () => {
  const el = document.createElement('div'); document.body.append(el);
  createRoot(el).render(<ControlConsentPanel threadId="thread-1"/>);
  return el;
};
window.__mountSecrets = () => {
  const el = document.createElement('div'); document.body.append(el);
  createRoot(el).render(<IntegrationSecretReferences/>);
  return el;
};
`;

const owner = {threadId: 'thread-1', runId: null, epoch: 0, projectId: null, workspaceId: null, accountBinding: null};
const pending = {consentId: 'consent-1', owner, mode: 'FRESH_VERIFICATION_BROWSER', requestedObserve: true, requestedOperations: ['CLICK'], allowedOrigins: ['https://example.com'], state: 'PENDING', reason: null, createdAtMs: 1, resolvedAtMs: null};
const grant = {grantId: 'grant-1', owner, mode: 'CONSENTED_EXISTING_TAB', target: {kind: 'BROWSER_TAB', creationIdentity: 'tab-1', sessionIdentity: 'session-1', origin: 'https://example.com'}, permittedOperations: ['CLICK'], allowedOrigins: ['https://example.com'], capturePermission: true, issuedAtMs: 1, expiresAtMs: 600000, revocationGeneration: 0};
const model = (overrides: Record<string, unknown>) => ({control: {state: 'unavailable', liveControlActive: false, modes: [], permissions: {observe: false, interact: false}, expiryMs: null, activeGrant: null, pendingConsent: null, stopAvailable: false, reason: null, ...overrides}});
const respond = (value: unknown) => `window.__respond = () => new Response(${JSON.stringify(JSON.stringify(value))}, {status: 200, headers: {'Content-Type': 'application/json'}})`;

describe('web panel surfaces (#1360)', () => {
  let browser: Browser, script: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: {'.css': 'empty'}, define: {'process.env.NODE_ENV': '"production"'}})).outputFiles[0]!.text;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => { await browser?.close(); });

  const page = async () => {
    const target = await browser.newPage();
    // Serve at http://localhost/ so secure-context APIs (crypto.randomUUID in
    // api.command) exist; /api/* fetches still hit the fixture's stub.
    await target.route('http://localhost/', route => route.fulfill({contentType: 'text/html', body: '<div id="root"></div>'}));
    await target.goto('http://localhost/');
    await target.addScriptTag({content: script});
    return target;
  };

  it('renders nothing when no control is live and no consent is pending', async () => {
    const target = await page();
    try {
      await target.evaluate(respond(model({reason: 'No approved driver'})));
      await target.evaluate('window.__mountConsent()');
      await target.waitForTimeout(300);
      expect(await target.locator('section').count()).toBe(0);
      expect(((await target.evaluate('window.__requests')) as {url: string}[]).some(request => request.url === '/api/threads/thread-1/control')).toBe(true);
    } finally { await target.close(); }
  });

  it('shows the unavailable state with modes and a disabled Stop when consent is pending', async () => {
    const target = await page();
    try {
      await target.evaluate(respond(model({pendingConsent: pending, modes: [{mode: 'FRESH_VERIFICATION_BROWSER', available: false, reason: 'No driver'}, {mode: 'SELECTED_DESKTOP_APPLICATION', available: false, reason: 'Not supported'}]})));
      await target.evaluate('window.__mountConsent()');
      const section = target.locator('section');
      await expect.poll(() => section.count()).toBe(1);
      await expect.poll(() => section.textContent()).toContain('Unavailable');
      expect(await section.textContent()).toContain('Fresh verification browser: unavailable (No driver)');
      expect(await section.textContent()).toContain('Selected desktop application: unavailable (Not supported)');
      expect(await section.getByRole('button', {name: 'Stop'}).isDisabled()).toBe(true);
    } finally { await target.close(); }
  });

  it('shows the consent preview when approval is requested', async () => {
    const target = await page();
    try {
      await target.evaluate(respond(model({state: 'consent', pendingConsent: pending})));
      await target.evaluate('window.__mountConsent()');
      const section = target.locator('section');
      await expect.poll(() => section.textContent()).toContain('Needs permission');
      const text = await section.textContent();
      expect(text).toContain('Fresh verification browser');
      expect(text).toContain('Observe: requested · Interact: CLICK · Expires 10 minutes after approval.');
      expect(text).toContain('Origins: https://example.com');
      expect(await section.getByRole('button', {name: 'Stop'}).isDisabled()).toBe(true);
    } finally { await target.close(); }
  });

  it('shows the active grant and Stop revokes it through the command channel', async () => {
    const target = await page();
    try {
      const active = JSON.stringify(model({state: 'active', liveControlActive: true, expiryMs: 120000, activeGrant: grant, stopAvailable: true})), after = JSON.stringify(model({reason: 'Revoked'})), receipt = JSON.stringify({commandId: 'receipt-1', result: JSON.parse(after), seq: 2});
      await target.evaluate(`window.__stopped = false; window.__respond = (url) => url === '/api/commands' ? (window.__stopped = true, new Response(${JSON.stringify(receipt)}, {status: 200, headers: {'Content-Type': 'application/json'}})) : new Response(window.__stopped ? ${JSON.stringify(after)} : ${JSON.stringify(active)}, {status: 200, headers: {'Content-Type': 'application/json'}})`);
      await target.evaluate('window.__mountConsent()');
      const section = target.locator('section');
      await expect.poll(() => section.textContent()).toContain('Controlled tab');
      expect(await section.textContent()).toContain('Consented existing tab · Observe allowed · Interact CLICK');
      const stop = section.getByRole('button', {name: 'Stop'});
      await expect.poll(() => stop.isEnabled()).toBe(true);
      await stop.click();
      await expect.poll(async () => ((await target.evaluate('window.__requests')) as {url: string; body?: string}[]).filter(request => request.url === '/api/commands' && request.body?.includes('"control.stop"')).length).toBe(1);
      await expect.poll(() => target.locator('section').count()).toBe(0);
    } finally { await target.close(); }
  });

  it('reads secret reference metadata and renders the configured reference without a credential value', async () => {
    const target = await page();
    try {
      const view = {version: 1, enabled: true, configured: true, references: [{refId: 'context7.11111111-2222-4333-8444-555555555555', purpose: 'Context7 documentation', owner: 'personal/context7', destination: {kind: 'process-env', executableSha256: 'a'.repeat(64), envName: 'CONTEXT7_API_KEY'}, revoked: false}]};
      await target.evaluate(respond(view));
      await target.evaluate('window.__mountSecrets()');
      const section = target.locator('section');
      await expect.poll(() => section.textContent()).toContain('A Context7 credential is configured.');
      const text = await section.textContent();
      expect(text).toContain('context7.11111111-2222-4333-8444-555555555555');
      expect(text).toContain('CONTEXT7_API_KEY');
      expect(text).toContain('The credential value is never displayed here.');
      expect(((await target.evaluate('window.__requests')) as {url: string}[]).some(request => request.url === '/api/integrations/secret-references')).toBe(true);
    } finally { await target.close(); }
  });

  it('reports the disabled host and re-fetches on Reload', async () => {
    const target = await page();
    try {
      await target.evaluate(respond({version: 1, enabled: false, configured: false, references: []}));
      await target.evaluate('window.__mountSecrets()');
      const section = target.locator('section');
      await expect.poll(() => section.textContent()).toContain('No Context7 credential is configured.');
      expect(await section.textContent()).toContain('Secret reference approvals are disabled on this host.');
      const before = ((await target.evaluate('window.__requests')) as {url: string}[]).filter(request => request.url === '/api/integrations/secret-references').length;
      await section.getByRole('button', {name: 'Reload secret references'}).click();
      await expect.poll(async () => ((await target.evaluate('window.__requests')) as {url: string}[]).filter(request => request.url === '/api/integrations/secret-references').length).toBe(before + 1);
    } finally { await target.close(); }
  });

  it('shows the unavailable presentation on malformed metadata instead of guessing', async () => {
    const target = await page();
    try {
      await target.evaluate(respond({version: 2, enabled: true}));
      await target.evaluate('window.__mountSecrets()');
      const section = target.locator('section');
      await expect.poll(() => section.textContent()).toContain('Secret reference metadata is unavailable. Reload to check the current host status.');
    } finally { await target.close(); }
  });
});
