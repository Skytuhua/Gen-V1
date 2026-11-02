/** Decode exported media, extract review frames, and exercise the standalone handoff. */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const folder = resolve(process.argv[2] ?? 'docs/evidence/frontend-review/delivery-20261030');
const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8'));
const run = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', error = '';
  const timeout = setTimeout(() => { child.kill(); reject(new Error(command + ' exceeded its verification deadline')); }, 180_000);
  child.stdout.on('data', value => { out += value; }); child.stderr.on('data', value => { error += value; });
  child.on('error', reject); child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve(out) : reject(new Error(error)); });
});
const captures = [...manifest.captures, ...(manifest.genuinePi?.captures ?? [])];
if (manifest.captures.length !== 9 || manifest.captures.some((capture: { failed?: boolean }) => capture.failed)) throw new Error('All nine successful demonstrations are required.');
const verification: Record<string, unknown> = { media: [], standalone: null, inspectedAt: new Date().toISOString() };
for (const capture of captures) {
  const path = join(folder, capture.file);
  const probe = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate:format=duration', '-of', 'json', path]));
  const stream = probe.streams[0];
  if (stream.codec_name !== 'h264' || stream.width !== 1920 || stream.height !== 1080 || stream.r_frame_rate !== '30/1') throw new Error('Unexpected encoding for ' + capture.file);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path, '-map', '0:v:0', '-f', 'null', '-']);
  (verification.media as unknown[]).push({ file: capture.file, probe, fullDecode: 'passed' });
  const chapters = capture.chapters as { title: string; startSeconds: number }[];
  const selector = ({ signing: 'Generate', 'pr-dark': 'Resolution', 'pr-light': 'Conflict', migration: 'Inspect all', context: 'Anchored', faq: 'A new question', map: 'Linked', catalog: 'Data & visuals', shell: 'Same artifact' } as Record<string, string>)[capture.scenario];
  if (selector) {
    const chapter = chapters.find(item => item.title.includes(selector));
    const seconds = typeof capture.comparisonSeconds === 'number' ? capture.comparisonSeconds : capture.scenario === 'faq' ? Number(probe.format.duration) - 1 : Math.min(Number(probe.format.duration) - 1, (chapter?.startSeconds ?? 3) + (capture.scenario === 'signing' ? 3 : 1.5));
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', path, '-frames:v', '1', '-update', '1', '-y', join(folder, `${capture.scenario}-result.png`)]);
  }
}
await writeFile(join(folder, 'media-verification.json'), JSON.stringify(verification, null, 2));
console.log('DECODED ' + captures.length + ' H.264 recordings');
// Run the index builder after result frames exist, then inspect the saved page.
await run(process.execPath, ['--import', 'tsx', 'scripts/build-review-index.ts', '--input', folder]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message)); await page.goto(pathToFileURL(join(folder, 'index.html')).href);
  const videos = page.locator('video'); await expect(videos).toHaveCount(captures.length);
  const playback = [];
  for (const video of await videos.all()) {
    await video.scrollIntoViewIfNeeded();
    const result = await video.evaluate(async node => {
      const video = node as HTMLVideoElement; video.muted = true;
      await Promise.race([video.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Video playback unavailable')), 8000))]);
      const before = video.currentTime;
      const started = performance.now();
      while (video.currentTime <= before + .1) { if (performance.now() - started > 6000) throw new Error('Video did not advance: ' + video.src); await new Promise(resolve => setTimeout(resolve, 50)); }
      video.pause();
      return { src: video.getAttribute('src'), duration: video.duration, width: video.videoWidth, height: video.videoHeight, advanced: video.currentTime > before };
    });
    if (!result.advanced || result.width !== 1920 || result.height !== 1080) throw new Error('Standalone playback failed: ' + JSON.stringify(result));
    playback.push(result);
  }
  const chapter = page.locator('button[data-start]').filter({ hasText: 'Live document' }).first(); await chapter.click();
  const requested = Number(await chapter.getAttribute('data-start'));
  const id = await chapter.getAttribute('data-video'); await expect.poll(() => page.locator(`#${id}`).evaluate(node => (node as HTMLVideoElement).currentTime)).toBeCloseTo(requested, 1);
  await page.screenshot({ path: join(folder, 'review-index-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(folder, 'review-index-narrow.png') });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Review index overflows a narrow window.');
  if (errors.length) throw new Error(errors.join('\n'));
  verification.standalone = { browser: 'Installed Chrome', playback, chapterSeeking: 'passed', narrowOverflow: false, pageErrors: errors };
  await writeFile(join(folder, 'media-verification.json'), JSON.stringify(verification, null, 2));
  console.log(`STANDALONE_PLAYBACK ${captures.length}/${captures.length}; chapter seeking; narrow layout passed`);
} finally { await browser.close(); }
