import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {build} from 'esbuild';
import {chromium, type Browser, type Page} from '@playwright/test';

const fixture = `
import React, {useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useTableOverflow} from './apps/web/src/use-table-overflow';

function Fixture() {
  const ref = useRef<HTMLDivElement>(null);
  const overflowing = useTableOverflow(ref);
  const [wide, setWide] = useState(false);
  window.setWide = setWide;
  return <div ref={ref} data-overflowing={String(overflowing)} style={{width: '120px', height: '80px', overflow: 'auto'}}>
    {wide && <table style={{width: '400px'}}><tbody><tr><td>column</td></tr></tbody></table>}
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
`;

describe('useTableOverflow', () => {
  let browser: Browser, script: string;
  beforeAll(async () => {
    script = (await build({stdin: {contents: fixture, resolveDir: process.cwd(), loader: 'tsx'}, loader: {'.css': 'empty'}, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: {'process.env.NODE_ENV': '"production"'}})).outputFiles[0]!.text;
    browser = await chromium.launch({headless: true, ...(process.platform === 'win32' ? {channel: 'msedge'} : {})});
  });
  afterAll(async () => { await browser?.close(); });
  async function open(): Promise<Page> {
    const page = await browser.newPage();
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content: script});
    return page;
  }

  it('detects overflow when a wide table mounts after the container', async () => {
    const page = await open();
    const container = page.locator('[data-overflowing]');
    await expect.poll(() => container.getAttribute('data-overflowing')).toBe('false');
    // A table mounted after the effect never resized the observed container,
    // so the hook must re-attach to the late-arriving table.
    await page.evaluate('window.setWide(true)');
    await expect.poll(() => container.getAttribute('data-overflowing')).toBe('true');
    await page.evaluate('window.setWide(false)');
    await expect.poll(() => container.getAttribute('data-overflowing')).toBe('false');
    await page.close();
  });
});
