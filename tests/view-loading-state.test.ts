import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {chromium, type Browser} from '@playwright/test';

const fixture = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LoadingState} from './apps/web/src/LoadingState';
import {WorkspaceSkeleton, AgentsSkeleton, ReviewWorkspaceSkeleton, SettingsSkeleton} from './apps/web/src/ViewSkeletons';
const skeletons = {workspace: WorkspaceSkeleton, agents: AgentsSkeleton, review: ReviewWorkspaceSkeleton, settings: SettingsSkeleton};
function Fixture() {
 const [pending, setPending] = useState(true), [loaded, setLoaded] = useState(false);
 window.resolveLoad = () => {setLoaded(true); setPending(false);};
 window.refresh = () => setPending(true);
 window.finish = () => setPending(false);
 const Skeleton = skeletons[window.view];
 return <LoadingState pending={pending} hasContent={loaded} label={'Opening ' + window.view + '…'} skeleton={<Skeleton/>} className="view-loading-state">
  <label>Retained draft<input defaultValue="Unsent edits"/></label>
 </LoadingState>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
type FixtureWindow = Window & {view: string; resolveLoad(): void; refresh(): void; finish(): void; retained?: Element};
const views = {
  workspace: ['.sidebar', '.workspace-header', '.loading-conversation', '.composer-dock .loading-composer'],
  agents: ['.agents-project-header', '.agents-parent-strip', '.agents-transcript', '.agents-children'],
  review: ['.cr-toolbar', '.cr-files', '.cr-diff .cr-patch', '.cr-context .cr-draft'],
  settings: ['.settings-navigation', '.settings-page-heading', '.settings-row-copy', '.settings-row'],
};

describe('structure-matched first-load feedback', () => {
  let browser: Browser, script: string, css: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}, loader: {'.css': 'empty'}})).outputFiles[0]!.text;
    css = (await readFile('apps/web/src/styles.css', 'utf8')).replace(/^@import[^;]+;/, await readFile('packages/ui-shell/tokens.css', 'utf8'));
    for (const path of ['shell.css', 'settings.css', 'workspace-host.css', 'agents-workspace/agents-workspace.css', 'code-review-workspace/code-review-workspace.css', 'loading-state.css']) css += (await readFile('apps/web/src/' + path, 'utf8')).replace(/^@import[^;]+;/, '');
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => {await browser?.close();});

  async function open(view: string, width: number, reducedMotion: boolean) {
    const page = await browser.newPage({viewport: {width, height: 1000}, reducedMotion: reducedMotion ? 'reduce' : 'no-preference'});
    const time = new Date('2026-11-09T12:00:00Z');
    await page.clock.install({time}); await page.clock.pauseAt(new Date(time.getTime() + 1000));
    await page.setContent(`<html data-theme="dark"><body><main id="root" class="${view === 'settings' ? 'ui-modal settings-dialog' : view === 'agents' ? 'workspace-host-bootstrap agents-workspace' : 'workspace-host-bootstrap'}"></main></body></html>`);
    await page.addStyleTag({content: css});
    await page.evaluate(view => {(window as unknown as FixtureWindow).view = view;}, view);
    await page.addScriptTag({content: script});
    await page.locator('.loading-state-skeleton').waitFor({state: 'attached'});
    return page;
  }

  for (const [view, structure] of Object.entries(views)) for (const width of [1440, 1024, 768]) it(`${view} reserves its layout at ${width}, delays feedback 150ms, and retains edits on refresh`, async () => {
    const page = await open(view, width, true);
    try {
      const skeleton = page.locator('.loading-state-skeleton');
      const before = await skeleton.boundingBox();
      expect(before?.width).toBeGreaterThan(width === 1440 && view === 'settings' ? 1000 : width - 50);
      expect(before?.height).toBeGreaterThan(600);
      expect(await skeleton.isVisible()).toBe(false);
      expect(await page.getByRole('status').count()).toBe(0);
      await page.clock.runFor(149); expect(await skeleton.isVisible()).toBe(false);
      await page.clock.runFor(1); await skeleton.waitFor({state: 'visible'});
      expect(await page.getByRole('status').innerText()).toBe('Opening ' + view + '…');
      expect((await skeleton.boundingBox())?.width).toBe(before?.width);
      for (const selector of structure) expect(await skeleton.locator(selector).first().isVisible(), selector).toBe(true);
      expect(await skeleton.locator('input, textarea, button, [tabindex]').count()).toBe(0);
      const blocks = await skeleton.locator('.loading-skeleton').evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).display !== 'none').map(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return {animation: style.animationName, background: style.backgroundColor, width: box.width, height: box.height};
      }));
      expect(blocks.length).toBeGreaterThan(10);
      expect(blocks.filter(block => block.animation !== 'none' || block.background === 'rgba(0, 0, 0, 0)' || block.width <= 0 || block.height <= 0)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (view === 'workspace') {
        const narrative = await skeleton.locator('.loading-conversation').boundingBox(), composer = await skeleton.locator('.loading-composer').boundingBox();
        expect(narrative!.x).toBe(composer!.x); expect(narrative!.width).toBe(composer!.width);
      }
      if (view === 'review') {
        const files = await skeleton.locator('.cr-files').boundingBox(), diff = await skeleton.locator('.cr-diff').boundingBox(), context = await skeleton.locator('.cr-context').boundingBox();
        expect(diff!.x).toBeGreaterThan(files!.x + files!.width);
        if (width === 1440) expect(context!.x).toBeGreaterThan(diff!.x + diff!.width);
        else expect(context!.y).toBeGreaterThan(diff!.y + diff!.height);
      }
      await page.evaluate(() => (window as unknown as FixtureWindow).resolveLoad());
      const input = page.getByRole('textbox', {name: 'Retained draft'}); await input.waitFor();
      expect(await skeleton.count()).toBe(0); expect(await page.getByRole('status').count()).toBe(0);
      await input.focus(); await page.keyboard.press('ArrowLeft');
      await input.evaluate((node: HTMLInputElement) => {node.setSelectionRange(2, 7); (window as unknown as FixtureWindow).retained = node; (window as unknown as FixtureWindow).refresh();});
      await page.clock.runFor(150);
      expect(await skeleton.count()).toBe(0);
      expect(await input.inputValue()).toBe('Unsent edits');
      expect(await input.evaluate((node: HTMLInputElement) => node === (window as unknown as FixtureWindow).retained && document.activeElement === node && node.selectionStart === 2 && node.selectionEnd === 7)).toBe(true);
      await expect.poll(() => input.evaluate(node => ({width: getComputedStyle(node).outlineWidth, style: getComputedStyle(node).outlineStyle}))).toEqual({width: '2px', style: 'solid'});
      await page.evaluate(() => (window as unknown as FixtureWindow).finish());
      await page.getByRole('status').waitFor({state: 'detached'});
    } finally {await page.close();}
  });

  for (const view of Object.keys(views)) it(`${view} cancels fast-load feedback and stays static with default motion`, async () => {
    const page = await open(view, 1024, false);
    try {
      expect(await page.locator('.loading-skeleton').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
      await page.clock.runFor(100);
      await page.evaluate(() => (window as unknown as FixtureWindow).resolveLoad());
      await page.getByRole('textbox', {name: 'Retained draft'}).waitFor();
      await page.clock.runFor(150);
      expect(await page.locator('.loading-state-skeleton').count()).toBe(0);
      expect(await page.getByRole('status').count()).toBe(0);
    } finally {await page.close();}
  });
});
