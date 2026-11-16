import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('returns a missing encoder error to the recording caller even if it stops later', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gen-record-no-encoder-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = directory;
  const source = new URL('../../scripts/review-capture.ts', import.meta.url).href;
  try {
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '--eval', `
      import { recordWindow } from ${JSON.stringify(source)};
      const calls = [];
      const session = {
        on() {},
        async send(method) { calls.push(method); },
        async detach() { calls.push('detach'); }
      };
      const page = {
        async bringToFront() {},
        context() { return { async newCDPSession() { return session; } }; },
        async screenshot() { return Buffer.from('fixture'); },
        async addInitScript() {},
        async evaluate() {}
      };
      try {
        const stop = await recordWindow(undefined, page, ${JSON.stringify(join(directory, 'fixture.mp4'))});
        // The caller is still driving its recording when the encoder fails.
        await new Promise(resolve => setTimeout(resolve, 100));
        await stop();
      } catch (error) {
        console.log(JSON.stringify({ code: error.code, message: error.message, calls }));
      }
    `], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)), env, encoding: 'utf8', timeout: 4500,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({
      code: 'ENOENT',
      message: expect.stringContaining('ffmpeg'),
      calls: ['Page.startScreencast', 'Page.stopScreencast', 'detach'],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
