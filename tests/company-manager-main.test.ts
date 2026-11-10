import {afterEach, expect, it} from 'vitest';
import {fork, type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {for (const close of cleanup.splice(0).reverse()) await close();});

async function freePort() {
  const server = createServer();
  await new Promise<void>((accept, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', accept);});
  const port = (server.address() as {port: number}).port;
  await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  return port;
}

function nextMessage(child: ChildProcess, type: string) {
  return new Promise<Record<string, unknown>>((accept, reject) => {
    const timer = setTimeout(() => {clear(); reject(Error('Company child IPC timed out: ' + type));}, 15000);
    const message = (value: unknown) => {
      if (value && typeof value === 'object' && (value as {type?: string}).type === type) {clear(); accept(value as Record<string, unknown>);}
    };
    const exit = (code: number | null) => {clear(); reject(Error('Company child exited before ' + type + ': ' + code));};
    const error = (error: Error) => {clear(); reject(error);};
    const clear = () => {clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', error);};
    child.on('message', message); child.once('exit', exit); child.once('error', error);
  });
}

it('runs the actual manager entry without authority and reopens its profile after IPC shutdown and disconnect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gen-manager-entry-'));
  cleanup.push(() => rm(directory, {recursive: true, force: true, maxRetries: 5, retryDelay: 100}));
  for (const stop of ['shutdown', 'disconnect']) {
    const token = randomBytes(32).toString('hex'), port = await freePort(), origin = `http://127.0.0.1:${port}`;
    // Pass only OS bootstrap variables. No service/account/credential settings.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['SystemRoot', 'windir', 'ComSpec', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) if (process.env[key] !== undefined) env[key] = process.env[key];
    Object.assign(env, {HARNESS_COMPANY_DATA_DIR: directory, HARNESS_COMPANY_PORT: String(port), HARNESS_DESKTOP_LAUNCH_TOKEN: token,
      GEN_COMPANY_MANAGER_ENABLED: 'true', GEN_COMPANY_MANAGER_PERMIT: '{"approved":true}'});
    const launchOptions = {
      execArgv: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href],
      cwd: resolve('.'), env, silent: true, windowsHide: true,
    };
    const child = fork(resolve('apps/server/company-manager-main.ts'), [], launchOptions);
    child.stdout!.resume(); let stderr = ''; child.stderr!.on('data', part => {stderr += part;});
    const exited = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => child.once('exit', (code, signal) => accept({code, signal})));
    cleanup.push(async () => {if (child.exitCode === null && child.signalCode === null) child.kill(); await exited;});
    expect(await nextMessage(child, 'harness.ready')).toEqual({type: 'harness.ready', token, origin, pid: child.pid});
    const bootstrap = await fetch(origin + '/api/bootstrap', {signal: AbortSignal.timeout(5000)});
    const csrf = (await bootstrap.json()).csrfToken as string;
    const headers = {cookie: bootstrap.headers.get('set-cookie')!.split(';')[0], 'x-harness-csrf': csrf, 'Content-Type': 'application/json'};
    expect((await fetch(origin + '/api/company/manager/availability', {signal: AbortSignal.timeout(5000)})).status).toBe(401);
    expect(await fetch(origin + '/api/company/manager/availability', {headers, signal: AbortSignal.timeout(5000)}).then(response => response.json())).toMatchObject({configured: false, dispatchAuthorized: false});
    const proposal = await fetch(origin + '/api/company/manager/propose', {method: 'POST', headers,
      body: JSON.stringify({requestId: 'entry-check', projectId: 'alpha', instruction: 'Unavailable without real admission.'}), signal: AbortSignal.timeout(5000)});
    expect(proposal.status).toBe(503);
    for (const name of ['manager-ui', 'manager-runtime', 'manager-home']) expect(await readdir(directory)).not.toContain(name);
    if (stop === 'shutdown') {
      const stopped = nextMessage(child, 'harness.stopped'); child.send({type: 'harness.shutdown', token});
      expect(await stopped).toEqual({type: 'harness.stopped', token});
    } else child.disconnect();
    expect(await exited).toEqual({code: 0, signal: null});
    await expect(fetch(origin + '/api/bootstrap', {signal: AbortSignal.timeout(2000)})).rejects.toThrow();
    expect(stderr).not.toContain('could not');
  }
}, 40000);
