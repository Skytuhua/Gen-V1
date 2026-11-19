import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { chromium, expect as pw, type Browser, type Page } from '@playwright/test';

// T03 gesture contract (AUD-01/AUD-03): a resize/move gesture must ignore non-primary
// buttons and foreign pointers, and tear down on blur / lost pointer capture so no
// stuck root class or follow-on movement survives an interruption.

const fixture = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ResizeHandle } from './apps/web/src/WorkspacePanel';
import { FloatingWindow } from './apps/web/src/FloatingWindow';
import { WorkspaceSplitLayout } from './apps/web/src/WorkspaceSplitLayout';
import { createSplitWorkspaceLayout, applySplitWorkspaceCommand } from './packages/core/split-workspace-layout';
import './apps/web/src/styles.css';
let splitLayout = createSplitWorkspaceLayout();
splitLayout = applySplitWorkspaceCommand(splitLayout, 'view.open', { view: { id: 'thread:a', kind: 'thread', binding: { authority: { kind: 'local' }, threadId: 'a' } } });
splitLayout = applySplitWorkspaceCommand(splitLayout, 'pane.split', { paneId: 'pane-main', newPaneId: 'right', splitId: 'cols', axis: 'horizontal', view: { id: 'thread:b', kind: 'thread', binding: { authority: { kind: 'local' }, threadId: 'b' } } });
let singleLayout = createSplitWorkspaceLayout();
singleLayout = applySplitWorkspaceCommand(singleLayout, 'view.open', { view: { id: 'thread:solo', kind: 'thread', binding: { authority: { kind: 'local' }, threadId: 'solo' } } });
const floatingLayout = applySplitWorkspaceCommand(singleLayout, 'view.park', { viewId: 'thread:solo' });
window.floatCommits=[]; window.lastFloatPointer=0;
window.addEventListener('pointerdown',event=>{window.lastFloatPointer=event.pointerId;},true);
function Fixture() {
  const [width, setWidth] = useState(300);
  const params = new URLSearchParams(location.search);
  const showSplit = params.has('split');
  const cornerWidth = params.has('corner') ? Number(params.get('w') || 500) : 0;
  return <main style={{ padding: 24 }}>
    <output data-width>{width}</output>
    <div style={{ display: 'flex', height: 200, border: '1px solid #888' }}>
      <div style={{ width, flex: '0 0 auto', background: '#eee' }}>left</div>
      <ResizeHandle label="Resize test panel" value={width} minimum={200} maximum={500} side="left" change={setWidth} />
      <div style={{ flex: 1 }}>right</div>
    </div>
    {showSplit && <div style={{ height: 300, width: 900 }}>
      <WorkspaceSplitLayout layout={splitLayout} onCommand={async () => {}} renderView={view => <div style={{ padding: 8 }}>{view.id}</div>} />
    </div>}
    {cornerWidth > 0 && <div style={{ height: 300, width: cornerWidth }}>
      <WorkspaceSplitLayout layout={singleLayout} onCommand={async () => {}} renderView={view => <div style={{ padding: 8 }}>{view.id}</div>} />
    </div>}
    {params.has('float') && <div style={{ height: 500, width: 900, display: 'flex' }}><WorkspaceSplitLayout layout={floatingLayout} floating={{'thread:solo':{x:100,y:80,width:400,height:params.has('terminal')?340:260}}} onMoveFloat={(viewId,rect)=>window.floatCommits.push({viewId,rect})} onReturnFloat={()=>{}} onCommand={async()=>{}} renderView={view=><input aria-label={'Float draft '+view.id} defaultValue="Retained float draft"/>}/></div>}
    {cornerWidth === 0 && <FloatingWindow id="gesture-window" title="Gesture" anchor="top-right" defaultSize={{ width: 300, height: 200 }} focusOnOpen={false}>
      <p>window body</p>
    </FloatingWindow>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
`;

const width = (page: Page) => page.locator('[data-width]').evaluate(node => Number(node.textContent));
const movePointer = (page: Page, pointerId: number, clientX: number) => page.evaluate(({ pointerId, clientX }) => {
  window.dispatchEvent(new PointerEvent('pointermove', { pointerId, clientX, clientY: 100, bubbles: true }));
}, { pointerId, clientX });

let browser: Browser, server: Server, base: string;
describe('gesture cleanup', () => {
  beforeAll(async () => {
    const script = (await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'tsx' }, loader: { '.css': 'empty' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0]!.text;
    const cssFiles = ['packages/ui-shell/tokens.css', 'apps/web/src/styles.css', 'apps/web/src/floating-window.css', 'apps/web/src/shell.css', 'apps/web/src/workspace-split.css'];
    const css = (await Promise.all(cssFiles.map(file => readFile(file, 'utf8')))).join('\n');
    server = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(`<style>${css}</style><div id="root"></div><script>${script}</script>`); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  }, 120_000);
  afterAll(async () => { await browser?.close(); server?.close(); });

  async function openPage(query = '') {
    const page = await browser.newPage();
    await page.route('**/api/**', route => route.fulfill({ status: 404 }));
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(base + query);
    await page.locator('[data-width]').waitFor();
    return page;
  }
  async function handleCenter(page: Page) {
    const box = (await page.getByRole('separator', { name: 'Resize test panel' }).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  it('AUD-01: a right-button press never starts a resize', async () => {
    const page = await openPage();
    const center = await handleCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(center.x + 60, center.y, { steps: 3 });
    expect(await width(page), 'right-button drag must not resize').toBe(300);
    expect(await page.evaluate(() => document.documentElement.classList.contains('resizing-panel'))).toBe(false);
    await page.mouse.up({ button: 'right' });
    await page.close();
  });

  it('AUD-01: a foreign pointer cannot drive an active resize', async () => {
    const page = await openPage();
    const center = await handleCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await movePointer(page, 2, center.x + 80);
    expect(await width(page), 'a second pointer must be ignored').toBe(300);
    await page.mouse.move(center.x + 40, center.y);
    expect(await width(page), 'the owning pointer still resizes').toBe(340);
    await page.mouse.up();
    await page.close();
  });

  it('a foreign pointer cannot end or replace an active resize', async () => {
    const page = await openPage();
    const center = await handleCenter(page), handle = page.getByRole('separator', { name: 'Resize test panel' });
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    await handle.dispatchEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true });
    await handle.dispatchEvent('lostpointercapture', { pointerId: 77, bubbles: true });
    await page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77 })); window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 77 })); });
    expect(await page.evaluate(() => document.documentElement.classList.contains('resizing-panel'))).toBe(true);
    await page.mouse.move(center.x + 40, center.y); expect(await width(page)).toBe(340);
    await page.mouse.up(); expect(await page.evaluate(() => document.documentElement.classList.contains('resizing-panel'))).toBe(false);
    await page.close();
  });

  it('AUD-01: window blur ends the resize and clears the root class', async () => {
    const page = await openPage();
    const center = await handleCenter(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await page.evaluate(() => document.documentElement.classList.contains('resizing-panel')), 'blur clears the resizing class').toBe(false);
    await movePointer(page, 1, center.x + 80);
    expect(await width(page), 'no resize after blur').toBe(300);
    await page.mouse.up();
    await page.close();
  });

  it('AUD-03: losing pointer capture ends a floating move; later moves do nothing', async () => {
    const page = await openPage();
    const move = page.getByRole('button', { name: 'Move Gesture' });
    const shell = page.locator('[data-floating-id="gesture-window"]');
    // Let the open entrance finish so it cannot re-render mid-gesture.
    await expect.poll(() => shell.evaluate(node => node.getAnimations().filter(animation => animation.playState === 'running').length), { timeout: 5000 }).toBe(0);
    const box = (await move.boundingBox())!;
    await page.evaluate(() => {
      (window as any).__ptr = null;
      window.addEventListener('pointerdown', event => { (window as any).__ptr = event.pointerId; }, true);
    });
    const initial = (await shell.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await pw(shell).toHaveAttribute('data-interacting', 'true');
    // Move until the gesture repositions the window, then let the pending capture
    // become active on the dispatched pointermove before releasing it.
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 3 });
    await expect.poll(async () => (await shell.boundingBox())!.x, { timeout: 5000 }).toBeGreaterThan(initial.x + 5);
    await page.waitForTimeout(60);
    const before = (await shell.boundingBox())!;
    await page.evaluate(() => {
      const element = document.querySelector('[data-floating-id="gesture-window"] .floating-window-move') as HTMLElement;
      const pointerId = (window as any).__ptr;
      // Release actual capture when it is active; the dispatched lostpointercapture
      // exercises the same teardown deterministically (finish is idempotent).
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      element.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId, bubbles: true }));
    });
    await pw(shell, 'lost capture ends the interaction').toHaveAttribute('data-interacting', 'false');
    expect(await page.evaluate(() => document.documentElement.classList.contains('floating-window-interaction'))).toBe(false);
    await movePointer(page, 1, box.x + 200);
    const after = (await shell.boundingBox())!;
    expect(Math.abs(after.x - before.x), 'no movement after capture loss').toBeLessThanOrEqual(1);
    await page.mouse.up();
    await page.close();
  });

  it('a second pointer cannot replace an active floating move', async () => {
    const page = await openPage(), move = page.getByRole('button', { name: 'Move Gesture' }), shell = page.locator('[data-floating-id="gesture-window"]');
    await expect.poll(() => shell.evaluate(node => node.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    const box = (await move.boundingBox())!, start = (await shell.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
    await expect.poll(async () => (await shell.boundingBox())!.x).toBeLessThan(start.x - 10);
    await move.dispatchEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true });
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2);
    await expect.poll(async () => (await shell.boundingBox())!.x).toBeLessThan(start.x - 60);
    await page.mouse.up(); await pw(shell).toHaveAttribute('data-interacting', 'false'); await page.close();
  });

  it('AUD-02: window blur cancels a split resize, clears the preview and releases capture', async () => {
    const page = await openPage('?split');
    const divider = page.getByRole('separator', { name: 'Resize columns' });
    await divider.waitFor();
    const box = (await divider.boundingBox())!;
    await page.evaluate(() => {
      (window as any).__ptr = null;
      window.addEventListener('pointerdown', event => { (window as any).__ptr = event.pointerId; }, true);
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
    await pw(divider).toHaveClass(/is-dragging/);
    const captured = await page.evaluate(() => {
      const element = document.querySelector('.split-divider') as HTMLElement;
      return element.hasPointerCapture((window as any).__ptr);
    });
    expect(captured, 'the divider owns the pointer during the resize').toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await pw(divider, 'blur clears the resize preview').not.toHaveClass(/is-dragging/);
    expect(await page.evaluate(() => (document.querySelector('.split-divider') as HTMLElement).hasPointerCapture((window as any).__ptr)), 'blur releases capture').toBe(false);
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
    await pw(divider, 'no preview after blur').not.toHaveClass(/is-dragging/);
    await page.mouse.up();
    await page.close();
  });

  for (const type of ['pointercancel', 'lostpointercapture']) it(`foreign ${type} cannot cancel a split resize`, async () => {
    const page = await openPage('?split'), divider = page.getByRole('separator', { name: 'Resize columns' });
    await divider.waitFor(); const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
    await pw(divider).toHaveClass(/is-dragging/);
    await divider.dispatchEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true });
    await divider.dispatchEvent(type, { pointerId: 77, bubbles: true });
    await pw(divider).toHaveClass(/is-dragging/);
    await page.mouse.up(); await pw(divider).not.toHaveClass(/is-dragging/); await page.close();
  });

  for (const type of ['pointercancel', 'lostpointercapture']) it(`foreign ${type} cannot cancel a split corner drag`, async () => {
    const page = await openPage('?corner&w=900'), corner = page.getByRole('button', { name: 'Split this area' });
    const box = (await corner.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
    await pw(page.locator('.split-drop-preview')).toHaveCount(1);
    await corner.dispatchEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true });
    await corner.dispatchEvent(type, { pointerId: 77, bubbles: true });
    await pw(page.locator('.split-drop-preview')).toHaveCount(1);
    await page.mouse.up(); await page.close();
  });

  for (const type of ['pointercancel', 'lostpointercapture']) for (const mode of ['move', 'resize'] as const) it(`foreign ${type} cannot cancel a floating split ${mode}`, async () => {
    const page = await openPage('?float'), grip = page.getByRole('button', { name: mode === 'move' ? 'Move chat' : 'Resize Conversation' });
    await grip.scrollIntoViewIfNeeded();
    const surface = page.locator('[data-split-view="thread:solo"]'), box = (await grip.boundingBox())!, start = (await surface.boundingBox())!;
    const property = mode === 'move' ? 'x' : 'width';
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
    await pw.poll(async () => (await surface.boundingBox())![property] - start[property]).toBeGreaterThan(40);
    await grip.dispatchEvent('pointerdown', { pointerId: 77, button: 0, bubbles: true });
    await grip.dispatchEvent(type, { pointerId: 77, bubbles: true });
    expect((await surface.boundingBox())![property] - start[property]).toBeGreaterThan(40);
    await page.mouse.up(); await page.close();
  });


  for (const mode of ['move', 'resize'] as const) for (const delta of [60, 0, 9999]) it(`floating ${mode} uses final pointer bounds (${delta}) and retains its draft`, async () => {
    const page = await openPage('?float&terminal'), surface = page.locator('[data-split-view="thread:solo"]');
    try {
      const grip = page.getByRole('button', {name: mode === 'move' ? 'Move chat' : 'Resize Conversation'});
      const input = surface.getByRole('textbox', {name: 'Float draft thread:solo'});
      await input.fill('Unsent terminal-position draft');
      await page.evaluate(() => { (window as any).originalFloatInput = document.querySelector('[data-split-view="thread:solo"] input'); });
      await grip.scrollIntoViewIfNeeded(); const box = (await grip.boundingBox())!;
      const viewport = await page.locator('.split-workspace').evaluate(node => ({width: node.clientWidth, height: node.clientHeight}));
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 10);
      await pw.poll(async () => (await surface.boundingBox())![mode === 'move' ? 'x' : 'width']).toBeGreaterThan(mode === 'move' ? 110 : 410);
      const pointerId = await page.evaluate(() => (window as any).lastFloatPointer as number), dy = delta === 60 ? 30 : delta;
      await grip.dispatchEvent('pointerup', {pointerId, button: 0, clientX: x + delta, clientY: y + dy});
      await page.mouse.up();
      const rect = mode === 'move' ? {x: Math.min(100 + delta, viewport.width - 20 - 400), y: Math.min(80 + dy, viewport.height - 20 - 340), width: 400, height: 340} : {x: delta === 9999 ? 20 : 100, y: delta === 9999 ? 20 : 80, width: Math.min(400 + delta, viewport.width - 40), height: Math.min(340 + dy, viewport.height - 40)};
      await pw.poll(() => page.evaluate(() => (window as any).floatCommits)).toEqual(mode === 'resize' && delta === 0 ? [] : [{viewId: 'thread:solo', rect}]);
      const painted = await surface.evaluate(node => {const el = node as HTMLElement; return {x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height)};});
      expect(painted).toEqual(rect);
      expect(await input.inputValue()).toBe('Unsent terminal-position draft');
      expect(await page.evaluate(() => (window as any).originalFloatInput === document.querySelector('[data-split-view="thread:solo"] input'))).toBe(true);
    } finally {await page.close();}
  });


  for (const delta of [2, 60]) it(`floating header click respects the movement threshold at release (${delta})`, async () => {
    const page = await openPage('?float&terminal'), surface = page.locator('[data-split-view="thread:solo"]');
    try {
      const grip = page.getByRole('button', {name: 'Move chat'});
      await grip.scrollIntoViewIfNeeded(); const box = (await grip.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 2, y);
      const pointerId = await page.evaluate(() => (window as any).lastFloatPointer as number);
      if (delta >= 3) await grip.dispatchEvent('pointerup', {pointerId, button: 0, clientX: x + delta, clientY: y});
      await page.mouse.up(); await page.evaluate(() => new Promise(requestAnimationFrame));
      const rect = {x: delta < 3 ? 100 : 100 + delta, y: 80, width: 400, height: 340};
      await pw.poll(() => page.evaluate(() => (window as any).floatCommits)).toEqual(delta < 3 ? [] : [{viewId: 'thread:solo', rect}]);
      expect(await surface.evaluate(node => ({x: parseFloat((node as HTMLElement).style.left), y: parseFloat((node as HTMLElement).style.top)}))).toEqual({x: rect.x, y: rect.y});
      await pw(page.getByRole('menu')).toHaveCount(delta < 3 ? 1 : 0);
    } finally {await page.close();}
  });

  it('AUD-04: an impossible edge split shows no preview; a fitting one does', async () => {
    async function cornerDrag(page: Page) {
      const corner = page.getByRole('button', { name: 'Split this area' });
      await corner.waitFor();
      // Let the ResizeObserver populate slot rects before fit validation runs.
      await page.waitForTimeout(150);
      const box = (await corner.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2, { steps: 6 });
      return corner;
    }
    // A 500px pane cannot fit a thread (320) + a new empty pane (240) + divider (6).
    const narrow = await openPage('?corner&w=500');
    await cornerDrag(narrow);
    expect(await narrow.locator('.split-drop-preview').count(), 'no hint for an impossible edge split').toBe(0);
    await narrow.mouse.up();
    await narrow.close();

    const wide = await openPage('?corner&w=900');
    await cornerDrag(wide);
    await pw(wide.locator('.split-drop-preview'), 'a fitting edge split previews').toHaveCount(1);
    await wide.mouse.up();
    await wide.close();
  });
});
