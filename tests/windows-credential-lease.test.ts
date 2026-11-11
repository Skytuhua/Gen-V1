import { closeSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir, userInfo } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLiteralCredentialLease } from '../packages/runtime-pi/credentials.ts';

const directories: string[] = [];
const oauth = {type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: 123456789};
function fixture(content = JSON.stringify({openai: oauth})) {
  const root = mkdtempSync(join(tmpdir(), 'gen-credential-lease-')); directories.push(root);
  const parent = join(root, 'profile'); mkdirSync(parent);
  const authPath = join(parent, 'auth.json'); writeFileSync(authPath, content);
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/icacls.exe'), [authPath, '/inheritance:r', '/grant:r', `${userInfo().username}:(F)`, '*S-1-5-18:(F)', '*S-1-5-32-544:(F)'], {windowsHide: true, stdio: 'pipe'});
  return {root, parent, authPath};
}
const acquire = (path: string, signal = new AbortController().signal, maxHoldMs = 5000) => acquireLiteralCredentialLease(path, {signal, maxHoldMs});
afterEach(() => {for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});});

describe.skipIf(process.platform !== 'win32')('Windows native credential custody in the SDK process', () => {
  it('reads literal OAuth while the kernel denies modification, replacement, deletion and ancestor rename until explicit release', async () => {
    const {authPath, parent} = fixture(), original = readFileSync(authPath);
    const lease = await acquire(authPath);
    try {
      expect(lease.read('openai')).toEqual(oauth);
      expect(() => writeFileSync(authPath, 'changed')).toThrow();
      expect(() => unlinkSync(authPath)).toThrow();
      expect(() => renameSync(authPath, authPath + '.moved')).toThrow();
      expect(() => renameSync(parent, parent + '.moved')).toThrow();
      const replacement = authPath + '.replacement'; writeFileSync(replacement, 'replacement');
      expect(() => renameSync(replacement, authPath)).toThrow();
      expect(readFileSync(authPath)).toEqual(original);
    } finally {await lease.release();}
    await lease.settled;
    expect(() => lease.read('openai')).toThrow();
    writeFileSync(authPath, 'after release');
  });
  it('refuses an already open writer and acquires only after that writer closes', async () => {
    const {authPath} = fixture(), writer = openSync(authPath, 'r+');
    try {await expect(acquire(authPath)).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});}
    finally {closeSync(writer);}
    const lease = await acquire(authPath); await lease.release();
  });
  it('refuses a pre-existing writable mapping after its originating file stream closes', async () => {
    const {authPath} = fixture();
    const mapper = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./fixtures/windows-credential-mapping.ps1', import.meta.url)), authPath], {windowsHide: true, stdio: 'pipe'});
    const closed = new Promise<void>((done, fail) => {mapper.once('error', fail); mapper.once('close', code => code === 0 ? done() : fail(Error('Synthetic mapping helper failed.')));});
    void closed.catch(() => {});
    try {
      await new Promise<void>((done, fail) => {let data = ''; mapper.stdout.on('data', bytes => {data += bytes; if (data.includes('mapped')) done();}); mapper.once('error', fail); mapper.once('exit', () => fail(Error('Synthetic mapping ended before acquisition.')));});
      await expect(acquire(authPath)).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    } finally {mapper.stdin.end('\n'); await closed;}
    const lease = await acquire(authPath); await lease.release();
  });
  it.each(['abort', 'expiry'])('revokes authority on %s while retaining the kernel fence until release', async reason => {
    const {authPath} = fixture(), cancel = new AbortController();
    const lease = await acquire(authPath, cancel.signal, reason === 'expiry' ? 150 : 5000);
    try {
      if (reason === 'abort') cancel.abort();
      else await new Promise<void>(done => lease.signal.addEventListener('abort', () => done(), {once: true}));
      expect(lease.signal.aborted).toBe(true);
      expect(() => lease.assertCurrent()).toThrow();
      expect(() => writeFileSync(authPath, 'changed')).toThrow();
    } finally {await lease.release();}
    writeFileSync(authPath, 'after release');
  });
  it('rejects hard links and invalid literal data without retaining a failed acquisition', async () => {
    const {authPath} = fixture(), alias = authPath + '.hardlink'; linkSync(authPath, alias);
    await expect(acquire(authPath)).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    unlinkSync(alias); writeFileSync(authPath, '{invalid-synthetic-secret');
    await expect(acquire(authPath)).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    writeFileSync(authPath, '{}');
  });
  it('rejects writable ACLs and directory reparse aliases', async () => {
    const {authPath, parent, root} = fixture();
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/icacls.exe'), [authPath, '/grant', '*S-1-1-0:(R)'], {windowsHide: true, stdio: 'pipe'});
    await expect(acquire(authPath)).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/icacls.exe'), [authPath, '/remove:g', '*S-1-1-0'], {windowsHide: true, stdio: 'pipe'});
    const alias = join(root, 'alias'); symlinkSync(parent, alias, 'junction');
    await expect(acquire(join(alias, 'auth.json'))).rejects.toMatchObject({code: 'PI_CREDENTIAL_LEASE_UNAVAILABLE'});
    const lease = await acquire(authPath); await lease.release();
  });
  it('refuses forged native receivers and retains a dropped native wrapper until process exit', () => {
    const {authPath} = fixture();
    const addonPath = new URL('../packages/core/windows-credential-lease.node', import.meta.url);
    const native = createRequire(import.meta.url)(fileURLToPath(addonPath)) as {acquire(path: string): {read(): Buffer; release(): void}};
    const held = native.acquire(authPath);
    try {expect(() => held.read.call({})).toThrow(); expect(() => held.release.call({})).toThrow();}
    finally {held.release();}
    execFileSync(process.execPath, ['--expose-gc', '-e', 'const fs=require("node:fs"),addon=require(process.argv[1]);let lease=addon.acquire(process.argv[2]);lease=null;global.gc();setImmediate(()=>{try{fs.writeFileSync(process.argv[2],"changed");process.exitCode=1}catch{}})', fileURLToPath(addonPath), authPath], {windowsHide: true, stdio: 'pipe'});
    writeFileSync(authPath, '{}');
  });
});
