import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  aggregateStatus,blockedResult,buildManifest,childEnvironment,detectBrowserPrerequisite,
  redactSecrets,runCheck,windowsVerificationPlan,type CheckResult,type CheckSpec,
} from '../scripts/verify-readiness.ts';

// Negative-case contract for scripts/verify-readiness.ts (WO-F01 spec step 5).
// Every case runs a real child process or the real gating function; nothing is mocked.
// Reproduce any single case with: pnpm exec vitest run tests/readiness-manifest.test.ts -t '<case name>'

const temporaryRoots:string[]=[];
function temporaryDirectory():string{
  const directory=mkdtempSync(join(tmpdir(),'f01-readiness-'));
  temporaryRoots.push(directory);
  return directory;
}
afterEach(()=>{
  vi.unstubAllEnvs();
  for(const directory of temporaryRoots.splice(0))rmSync(directory,{recursive:true,force:true});
});

function specFor(directory:string,overrides:Partial<CheckSpec>={}):CheckSpec{
  return {
    id:'probe',command:process.execPath,args:['-e','process.exit(0)'],cwd:directory,
    timeoutMs:30_000,required:true,logPath:join(directory,'probe.log'),...overrides,
  };
}
const resultWith=(status:CheckResult['status'],required=true):CheckResult=>({
  ...blockedResult(specFor('/repo'),'probe'),status,required,
});

describe('runCheck child-process contract',()=>{
  it('zero exit yields PASS with timestamps, duration and a log artifact',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory));
    expect(result.status).toBe('PASS');
    expect(result.exitCode).toBe(0);
    expect(result.errorKind).toBeNull();
    expect(result.artifact).toBe(join(directory,'probe.log'));
    expect(existsSync(result.artifact)).toBe(true);
    expect(Number.isFinite(Date.parse(result.startedAt))).toBe(true);
    expect(Number.isFinite(Date.parse(result.endedAt))).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.command).toBe(process.execPath);
  });

  it('deliberately failing command yields FAIL with the actual exit code',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{args:['-e','process.exit(3)']}));
    expect(result.status).toBe('FAIL');
    expect(result.exitCode).toBe(3);
    expect(result.errorKind).toBe('nonzero-exit');
  });

  it('missing binary yields BLOCKED, never PASS',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{command:'f01-definitely-missing-binary'}));
    expect(result.status).toBe('BLOCKED');
    expect(result.errorKind).toBe('missing-binary');
    expect(result.exitCode).toBeNull();
  });

  it('timeout yields FAIL without hanging and kills the child',async()=>{
    const directory=temporaryDirectory();
    const started=Date.now();
    const result=await runCheck(specFor(directory,{
      args:['-e','setTimeout(()=>{},30_000)'],timeoutMs:400,
    }));
    expect(result.status).toBe('FAIL');
    expect(result.errorKind).toBe('timeout');
    expect(Date.now()-started).toBeLessThan(10_000);
    expect(result.durationMs).toBeLessThan(10_000);
  },15_000);

  it('bad cwd yields FAIL without spawning',async()=>{
    const directory=temporaryDirectory();
    const missing=join(directory,'no-such-cwd');
    const result=await runCheck(specFor(directory,{cwd:missing}));
    expect(result.status).toBe('FAIL');
    expect(result.errorKind).toBe('bad-cwd');
    expect(result.exitCode).toBeNull();
    expect(existsSync(result.artifact)).toBe(false);
  });

  it('child output is captured to the log artifact',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{args:['-e','console.log("f01-log-marker")']}));
    expect(result.status).toBe('PASS');
    expect(readFileSync(result.artifact,'utf8')).toContain('f01-log-marker');
  });
});

describe('prerequisite gating',()=>{
  it('omitted browser prerequisites yield BLOCKED without running the suite',()=>{
    const directory=temporaryDirectory();
    const missingExecutable=join(directory,'no-chromium-here');
    const prerequisite=detectBrowserPrerequisite(()=>missingExecutable,existsSync);
    expect(prerequisite.ok).toBe(false);
    expect(prerequisite.errorKind).toBe('missing-browser-prerequisite');
    const spec=specFor(directory,{id:'test:browser',command:'pnpm',args:['test:browser']});
    const result=blockedResult(spec,prerequisite.errorKind!);
    expect(result.status).toBe('BLOCKED');
    expect(result.exitCode).toBeNull();
    expect(existsSync(result.artifact)).toBe(false);
  });

  it('present browser executable passes the prerequisite gate',()=>{
    const prerequisite=detectBrowserPrerequisite(()=>process.execPath,existsSync);
    expect(prerequisite.ok).toBe(true);
    expect(prerequisite.errorKind).toBeNull();
  });

  it('packaged Windows verification is BLOCKED off Windows and records the exact Windows commands',()=>{
    const plan=windowsVerificationPlan('linux','0.6.5');
    expect(plan.blocked).toBe(true);
    expect(plan.errorKind).toBe('platform-unavailable');
    const serialized=JSON.stringify(plan.commands);
    expect(serialized).toContain('desktop:package');
    expect(serialized).toContain('verify-installed-desktop.ts');
    expect(serialized).toContain('Gen-V1-Setup-0.6.5-win-x64.exe');
    expect(serialized).toContain('win-unpacked');
    const directory=temporaryDirectory();
    const result=blockedResult(specFor(directory,{id:'windows-packaged-verification'}),plan.errorKind!);
    expect(result.status).toBe('BLOCKED');
  });

  it('packaged Windows verification is runnable on Windows x64',()=>{
    const plan=windowsVerificationPlan('win32','0.6.5');
    expect(plan.blocked).toBe(false);
    expect(plan.errorKind).toBeNull();
    expect(plan.commands.length).toBe(2);
  });
});

describe('aggregate and manifest',()=>{
  it('aggregate PASS requires every required check to have run and passed',()=>{
    expect(aggregateStatus([resultWith('PASS'),resultWith('PASS')])).toBe('PASS');
    expect(aggregateStatus([resultWith('PASS'),resultWith('SKIP')])).toBe('FAIL');
    expect(aggregateStatus([resultWith('PASS'),resultWith('BLOCKED')])).toBe('FAIL');
    expect(aggregateStatus([resultWith('PASS'),resultWith('FAIL')])).toBe('FAIL');
    expect(aggregateStatus([resultWith('PASS',false)])).toBe('FAIL');
    expect(aggregateStatus([])).toBe('FAIL');
    expect(aggregateStatus([resultWith('PASS'),resultWith('SKIP',false)])).toBe('PASS');
  });

  it('manifest is keyed by SHA, platform, command, timestamps, exitCode, errorKind and artifact',()=>{
    const directory=temporaryDirectory();
    const check=blockedResult(specFor(directory),'missing-binary');
    const manifest=buildManifest({
      repositorySha:'175e3fa03b453dde7d1c815d59df1f0554fbd626',platform:'linux-arm64',
      runId:'run-test',startedAt:'2026-11-14T11:00:00.000Z',endedAt:'2026-11-14T11:01:00.000Z',
      results:[check],
    });
    expect(manifest.repositorySha).toBe('175e3fa03b453dde7d1c815d59df1f0554fbd626');
    expect(manifest.platform).toBe('linux-arm64');
    expect(manifest.aggregate).toBe('FAIL');
    const entry=manifest.checks[0]!;
    expect(entry.repositorySha).toBe(manifest.repositorySha);
    expect(entry.platform).toBe(manifest.platform);
    for(const key of ['command','startedAt','endedAt','exitCode','errorKind','artifact'] as const)
      expect(entry,key).toHaveProperty(key);
  });

  it('no credentials or raw environment variables reach child processes, logs or the manifest',async()=>{
    vi.stubEnv('F01_CANARY_SECRET','canary-secret-9f8e7d');
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{
      args:['-e','console.log(process.env.F01_CANARY_SECRET ?? "canary-absent")'],
    }));
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('canary-absent');
    expect(log).not.toContain('canary-secret-9f8e7d');
    const manifest=buildManifest({
      repositorySha:'a'.repeat(40),platform:'linux-arm64',runId:'run-test',
      startedAt:result.startedAt,endedAt:result.endedAt,results:[result],
    });
    const serialized=JSON.stringify(manifest);
    expect(serialized).not.toContain('canary-secret-9f8e7d');
    // Commands are recorded verbatim, but no raw environment dump may appear.
    for(const entry of manifest.checks)expect(entry).not.toHaveProperty('env');
    expect(childEnvironment().F01_CANARY_SECRET).toBeUndefined();
  });

  it('redactSecrets removes bearer tokens, key/value secrets, URL passwords and private keys',()=>{
    expect(redactSecrets('Authorization: Bearer sk-live-abc123')).not.toContain('sk-live-abc123');
    expect(redactSecrets('api_key=supersecretvalue')).not.toContain('supersecretvalue');
    expect(redactSecrets('password: hunter2')).not.toContain('hunter2');
    expect(redactSecrets('postgres://user:dbpass@localhost/db')).not.toContain('dbpass');
    const key='-----BEGIN RSA PRIVATE KEY-----\nMIIEsecret\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(key)).not.toContain('MIIEsecret');
    expect(redactSecrets('plain readiness output')).toBe('plain readiness output');
  });

  it('log redaction survives secrets split across stream chunks',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{
      args:['-e','process.stdout.write("password: split-");setTimeout(()=>{process.stdout.write("secret-value\\n");},50)'],
    }));
    const log=readFileSync(result.artifact,'utf8');
    expect(log).not.toContain('split-secret-value');
    expect(log).toContain('[REDACTED]');
  });
});
