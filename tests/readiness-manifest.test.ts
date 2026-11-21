import {afterEach,describe,expect,it,vi} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reserveDesktopRelease} from '../scripts/desktop-assets.ts';
import {
  aggregateStatus,blockedResult,buildManifest,childEnvironment,detectBrowserPrerequisite,
  redactSecrets,runCheck,readinessPackageChecks,windowsVerificationPlan,type CheckResult,type CheckSpec,
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

  it('records a synchronous spawn rejection as a failed check and closes its log', async () => {
    const directory = temporaryDirectory();
    const spec = specFor(directory, {command: ''});
    await expect(runCheck(spec)).resolves.toMatchObject({status: 'FAIL', errorKind: 'spawn-error', exitCode: null});
    expect(readFileSync(spec.logPath, 'utf8')).toBe('');
    await expect(runCheck(specFor(directory))).resolves.toMatchObject({status: 'PASS'});
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

  it('returns a failed check when the log parent cannot be created',async()=>{
    const directory=temporaryDirectory(),file=join(directory,'not-a-directory');
    writeFileSync(file,'occupied');
    await expect(runCheck(specFor(directory,{logPath:join(file,'probe.log')}))).resolves.toMatchObject({status:'FAIL',errorKind:'log-error'});
  });

  it('returns a failed check when opening the log fails before the child exits',async()=>{
    const directory=temporaryDirectory();
    await expect(runCheck(specFor(directory,{logPath:directory,args:['-e','setTimeout(()=>{},15_000)']}))).resolves.toMatchObject({status:'FAIL',errorKind:'log-error'});
  });

  it.skipIf(process.platform!=='linux'||!existsSync('/dev/full'))('kills a running child when a log write fails after opening',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{
      logPath:'/dev/full',
      args:['-e','require("node:fs").writeFileSync("child.pid",String(process.pid));console.log("post-open write");setTimeout(()=>{},10_000);'],
      timeoutMs:10_000,
    }));
    // The child writes the marker only after startup, which follows successful log opening.
    expect(result).toMatchObject({status:'FAIL',errorKind:'log-error'});
    const pid=Number(readFileSync(join(directory,'child.pid'),'utf8'));
    expect(Number.isSafeInteger(pid)).toBe(true);
    await expect.poll(()=>existsSync('/proc/'+pid),{timeout:3000}).toBe(false);
  });

  it('preserves UTF-8 characters split across pipe chunks',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{
      args:['-e','const value=Buffer.from("測試 café 🚲");process.stdout.write(value.subarray(0,1));setTimeout(()=>process.stdout.write(Buffer.concat([value.subarray(1),Buffer.from("\\n")])),100)'],
    }));
    expect(result.status).toBe('PASS');
    expect(readFileSync(result.artifact,'utf8')).toBe('測試 café 🚲\n');
  });

  it('child output is captured to the log artifact',async()=>{
    const directory=temporaryDirectory();
    const result=await runCheck(specFor(directory,{args:['-e','console.log("f01-log-marker")']}));
    expect(result.status).toBe('PASS');
    expect(readFileSync(result.artifact,'utf8')).toContain('f01-log-marker');
  });
});

describe('readiness package-manager launch',()=>{
  it('runs through the JavaScript pnpm entry when PATH has only a Windows shim',async()=>{
    const directory=temporaryDirectory(),installed=join(directory,'node_modules','pnpm');
    mkdirSync(join(installed,'bin'),{recursive:true});
    writeFileSync(join(directory,'package.json'),JSON.stringify({packageManager:'pnpm@10.30.3'}));
    writeFileSync(join(directory,'pnpm.cmd'),'@exit /b 9');
    writeFileSync(join(installed,'package.json'),JSON.stringify({name:'pnpm',version:'10.30.3'}));
    writeFileSync(join(installed,'bin','pnpm.cjs'),'console.log(JSON.stringify(process.argv.slice(2)))');
    vi.stubEnv('PATH',directory);
    const run=readinessPackageChecks(directory);
    const result=await run(specFor(directory,{command:'pnpm',args:['test:browser','--suite','root']}));
    expect(result).toMatchObject({status:'PASS',command:process.execPath,
      args:[join(installed,'bin','pnpm.cjs'),'test:browser','--suite','root']});
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('["test:browser","--suite","root"]');
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
    const plan=windowsVerificationPlan('linux','0.6.5',temporaryDirectory(),'x64');
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

  it('gives each readiness run its own immutable Windows release destination',async()=>{
    const runA=join(temporaryDirectory(),'release output');
    const runB=join(temporaryDirectory(),'release output');
    for(const outputRoot of [runA,runB]){
      const plan=windowsVerificationPlan('win32','0.6.5',outputRoot,'x64');
      expect(plan.commands[0]?.args).toEqual(['desktop:package','--output-root',outputRoot]);
      const release=await reserveDesktopRelease(plan.commands[0]!.args[2]!,'0.6.5');
      expect(plan.commands[1]?.args.slice(-2)).toEqual([
        join(release,'Gen-V1-Setup-0.6.5-win-x64.exe'),join(release,'win-unpacked'),
      ]);
    }
  });

  it.each(['arm64','ia32'])('blocks unsupported Windows %s before packaging',arch=>{
    const plan=windowsVerificationPlan('win32','0.6.5',temporaryDirectory(),arch);
    expect(plan).toMatchObject({blocked:true,errorKind:'platform-unavailable'});
    expect(plan.commands).toHaveLength(2);
  });
  it('packaged Windows verification is runnable on Windows x64',()=>{
    const plan=windowsVerificationPlan('win32','0.6.5',temporaryDirectory(),'x64');
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

  it('redacts named cloud access keys that lack an api_key or token suffix',()=>{
    for(const name of ['AWS_SECRET_ACCESS_KEY','AWS_ACCESS_KEY_ID','GCP_SERVICE_ACCOUNT_KEY']){
      const safe=redactSecrets(`${name}=SYNTHETIC_CLOUD_CANARY_5513 another-word`);
      expect(safe).toContain('[REDACTED]');
      expect(safe).not.toContain('SYNTHETIC_CLOUD_CANARY_5513');
      expect(safe).not.toContain('another-word');
    }
  });

  it('redacts named cloud keys in child logs and blocks a multiline opposite-pipe value',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\nAWS_SECRET_ACCESS_KEY=SYNTHETIC_AWS_CANARY_5514\nAWS_ACCESS_KEY_ID=SYNTHETIC_ID_CANARY_5514\nGCP_SERVICE_ACCOUNT_KEY=SYNTHETIC_GCP_CANARY_5514\nAWS_SECRET_ACCESS_KEY:\n");setTimeout(()=>process.stderr.write("SYNTHETIC_MULTILINE_CANARY_5514\n"),50);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('[REDACTED]');
    expect(log).toContain('[REDACTED MULTILINE CREDENTIAL]');
    for(const canary of ['SYNTHETIC_AWS_CANARY_5514','SYNTHETIC_ID_CANARY_5514','SYNTHETIC_GCP_CANARY_5514','SYNTHETIC_MULTILINE_CANARY_5514'])expect(log).not.toContain(canary);
  });
  it('redacts every word in a quoted or unquoted named credential field',()=>{
    for(const raw of [
      'password: "SYNTHETIC_MULTIWORD_A_4481 SYNTHETIC_MULTIWORD_B_4481"',
      "password: 'SYNTHETIC_MULTIWORD_A_4481 SYNTHETIC_MULTIWORD_B_4481'",
      'api_key = SYNTHETIC_MULTIWORD_A_4481 SYNTHETIC_MULTIWORD_B_4481',
      '{"api_key": "SYNTHETIC_MULTIWORD_A_4481 SYNTHETIC_MULTIWORD_B_4481"}',
    ]){
      const safe=redactSecrets(raw);
      expect(safe).toContain('[REDACTED]');
      expect(safe).not.toContain('SYNTHETIC_MULTIWORD_A_4481');
      expect(safe).not.toContain('SYNTHETIC_MULTIWORD_B_4481');
    }
    expect(redactSecrets('plain readiness output')).toBe('plain readiness output');
  });

  it('does not persist the trailing words of a multiword child credential',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\npassword: 'SYNTHETIC_CHILD_A_4482 SYNTHETIC_CHILD_B_4482'\nafter\n");`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('password: [REDACTED]\n');
    expect(log).toContain('after\n');
    expect(log).not.toContain('SYNTHETIC_CHILD_A_4482');
    expect(log).not.toContain('SYNTHETIC_CHILD_B_4482');
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
  it('redacts multiline PEM credentials split across child output chunks',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\n-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_PEM_");setTimeout(()=>process.stdout.write("CANARY_9281\n-----END RSA PRIVATE KEY-----\nafter\n"),30);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('after\n');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).not.toContain('SYNTHETIC_PEM_');
    expect(log).not.toContain('CANARY_9281');
    expect(log).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
    expect(log).not.toContain('-----END RSA PRIVATE KEY-----');
  });

  it('fails closed when a PEM begin marker has no matching end before child exit',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\n-----BEGIN PRIVATE KEY-----\nUNTERMINATED_PEM_CANARY_9282\n");`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).not.toContain('UNTERMINATED_PEM_CANARY_9282');
    expect(log).not.toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('does not resume logging after a mismatched private-key end delimiter',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\n-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_PEM_CANARY_9284\n-----END PRIVATE KEY-----\nDO_NOT_LEAK_AFTER_MISMATCH\n");`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).not.toContain('SYNTHETIC_PEM_CANARY_9284');
    expect(log).not.toContain('DO_NOT_LEAK_AFTER_MISMATCH');
  });

  it('preserves text around a same-line PEM block without disclosing the key',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before -----BEGIN PRIVATE KEY-----INLINE_PEM_CANARY_9283-----END PRIVATE KEY----- after\n");`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before [REDACTED PRIVATE KEY] after\n');
    expect(log).not.toContain('INLINE_PEM_CANARY_9283');
  });


  it('does not let stderr forge the end of a stdout private-key region',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\n-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_PEM_KEY_A\n");setTimeout(()=>process.stderr.write("status -----END RSA PRIVATE KEY-----\n"),60);setTimeout(()=>process.stdout.write("SYNTHETIC_PEM_KEY_B\n"),120);setTimeout(()=>process.stdout.write("-----END RSA PRIVATE KEY-----\nafter\n"),180);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).toContain('after\n');
    // While stdout owns the open key, other-pipe bytes stay suppressed.
    expect(log).not.toContain('status -----END RSA PRIVATE KEY-----');
    expect(log).not.toContain('SYNTHETIC_PEM_KEY_A');
    expect(log).not.toContain('SYNTHETIC_PEM_KEY_B');
  });

  it('keeps incomplete stdout lines independent of stderr while redacting',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("left-");setTimeout(()=>process.stderr.write("right\n"),60);setTimeout(()=>process.stdout.write("half\n"),120);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const lines=readFileSync(result.artifact,'utf8').trimEnd().split('\n').sort();
    expect(lines).toEqual(['left-half','right']);
  });


  it('does not disclose a PEM body emitted on the opposite pipe',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("-----BEGIN PRIVATE KEY-----\n");setTimeout(()=>process.stderr.write("SYNTHETIC_PEM_BODY_OTHER_PIPE\n"),60);setTimeout(()=>process.stdout.write("-----END PRIVATE KEY-----\nafter\n"),120);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).toContain('after\n');
    expect(log).not.toContain('SYNTHETIC_PEM_BODY_OTHER_PIPE');
  });


  it('does not flush an opposite-pipe secret fragment after its owner key closes',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("-----BEGIN PRIVATE KEY-----\n");setTimeout(()=>process.stderr.write("SYNTHETIC_UNTERMINATED_OTHER_PIPE"),60);setTimeout(()=>process.stdout.write("-----END PRIVATE KEY-----\nafter\n"),120);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).toContain('after\n');
    expect(log).not.toContain('SYNTHETIC_UNTERMINATED_OTHER_PIPE');
  });

  it('redacts an ANSI-colored credential label assembled from child chunks',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("pa\x1b[31mss");setTimeout(()=>process.stdout.write("\x1b[0mword: ANSI_PASSWORD_CANARY_7341\n"),50);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('password: [REDACTED]');
    expect(log).not.toContain('ANSI_PASSWORD_CANARY_7341');
  });

  it('recognizes a colored PEM start delimiter before suppressing the body',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("-----BE\x1b[36mGIN PRIVATE KEY-----\nANSI_PEM_CANARY_7342\n");setTimeout(()=>process.stdout.write("-----END PRIVATE KEY-----\nafter\n"),50);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).toContain('after\n');
    expect(log).not.toContain('ANSI_PEM_CANARY_7342');
  });

  it('suppresses all later child output when unknown controls could hide a key delimiter',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("before\npassword\x1b[=UNSAFE_CONTROL_CANARY_7343\n");setTimeout(()=>process.stderr.write("FOLLOW_ON_CANARY_7343\n"),50);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('before\n');
    expect(log).toContain('[REDACTED UNSAFE CONTROL OUTPUT]');
    expect(log).not.toContain('UNSAFE_CONTROL_CANARY_7343');
    expect(log).not.toContain('FOLLOW_ON_CANARY_7343');
  });

  it('taints an unfinished unsafe terminal sequence before the opposite pipe can leak',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("password\x1b[=PARTIAL_CANARY_7344");setTimeout(()=>process.stderr.write("OPPOSITE_PIPE_CANARY_7344\n"),50);setTimeout(()=>process.stdout.write("\n"),100);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED UNSAFE CONTROL OUTPUT]');
    expect(log).not.toContain('PARTIAL_CANARY_7344');
    expect(log).not.toContain('OPPOSITE_PIPE_CANARY_7344');
  });

  it('blocks other-pipe output when a PEM header is buffered without a newline',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("-----BEGIN PRIVATE KEY-----");setTimeout(()=>process.stderr.write("OPPOSITE_PEM_CANARY_7345\n"),50);setTimeout(()=>process.stdout.write("\n-----END PRIVATE KEY-----\n"),100);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED PRIVATE KEY]');
    expect(log).not.toContain('OPPOSITE_PEM_CANARY_7345');
  });


  it('suppresses a credential value on the next stdout line',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("password:\nSYNTHETIC_MULTILINE_VALUE_9911\n");`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED MULTILINE CREDENTIAL]');
    expect(log).not.toContain('SYNTHETIC_MULTILINE_VALUE_9911');
  });

  it('suppresses a bearer value emitted on the other child pipe',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("Authorization: Bearer\n");setTimeout(()=>process.stderr.write("SYNTHETIC_MULTILINE_VALUE_9912\n"),50);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED MULTILINE CREDENTIAL]');
    expect(log).not.toContain('SYNTHETIC_MULTILINE_VALUE_9912');
  });

  it('blocks other-pipe output before an unfinished password label is flushed',async()=>{
    const directory=temporaryDirectory();
    const script=String.raw`process.stdout.write("password:");setTimeout(()=>process.stderr.write("SYNTHETIC_MULTILINE_VALUE_9913\n"),50);setTimeout(()=>process.stdout.write("\n"),100);`;
    const result=await runCheck(specFor(directory,{args:['-e',script]}));
    expect(result.status).toBe('PASS');
    const log=readFileSync(result.artifact,'utf8');
    expect(log).toContain('[REDACTED MULTILINE CREDENTIAL]');
    expect(log).not.toContain('SYNTHETIC_MULTILINE_VALUE_9913');
  });


  it('suppresses opposite-pipe output while the PEM start marker is incomplete',async()=>{
    const opener='-----BEGIN RSA PRIVATE KEY-----';
    for(const length of [5,7,19,opener.length-1]){
      const directory=temporaryDirectory();
      // The child is real; the same canary crosses pipes between two opener writes.
      const script=String.raw`const opener="-----BEGIN RSA PRIVATE KEY-----";const cut=Number(process.argv[1]);process.stdout.write("before\n"+opener.slice(0,cut));setTimeout(()=>process.stderr.write("SYNTHETIC_PARTIAL_PEM_OTHER_PIPE_8821\n"),40);setTimeout(()=>process.stdout.write(opener.slice(cut)+"\nSYNTHETIC_PARTIAL_PEM_KEY_8821\n-----END RSA PRIVATE KEY-----\nafter\n"),80);`;
      const result=await runCheck(specFor(directory,{args:['-e',script,String(length)]}));
      expect(result.status).toBe('PASS');
      const log=readFileSync(result.artifact,'utf8');
      expect(log).toContain('before\n');
      expect(log).toContain('after\n');
      expect(log).toContain('[REDACTED PRIVATE KEY]');
      expect(log).not.toContain('SYNTHETIC_PARTIAL_PEM_OTHER_PIPE_8821');
      expect(log).not.toContain('SYNTHETIC_PARTIAL_PEM_KEY_8821');
    }
  });

});
