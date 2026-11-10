import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {expect, it} from 'vitest';
import {CompanyClient} from '../packages/company-client/index.ts';
import {buildCompanyServer} from '../apps/server/company-mode.ts';

const serviceRoot = process.env.GEN_COMPANY_TEST_SERVICE_ROOT;
const publicFixtureToken = 'maritime-synthetic-context-fixture-only';
// Ingress proof is separate from the unchanged aca8ec09 candidate-file pin.
const ingressCheckpoint = '99df4862dabe556fa83ee201b8e4c31a3a78d5dc';
const sourcePins = {
  'tools/company_context_fixture.py': '63674823a7c1e63a7ed5c45f659bb46708e6b99b1472e72bde4ba59608cd3fc5',
  'contracts/company-manager.v1.json': 'fb4e7d2eba19275c5d4013576a01d90984c9f716ce9f0d6e1d1b31a15d46a033',
  'contracts/company-manager.v1.samples.json': '9402e4279e3f0772d5c3eee22e9dddc4f495d4fb30e2506bf90a738070fff9bd',
};

async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Synthetic context fixture deadline exceeded')), milliseconds);
  })]);} finally {clearTimeout(timer);}
}

async function startFixture(root: string) {
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
  expect(git(['rev-parse', 'HEAD'])).toBe(ingressCheckpoint);
  expect(git(['status', '--porcelain', '--untracked-files=no'])).toBe('');
  for (const [path, hash] of Object.entries(sourcePins)) expect(createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')).toBe(hash);
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const script = resolve(root, 'tools/company_context_fixture.py');
  if (!existsSync(python) || !existsSync(script)) throw new Error('Opt-in context fixture requires the selected trusted source and existing locked interpreter.');
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key] !== undefined) environment[key] = process.env[key];
  const child = spawn(python, ['-I', '-B', '-u', script, '--seconds', '60'], {cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
  child.stdin.on('error', () => { /* Owned process may already have stopped. */ });
  let outputBytes = 0, exceeded = false, startupError = false;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
    outputBytes += chunk.length;
    if (outputBytes > 16384) {exceeded = true; child.kill();}
  });
  child.once('error', () => {startupError = true;});
  const closed = new Promise<{code: number | null; signal: NodeJS.Signals | null}>(accept => child.once('close', (code, signal) => accept({code, signal})));
  const reader = createInterface({input: child.stdout, crlfDelay: Infinity}), lines = reader[Symbol.asyncIterator]();
  async function readLine() {
    const line = await deadline(lines.next(), 8000);
    if (startupError || exceeded || line.done || Buffer.byteLength(line.value, 'utf8') > 4096) throw new Error('Synthetic context fixture response unavailable or oversized.');
    return JSON.parse(line.value) as Record<string, unknown>;
  }
  let stopping: Promise<void> | undefined;
  function stop(checkReceipt = true) {
    return stopping ??= (async () => {
      try {
        if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
        let result: Awaited<typeof closed>;
        try {result = await deadline(closed, 5000);} catch {
          child.kill('SIGKILL'); await deadline(closed, 2000);
          throw new Error('Synthetic context fixture required forced termination.');
        }
        if (startupError || exceeded || result.code !== 0 || result.signal !== null) throw new Error('Synthetic context fixture failed or exceeded its output bound.');
        if (checkReceipt) expect(await readLine()).toEqual({event: 'stopped', fixture_only: true, store_rows_unchanged: true, temporary_store_removed: true});
      } finally {reader.close();}
    })();
  }
  try {
    const ready = await readLine();
    expect(ready).toMatchObject({event: 'ready', fixture_only: true, bearer_token: publicFixtureToken, project_id: 'alpha', task_id: 'alpha-fixture-1', actual_live_employees: 0, contract_id: 'maritime-company-manager', contract_version: '1.0.0-candidate.1'});
    expect(ready.base_url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    return {origin: ready.base_url as string, stop};
  } catch (error) {await stop(false); throw error;}
}

// Actual authenticated HTTP against a disposable backend-owned synthetic Store.
// No operator registry/DB, native model, deployed transport or E01 activation.
it.skipIf(!serviceRoot)('conforms to authenticated owner context ingress without modifying synthetic Store rows', async () => {
  const fixture = await startFixture(resolve(serviceRoot!));
  let app: Awaited<ReturnType<typeof buildCompanyServer>> | undefined;
  try {
    const client = new CompanyClient({origin: fixture.origin, role: 'owner', credential: () => publicFixtureToken, timeoutMs: 2500});
    const tasks: string[] = [];
    let cursor: string | null = null, snapshot: string | undefined;
    for (let page = 0; page < 4; page++) {
      const value = await client.projectContext({project_id: 'alpha', limit: 1, cursor});
      expect(value.unavailable).toEqual(['mandate', 'knowledge', 'canonical_dossier']);
      expect(value.project.entity.id).toBe('alpha');
      expect(value.page.returned_count).toBe(1);
      if (snapshot === undefined) snapshot = value.page.snapshot_digest;
      expect(value.page.snapshot_digest).toBe(snapshot);
      tasks.push(...value.tasks.map(task => task.entity.id));
      cursor = value.page.next_cursor;
      if (cursor === null) {expect(value.page.boundary).toBe('end'); expect(value.page.truncated).toBe(false); break;}
      expect(value.page.truncated).toBe(true);
    }
    expect(cursor).toBeNull();
    expect(tasks).toEqual(['alpha-fixture-1', 'alpha-fixture-2', 'alpha-fixture-3']);
    expect(new Set(tasks).size).toBe(3);
    for (const section of ['dependencies', 'attempts'] as const) {
      const value = await client.taskContext({project_id: 'alpha', task_id: 'alpha-fixture-1', section, limit: 20, cursor: null});
      expect(value.task.entity.id).toBe('alpha-fixture-1');
      expect(value.section).toBe(section); expect(value.items).toEqual([]); expect(value.page.next_cursor).toBeNull();
    }
    await expect(client.projectContext({project_id: 'beta', limit: 1, cursor: null})).rejects.toMatchObject({code: 'COMPANY_FORBIDDEN'});
    await expect(client.taskContext({project_id: 'beta', task_id: 'beta-fixture-1', section: 'dependencies', limit: 20, cursor: null})).rejects.toMatchObject({code: 'COMPANY_FORBIDDEN'});
    await expect(client.taskContext({project_id: 'alpha', task_id: 'beta-fixture-1', section: 'dependencies', limit: 20, cursor: null})).rejects.toMatchObject({code: 'COMPANY_HTTP'});
    const unauthenticated = new CompanyClient({origin: fixture.origin, role: 'owner', credential: () => 'wrong-public-fixture-token', timeoutMs: 2500});
    await expect(unauthenticated.projectContext({project_id: 'alpha', limit: 1, cursor: null})).rejects.toMatchObject({code: 'COMPANY_AUTH'});
    await expect(client.projectContext({project_id: 'alpha', limit: 1, cursor: 'invalid-fixture-cursor'})).rejects.toMatchObject({code: 'COMPANY_SNAPSHOT_CHANGED', restartRequired: true});
    for (const section of ['artifacts', 'reviews'] as const) await expect(client.taskContext({project_id: 'alpha', task_id: 'alpha-fixture-1', section, limit: 20, cursor: null})).rejects.toMatchObject({code: 'COMPANY_HTTP'});
    const status = await client.status({kind: 'company', id: 'leo-company'});
    expect(status.targets).toEqual({employees: 32, departments: 16, hermes: 18, codex: 14});
    expect(status.actual_live).toEqual({employees: 0, hermes: 0, codex: 0});
    expect(status.projects.map(project => project.id)).toEqual(['alpha']);
    expect(status.live_ready).toBe(false); expect(status.company_accepted).toBe(false);
    app = await buildCompanyServer({port: 4319, contextReader: client});
    const bootstrap = await app.inject({url: '/api/bootstrap', headers: {host: '127.0.0.1:4319'}});
    const headers = {host: '127.0.0.1:4319', cookie: bootstrap.headers['set-cookie']!.toString().split(';')[0], 'x-harness-csrf': bootstrap.json().csrfToken};
    expect((await app.inject({url: '/api/company/context/availability', headers})).json()).toMatchObject({configured: true, ownerHostOnly: true, engineAccess: false});
    for (const [route, input] of [
      ['project', {project_id: 'alpha', limit: 1, cursor: null}],
      ['task', {project_id: 'alpha', task_id: 'alpha-fixture-1', section: 'dependencies', limit: 20, cursor: null}],
    ] as const) {
      const response = await app.inject({method: 'POST', url: `/api/company/context/${route}`, headers, payload: input});
      expect(response.statusCode).toBe(200);
      const value = response.json();
      expect(value).toMatchObject({source: 'company_service', contractId: 'maritime-company-manager', contractVersion: '1.0.0-candidate.1', backendCheckpoint: 'aca8ec09de5cda73b014a348a05a8f05b43f465b', manifestSHA256: sourcePins['contracts/company-manager.v1.json'], data: {project_id: 'alpha', page: {entity: {scope: {kind: 'project', id: 'alpha'}}}}});
      expect(Number.isFinite(Date.parse(value.receivedAt))).toBe(true);
      if (route === 'task') expect(value.data).toMatchObject({task_id: 'alpha-fixture-1', section: 'dependencies', task: {entity: {id: 'alpha-fixture-1'}}});
    }
  } finally {try {await app?.close();} finally {await fixture.stop();}}
}, 30000);
