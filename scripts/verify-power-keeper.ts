// T06 real-Windows verification for #1322 "Keep the PC awake during runs".
// Launches the real Electron app from dist/desktop-app against an isolated
// profile, seeds 'working' thread / 'backgroundWakeup' rows through a second
// Store on the same sqlite (same technique as scripts/verify-desktop.ts and
// tests/power-activity.test.ts), toggles the two preferences through the real
// /api/commands settings.update path, and watches DesktopState.power — the
// keeper publishes 'holding' only while powerSaveBlocker.isStarted() is true,
// i.e. an OS-level execution-state request is live.
//
// `powercfg /requests` requires elevation on this Windows build (recorded in
// the log) so the behavioral oracle is a suspend-gap check: while held, the
// standby timeout is shrunk to 1 minute and the script waits 75s; a real
// suspend would show up as a large wall-clock gap.
import {_electron, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Store} from '../packages/storage/store.ts';
import {verificationPorts} from './portable-verification.ts';
import type {Thread} from '../packages/contracts/index.ts';

const root = resolve('.');
const worktreeId = 't3-3d438bc2-ffec953133a523a0';
const directory = await mkdtemp(join(tmpdir(), 'gen-power-'));
const [hostPort, widgetPort] = await verificationPorts();
const shots = join(directory, 'shots');
const results: {step: string; pass: boolean; detail: string}[] = [];
const step = (name: string, pass: boolean, detail: string) => {
  results.push({step: name, pass, detail});
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail.replace(/\s+/g, ' ').slice(0, 400)}`);
};

function powercfg(args: string[]): string {
  try { return execFileSync('powercfg', args, {encoding: 'utf8', windowsHide: true}); }
  catch (error) {
    const e = error as {status?: number; stdout?: Buffer | string; stderr?: Buffer | string; message?: string};
    const out = [e.stdout, e.stderr, e.message].filter(Boolean).join(' ');
    return 'POWERCFG-FAILED rc=' + e.status + ': ' + out.replace(/\s+/g, ' ').slice(0, 300);
  }
}
const requestsProbe = powercfg(['-requests']); // elevation check, recorded once
console.log('powercfg -requests probe =>', requestsProbe.trim().slice(0, 200));

type Power = {state?: string; reason?: string} | null;
async function powerState(page: Page): Promise<Power> {
  try { return ((await page.evaluate(() => window.harnessDesktop!.getContext())) as {power?: Power}).power ?? null; }
  catch { return null; }
}
async function waitPower(page: Page, want: string | string[], budgetMs: number): Promise<{met: boolean; got: Power; ms: number}> {
  const wants = Array.isArray(want) ? want : [want];
  const start = Date.now();
  let got: Power = null;
  while (Date.now() - start < budgetMs) {
    got = await powerState(page);
    if (got?.state && wants.includes(got.state)) return {met: true, got, ms: Date.now() - start};
    await new Promise(done => setTimeout(done, 500));
  }
  return {met: false, got, ms: Date.now() - start};
}
/** Sleep for ms; returns actual elapsed (a suspend of this box would inflate it). */
async function wake(ms: number): Promise<number> {
  const start = Date.now();
  await new Promise(done => setTimeout(done, ms));
  return Date.now() - start;
}

const origin = `http://127.0.0.1:${hostPort}`;
let cookie = '', csrf = '', launchToken = '';
async function bootstrap() {
  const deadline = Date.now() + 60000;
  const headers = launchToken ? {'x-harness-launch': launchToken} : undefined;
  for (;;) {
    try {
      const response = await fetch(origin + '/api/bootstrap', {headers});
      if (response.ok) {
        cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
        csrf = ((await response.json()) as {csrfToken: string}).csrfToken;
        return;
      }
    } catch {}
    if (Date.now() > deadline) throw new Error('bootstrap did not come up on ' + origin);
    await new Promise(done => setTimeout(done, 1000));
  }
}
async function command(type: string, payload: Record<string, unknown>, threadId?: string): Promise<any> {
  const response = await fetch(origin + '/api/commands', {
    method: 'POST',
    headers: {'content-type': 'application/json', cookie, 'x-harness-csrf': csrf},
    body: JSON.stringify({id: randomUUID(), type, payload, ...(threadId ? {threadId} : {})}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`command ${type} -> ${response.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const setPrefs = (preferences: Record<string, boolean>) => command('settings.update', {preferences});

const env = Object.fromEntries(Object.entries({
  ...process.env,
  HARNESS_DESKTOP_TEST_DATA_DIR: directory,
  HARNESS_DESKTOP_NODE_PATH: process.execPath,
  HARNESS_DESKTOP_HOST_ROOT: root,
  HARNESS_PLUGIN_DIR: join(directory, 'plugins'),
  HARNESS_DESKTOP_PORT: String(hostPort),
  HARNESS_DESKTOP_WIDGET_PORT: String(widgetPort),
}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;

const standbyQuery = powercfg(['-Q', 'SCHEME_CURRENT', '238c9fa8-0aad-41ed-83f4-97be242c8f20', '29f6c1db-86da-48c5-9fdb-f2b67b1f4985']);
const standbyMatch = /Current AC Power Setting Index: 0x([0-9a-fA-F]+)/.exec(standbyQuery);
const originalStandbyMinutes = standbyMatch ? Math.max(1, Math.round(parseInt(standbyMatch[1], 16) / 60)) : 0;
console.log('standby query =>', standbyQuery.replace(/\s+/g, ' ').trim().slice(0, 160));
console.log('original standby-timeout-ac =', originalStandbyMinutes, 'min');
powercfg(['-X', 'standby-timeout-ac', '0']); // never idle-sleep during the session itself

let app: ElectronApplication | undefined;
let appPid: number | undefined;
try {
  app = await _electron.launch({args: [resolve('dist/desktop-app/main.mjs')], env, timeout: 60000, recordVideo: {dir: join(directory, 'video'), size: {width: 1600, height: 1000}}});
  appPid = app.process()?.pid;
  await expect.poll(() => app!.windows().some(page => page.url().startsWith(origin + '/')), {timeout: 90000}).toBe(true);
  const main = app.windows().find(page => page.url().startsWith(origin + '/'))!;
  await main.waitForLoadState('domcontentloaded');
  launchToken = new URLSearchParams(new URL(main.url()).hash.slice(1)).get('launch') ?? '';
  await new Promise(done => setTimeout(done, 3000));
  await bootstrap();

  const hostDir = join(directory, 'host');
  const put = (kind: string, id: string, body: unknown) => {
    const store = new Store(hostDir);
    try { store.internal('power.fixture', null, () => store.put(kind, id, null, body)); } finally { store.close(); }
  };
  const get = (kind: string, id: string) => {
    const store = new Store(hostDir);
    try { return store.get<Record<string, unknown>>(kind, id); } finally { store.close(); }
  };
  const nudge = () => command('thread.create', {title: 'Power fixture nudge'});

  // --- (a) both switches OFF + working thread -> no hold --------------------
  const thread = (await command('thread.create', {title: 'Power fixture task'})).result as Thread;
  const setThread = (patch: Record<string, unknown>) => put('thread', thread.id, {...get('thread', thread.id), ...patch});
  setThread({status: 'working', runId: 'power-fixture-run'});
  await nudge();
  {
    const w = await waitPower(main, 'idle', 20000);
    step('a: switches off + working thread -> idle (no hold)', w.met, `power=${JSON.stringify(w.got)} after ${w.ms}ms`);
  }

  // --- (b) tasks switch ON -> holding ---------------------------------------
  await setPrefs({keepAwakeTasks: true});
  {
    const w = await waitPower(main, 'holding', 20000);
    step('b: keepAwakeTasks on + working thread -> holding', w.met, `power=${JSON.stringify(w.got)} in ${w.ms}ms`);
  }

  // Past-timeout proof: 1-min standby while the request is held, then wait 75s.
  powercfg(['-X', 'standby-timeout-ac', '1']);
  const gap = await wake(75_000);
  {
    const w = await waitPower(main, 'holding', 2000);
    step('b+: 75s elapsed with 1-min standby, no suspend gap, still holding',
      gap < 90_000 && w.met, `elapsed=${gap}ms (suspend would inflate); power=${JSON.stringify(w.got)}`);
  }
  powercfg(['-X', 'standby-timeout-ac', '0']);

  // --- (c) task completes -> released within 35s -----------------------------
  setThread({status: 'completed', runId: null});
  await nudge();
  {
    const w = await waitPower(main, 'off', 35000);
    step('c: task completed -> released', w.met, `power=${JSON.stringify(w.got)} in ${w.ms}ms`);
  }

  // --- (d) stop-path: live work cleared -> released ---------------------------
  setThread({status: 'working', runId: 'power-fixture-run-2'});
  await nudge();
  { const w = await waitPower(main, 'holding', 20000); step('d-1: re-held for stop check', w.met, `in ${w.ms}ms`); }
  setThread({status: 'ready', runId: null});
  await nudge();
  {
    const w = await waitPower(main, 'off', 35000);
    step('d: live work stopped -> released (tray stopAll shares this release path)', w.met, `in ${w.ms}ms`);
  }

  // --- (g) armed schedule held, paused -> released ----------------------------
  put('backgroundWakeup', 'power-fixture-wakeup', {
    wakeupId: 'power-fixture-wakeup', taskId: 'power-fixture-schedule', state: 'PENDING', paused: false,
    nextDueAtMs: Date.now() + 60000, trigger: {kind: 'AT_UTC', dueAtMs: Date.now() + 60000},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    claimGeneration: 0, leaseExpiresAtMs: null, lastProcessedDueAtMs: null, skippedTotal: 0,
  });
  await setPrefs({keepAwakeSchedules: true});
  await nudge();
  {
    const w = await waitPower(main, 'holding', 20000);
    step('g-1: armed schedule + keepAwakeSchedules -> holding', w.met, `power=${JSON.stringify(w.got)} in ${w.ms}ms`);
  }
  put('backgroundWakeup', 'power-fixture-wakeup', {...(get('backgroundWakeup', 'power-fixture-wakeup')!), paused: true});
  await nudge();
  {
    const w = await waitPower(main, 'off', 35000);
    step('g-2: schedule paused -> released', w.met, `power=${JSON.stringify(w.got)} in ${w.ms}ms`);
  }

  // --- (f) kill the backend -> released ---------------------------------------
  setThread({status: 'working', runId: 'power-fixture-run-3'});
  await setPrefs({keepAwakeSchedules: false});
  await nudge();
  { const w = await waitPower(main, 'holding', 20000); step('f-1: re-held before backend kill', w.met, `in ${w.ms}ms`); }
  try {
    const backendPid = execFileSync('powershell', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process | Where-Object {$_.CommandLine -match 'apps[\\\\/]server[\\\\/]main\\.ts' -and $_.CommandLine -match '${worktreeId}' -and $_.Name -match 'node'} | Select-Object -First 1 -ExpandProperty ProcessId)`],
      {encoding: 'utf8'}).trim();
    if (!backendPid) throw new Error('backend pid not found');
    execFileSync('taskkill', ['/PID', backendPid, '/F'], {stdio: 'ignore'});
    const w = await waitPower(main, ['off', 'unavailable'], 35000);
    step('f: backend killed -> released (state leaves holding)', w.met, `power=${JSON.stringify(w.got)} after ${w.ms}ms; killed pid ${backendPid}`);
  } catch (error) {
    step('f: backend killed -> released (state leaves holding)', false, String(error).slice(0, 300));
  }

  // The desktop auto-restarts the backend (~700ms + boot). On boot
  // service.recover() sweeps the dead run's thread to 'interrupted', so the
  // correct post-restart state is 'off' — a stale OS hold must NOT survive.
  await bootstrap();
  {
    const start = Date.now();
    let stale = false;
    while (Date.now() - start < 10000) {
      if ((await powerState(main))?.state === 'holding') { stale = true; break; }
      await new Promise(done => setTimeout(done, 500));
    }
    const got = await powerState(main);
    step('f+: backend restart -> dead run swept, no stale hold (state=' + (got?.state ?? '?') + ')', !stale && got?.state === 'off', `power=${JSON.stringify(got)} sampled 10s after reconnect`);
  }
  await main.reload({timeout: 30000}).catch(() => {});
  await new Promise(done => setTimeout(done, 4000));

  // --- screenshots for T07: holding + idle states, dark + light ---------------
  const shot = async (name: string) => {
    await new Promise(done => setTimeout(done, 900));
    await main.screenshot({path: join(shots, name)});
  };
  const openAwakeRows = async () => {
    const dialog = main.getByRole('dialog', {name: 'Settings'});
    await dialog.getByRole('searchbox', {name: 'Search all settings'}).fill('awake');
    await new Promise(done => setTimeout(done, 400));
    // Clicking the schedules result reveals the full General row incl. the
    // live power-status line (it renders under 'Keep the PC awake for
    // schedules').
    await dialog.getByText('Keep the PC awake for schedules').first().click();
    await new Promise(done => setTimeout(done, 800));
  };
  try {
    // Re-arm live work: the dead run was swept to 'interrupted' on restart.
    setThread({status: 'working'});
    await nudge();
    {
      const w = await waitPower(main, 'holding', 20000);
      step('shots-setup: holding state for capture', w.met, `power=${JSON.stringify(w.got)}`);
    }
    await main.getByRole('button', {name: 'Settings', exact: true}).click({timeout: 30000});
    await openAwakeRows();
    await shot('settings-power-holding-dark.png');
    await command('settings.update', {theme: 'light'});
    await shot('settings-power-holding-light.png');
    await command('settings.update', {theme: 'dark'});
    // Reduced-motion check: the holding pulse must be disabled under
    // prefers-reduced-motion (settings.css @media rule).
    await main.emulateMedia({reducedMotion: 'reduce'});
    {
      const animation = await main.evaluate(() => getComputedStyle(document.querySelector('.settings-power-dot')!).animationName);
      step('shots: reduced-motion disables holding pulse', animation === 'none', `animationName=${animation}`);
    }
    await main.emulateMedia({reducedMotion: 'no-preference'});
    // Idle state: task still working but both switches off.
    await command('settings.update', {preferences: {keepAwakeTasks: false}});
    {
      const w = await waitPower(main, 'idle', 20000);
      step('shots-setup: idle state for capture', w.met, `power=${JSON.stringify(w.got)}`);
    }
    await shot('settings-power-idle-dark.png');
    await command('settings.update', {theme: 'light'});
    await shot('settings-power-idle-light.png');
    await command('settings.update', {theme: 'dark'});
    // Re-arm the hold for the (e) quit-while-holding check.
    await command('settings.update', {preferences: {keepAwakeTasks: true}});
    step('shots: power status captured (holding+idle, dark+light)', true, shots);
  } catch (error) {
    step('shots: power status captured (holding+idle, dark+light)', false, String(error).slice(0, 300));
    try { await command('settings.update', {theme: 'dark', preferences: {keepAwakeTasks: true}}); } catch {}
  }

  // --- (e) quit while holding -> released --------------------------------------
  setThread({status: 'working', runId: 'power-fixture-run-4'});
  await nudge();
  const w1 = await waitPower(main, 'holding', 20000);
  const pid = app.process()?.pid ?? appPid;
  await app.close().catch(() => {});
  const gone = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      try { process.kill(pid!, 0); await new Promise(d => setTimeout(d, 500)); }
      catch { return true; }
    }
    return false;
  })();
  step('e: quit while holding -> process exited, OS request released', w1.met && gone, `held=${w1.met} in ${w1.ms}ms; exited=${gone} (process death clears ES state)`);
  app = undefined;
} catch (error) {
  step('run: unhandled verification error', false, String(error instanceof Error ? error.stack ?? error : error).slice(0, 500));
} finally {
  powercfg(['-X', 'standby-timeout-ac', String(originalStandbyMinutes)]);
  if (app) {
    let childPid: number | undefined;
    try { childPid = app.process()?.pid; } catch {}
    await Promise.race([
      app.close().catch(() => {}),
      new Promise<void>(accept => setTimeout(() => {
        try { if (childPid) execFileSync('taskkill', ['/PID', String(childPid), '/T', '/F'], {stdio: 'ignore'}); } catch {}
        accept();
      }, 8000)),
    ]);
  }
  await writeFile(join(directory, 'power-verification.json'), JSON.stringify({directory, hostPort, requestsProbe, results}, null, 2));
  console.log(JSON.stringify({directory, results}));
}
