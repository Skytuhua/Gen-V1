import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { expect, it } from 'vitest';
import { CompanyClient } from '../packages/company-client/index.ts';

const serviceRoot = process.env.GEN_COMPANY_TEST_SERVICE_ROOT;
const fixtureScope = 'synthetic_temporary_company_store';
const fixtureToken = 'gen-company-integration-fixture-token-not-a-real-credential';

async function deadline<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Synthetic company fixture ${label} deadline exceeded`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function startFixture(root: string) {
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  if (!existsSync(python)) throw new Error('Opt-in company service repository requires its existing .venv interpreter; no dependencies will be installed.');
  const environment: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const child = spawn(python, ['-I', '-B', '-u', resolve(import.meta.dirname, 'fixtures/company-service-fixture.py'), root], {
    cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdin.on('error', () => { /* The owned child may already have exited during cleanup. */ });
  let outputBytes = 0;
  let outputLimit = false;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 16384) { outputLimit = true; child.kill(); }
    });
  }
  let startupError = false;
  child.once('error', () => { startupError = true; });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => {
    child.once('close', (code, signal) => accept({ code, signal }));
  });
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lines = reader[Symbol.asyncIterator]();
  async function reply(command?: 'inspect') {
    const next = lines.next();
    if (command) child.stdin.write(command + '\n');
    const line = await deadline(Promise.race([
      next,
      closed.then(() => { throw new Error('Synthetic company fixture exited before its control response'); }),
    ]), command ? 2000 : 8000, command ?? 'startup');
    if (startupError || outputLimit || line.done || Buffer.byteLength(line.value, 'utf8') > 4096) {
      throw new Error('Synthetic company fixture control response is unavailable or exceeds its bound');
    }
    return JSON.parse(line.value) as Record<string, unknown>;
  }
  async function stop() {
    try {
      if (child.exitCode === null && child.signalCode === null) child.stdin.end('stop\n');
      let result: Awaited<typeof closed>;
      try { result = await deadline(closed, 5000, 'shutdown'); }
      catch {
        child.kill('SIGKILL');
        await deadline(closed, 2000, 'owned process termination');
        throw new Error('Synthetic company fixture required forced termination');
      }
      if (startupError || outputLimit || result.code !== 0 || result.signal !== null) {
        throw new Error('Synthetic company fixture failed or exceeded its output bound');
      }
    } finally { reader.close(); }
  }
  try {
    const ready = await reply();
    if (Object.keys(ready).sort().join(',') !== 'fixture_scope,port' || ready.fixture_scope !== fixtureScope ||
        !Number.isInteger(ready.port) || Number(ready.port) < 1 || Number(ready.port) > 65535) {
      throw new Error('Synthetic company fixture startup metadata is invalid');
    }
    return { port: Number(ready.port), inspect: () => reply('inspect'), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

it.skipIf(!serviceRoot)('validates real Python LocalServer DTOs and read-only authorization using a temporary synthetic Store', async () => {
  const fixture = await startFixture(resolve(serviceRoot!));
  try {
    const before = await fixture.inspect();
    expect(before).toMatchObject({ fixture_scope: fixtureScope, counts: {
      projects: 2, approvals: 4, work_orders: 0, tasks: 0, attempts: 0, outbox: 0, owner_messages: 0,
    } });
    expect(before.business_digest).toMatch(/^[0-9a-f]{64}$/);
    const client = new CompanyClient({ origin: `http://127.0.0.1:${fixture.port}`, credential: () => fixtureToken, role: 'owner', timeoutMs: 2500 });
    const company = await client.status({ kind: 'company', id: 'leo-company' });
    expect(company.targets).toEqual({ employees: 32, departments: 16, hermes: 18, codex: 14 });
    expect(company.actual_live).toEqual({ employees: 0, hermes: 0, codex: 0 });
    expect(company.employees).toHaveLength(32);
    expect(company.employees.every(employee => employee.state === 'planned_unverified' && employee.effective_runtime === null)).toBe(true);
    expect(company.live_ready).toBe(false);
    expect(company.company_accepted).toBe(false);
    expect(company.projects.map(project => project.id)).toEqual(['alpha']);
    expect(company.auth.status).toBe('unavailable');
    const alpha = await client.status({ kind: 'project', id: 'alpha' });
    expect(alpha.project).toMatchObject({ id: 'alpha', name: 'Alpha', state: 'active', task_counts: {}, occupied_synthetic_slots: 0 });
    expect(alpha.projects.map(project => project.id)).toEqual(['alpha']);
    // COMPANY_FORBIDDEN is mapped from the actual service's HTTP 403 response.
    await expect(client.status({ kind: 'project', id: 'beta' })).rejects.toMatchObject({ code: 'COMPANY_FORBIDDEN' });
    expect(await client.status({ kind: 'company', id: 'leo-company' })).toEqual(company);
    expect(await fixture.inspect()).toEqual(before);
  } finally { await fixture.stop(); }
}, 30000);
