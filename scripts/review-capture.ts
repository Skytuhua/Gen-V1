import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type BrowserServer, type Browser, type BrowserContext, type Page } from '@playwright/test';

export type CaptureTheme = 'dark' | 'light';
export function captureTheme(value?: string): CaptureTheme {
  if (value !== undefined && value !== 'dark' && value !== 'light') throw new Error('Capture theme must be dark or light.');
  return value ?? 'dark';
}

// Audit every navigation and root-theme change, including transient switches.
// An end-frame assertion alone would miss a light flash in a dark recording.
export async function installThemeAudit(page: Page, expected: CaptureTheme) {
  type Record = {theme: string; url: string; at: number};
  let records: Record[] = [];
  await page.exposeBinding('__reviewThemeAudit', (_source, record: Record) => { records.push(record); });
  const source = `(() => {
    let previous;
    const report = () => {
      const theme = document.documentElement?.dataset.theme;
      if ((theme === 'dark' || theme === 'light') && theme !== previous) {
        previous = theme;
        window.__reviewThemeAudit({theme, url: location.href, at: performance.now()});
      }
    };
    new MutationObserver(report).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-theme']});
    report();
  })();`;
  await page.addInitScript({content: source});
  return {
    reset() { records = []; },
    records() { return records.map(record => ({...record})); },
    async assert() {
      const current = await page.evaluate(() => document.documentElement.dataset.theme);
      // Flush the browser-to-Node binding queue before examining its history.
      await page.evaluate(() => (window as unknown as {__reviewThemeAudit:(record: Record)=>Promise<void>}).__reviewThemeAudit({theme: document.documentElement.dataset.theme ?? '', url: location.href, at: performance.now()}));
      if (current !== expected || records.some(record => record.theme !== expected)) throw new Error(`Expected only ${expected} UI throughout capture: ${JSON.stringify(records)}`);
    },
  };
}

export async function openCaptureBrowser() {
  const server = await chromium.launchServer({ headless: true, args: ['--force-device-scale-factor=1', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'] });
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  return { server, browser, context, page };
}
function run(executable: string, args: string[], stdin?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `${executable} failed (${code})`)));
    child.stdin.end(stdin);
  });
}
export async function recordWindow(_server: BrowserServer, page: Page, filename: string) {
  await page.bringToFront();
  // Capture this page's compositor only. GDI returned black surfaces in this
  // Windows session, and desktop-wide capture could expose unrelated windows.
  const session = await page.context().newCDPSession(page);
  let latest = await page.screenshot({ type: 'jpeg', quality: 92 }), sourceFrames = 0, writtenFrames = 0;
  const timestamps: number[] = [];
  function installCursor() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', installCursor, { once: true }); return; }
    if (document.getElementById('review-capture-cursor')) return;
    const cursor = document.createElement('div'); cursor.id = 'review-capture-cursor';
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:15px;height:21px;background:white;clip-path:polygon(0 0,0 90%,26% 68%,48% 100%,66% 90%,44% 59%,80% 59%);filter:drop-shadow(0 0 1px black);pointer-events:none;z-index:2147483647;transform:translate(-30px,-30px)';
    document.body.append(cursor); document.addEventListener('mousemove', event => { cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`; });
  }
  await page.addInitScript(installCursor); await page.evaluate(installCursor);
  session.on('Page.screencastFrame', event => {
    latest = Buffer.from(event.data, 'base64'); sourceFrames++; timestamps.push(event.metadata.timestamp ?? 0);
    void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const capture: ChildProcess = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', '30', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-n', filename], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  let errors = ''; capture.stderr?.on('data', bytes => { errors += bytes; });
  const complete = new Promise<void>((resolve, reject) => { capture.on('error', reject); capture.on('exit', code => code === 0 ? resolve() : reject(new Error(`Capture failed: ${errors}`))); });
  const started = performance.now(), startedWallTimeMilliseconds = Date.now();
  const sample = () => {
    const expected = Math.floor((performance.now() - started) * 30 / 1000);
    while (writtenFrames < expected && capture.stdin?.writable) { capture.stdin.write(latest); writtenFrames++; }
  };
  const timer = setInterval(sample, 1000 / 30);
  let stopping: Promise<Record<string, unknown>> | undefined;
  return () => stopping ??= (async () => {
    clearInterval(timer); sample(); const elapsedSeconds = (performance.now() - started) / 1000;
    await session.send('Page.stopScreencast'); await session.detach(); capture.stdin?.end(); await complete;
    const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate:format=duration,size', '-of', 'json', filename]));
    return { ...probe, capture: { method: 'Chromium compositor JPEG frames sampled against wall time at 30fps; unchanged or delayed frames held; no interpolation', sourceFrames, writtenFrames, elapsedSeconds, startedWallTimeMilliseconds, firstTimestamp: timestamps[0], lastTimestamp: timestamps.at(-1) } };
  })();
}
export async function closeCapture(value: { context: BrowserContext; browser: Browser; server: BrowserServer }) {
  await value.context.close(); await value.browser.close(); await value.server.close();
}
