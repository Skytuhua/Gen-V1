import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {M16_BROWSER_SCENARIO_REVIEW,M16_CONTROL_ADDON_EXPORTS,assertM16CheckedOutSource,assertM16IdentityVerificationReceipt,assertM16ModuleLoadReceipt,m16BuildManifestIdentity,m16BuildReference,m16ModuleLoadEnvironment,m16RunReference,parseM16ModuleLoadOutput,readM16Owner} from '../scripts/m16-installed-identity.ts';

const sha='a'.repeat(64),source='b'.repeat(40),electron='45.2.0';
const env={GITHUB_SHA:source,GITHUB_SERVER_URL:'https://github.com',GITHUB_REPOSITORY:'skytuhua-org/Gen-V1',GITHUB_RUN_ID:'44530352725',GITHUB_RUN_ATTEMPT:'2'};
const exports=Object.fromEntries(M16_CONTROL_ADDON_EXPORTS.map(name=>[name,'function']));
const moduleReceipt=parseM16ModuleLoadOutput(JSON.stringify({status:'LOADED',versions:{electron,node:'24.1.0',modules:'137',napi:'10',platform:'win32',arch:'x64'},exports,missing:[]}),electron);

function receipt(){
 const first={kind:'m16-installed-identity',status:'PASS',sourceSha:source,fileIdentity:{executable:{name:'Gen V1.exe',bytes:1,sha256:sha},addon:{packageRelativePath:'resources/host/packages/core/windows-control-bridge.node',bytes:2,sha256:sha}},directModuleLoad:moduleReceipt,applicationProductionRegistration:{status:'NOT_OBSERVED'},runtimeRegistration:{status:'UNPROVED'},browserScenarioReview:M16_BROWSER_SCENARIO_REVIEW};
 const second={...first,directModuleLoad:{status:'NOT_RUN',dependency:'same installed runtime'}};
 return{passed:true,installedIntegration:{status:'bound'},launches:[{passed:true,verifiedOwner:true},{passed:true,verifiedOwner:true}],integrations:[{iteration:1,kind:'installed-verifier-integration',receipt:first},{iteration:2,kind:'installed-verifier-integration',receipt:second}],cleanup:{status:'uninstalled-owned-installation'}} as Record<string,unknown>;
}

describe('M16 hosted installed identity verification',()=>{
 it('builds the run reference only from the immutable GitHub checkout and attempt',()=>{
  expect(m16RunReference(env)).toEqual({sourceSha:source,buildReference:'https://github.com/skytuhua-org/Gen-V1/actions/runs/44530352725/attempts/2',runId:'44530352725',runAttempt:'2'});
  expect(()=>m16RunReference({...env,GITHUB_SHA:undefined})).toThrow(/checked-out GITHUB_SHA/);
  expect(()=>m16RunReference({...env,GITHUB_SHA:source.toUpperCase()})).toThrow(/checked-out GITHUB_SHA/);
  expect(()=>m16RunReference({...env,GITHUB_RUN_ID:'run'})).toThrow(/GITHUB_RUN_ID/);
  assertM16CheckedOutSource(source,source);
  expect(()=>assertM16CheckedOutSource(source,'c'.repeat(40))).toThrow(/does not match GITHUB_SHA/);
 });

 it('binds the invoked setup bytes to the same-job build manifest and its digest',()=>{
  const setup={name:'Gen-V1-Setup-1.2.3-win-x64.exe',bytes:12,sha256:sha};
  const bytes=Buffer.from(JSON.stringify({electronVersion:electron,files:[{file:'win-unpacked/resources/app.asar',bytes:1,sha256:'c'.repeat(64)},{file:setup.name,bytes:setup.bytes,sha256:setup.sha256}]}));
  const manifest=m16BuildManifestIdentity(bytes,setup);
  expect(manifest).toMatchObject({electronVersion:electron,setupEntryMatched:true});
  expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(m16BuildReference('https://example.test/run',manifest.sha256)).toContain('#build-manifest-sha256=');
  expect(()=>m16BuildManifestIdentity(bytes,{...setup,sha256:'d'.repeat(64)})).toThrow(/does not match/);
  expect(()=>m16BuildManifestIdentity(Buffer.from(JSON.stringify({electronVersion:electron,files:[]})),setup)).toThrow(/bounded file inventory/);
  expect(()=>m16BuildManifestIdentity(Buffer.from(JSON.stringify({electronVersion:electron,files:[{file:'other.exe',bytes:12,sha256:sha}]})),setup)).toThrow(/exactly one setup/);
 });

 it('parses only a bounded module-load pass for the packaged Electron and all control exports',()=>{
  expect(moduleReceipt).toMatchObject({status:'PASS',runtime:{executable:'Gen V1.exe',electron,platform:'win32',arch:'x64'},nativeCalls:false});
  expect(()=>assertM16ModuleLoadReceipt(moduleReceipt,electron)).not.toThrow();
  expect(()=>parseM16ModuleLoadOutput('warn\n'+JSON.stringify({status:'LOADED',versions:{electron:'45.1.0',node:'24.1.0',modules:'137',napi:'10',platform:'win32',arch:'x64'},exports,missing:[]}),electron)).toThrow(/packaged Electron/);
  expect(()=>parseM16ModuleLoadOutput(JSON.stringify({status:'EXPORTS_MISSING',missing:['captureWindow']}),electron)).toThrow(/captureWindow/);
  expect(()=>parseM16ModuleLoadOutput(JSON.stringify({status:'LOAD_FAILED',error:'ERR_DLOPEN_FAILED'}),electron)).toThrow(/ERR_DLOPEN_FAILED/);
  expect(()=>parseM16ModuleLoadOutput(JSON.stringify({status:'LOADED',versions:{electron,node:'24.1.0',modules:'137',napi:'7',platform:'win32',arch:'x64'},exports,missing:[]}),electron)).toThrow(/Node-API/);
  expect(()=>assertM16ModuleLoadReceipt({...moduleReceipt,runtime:{...moduleReceipt.runtime,electron:'45.1.0'}},electron)).toThrow(/runtime does not match/);
 });

 it('scrubs ambient feature activation from the isolated module-load child',()=>{
  const child=m16ModuleLoadEnvironment({PATH:'C:\\Windows',HARNESS_FLAG_CONTROL_V1:'true',ELECTRON_RUN_AS_NODE:'0',SECRET:'do-not-inherit'});
  expect(child.PATH).toBe('C:\\Windows');
  expect(child.ELECTRON_RUN_AS_NODE).toBe('1');
  expect(child).not.toHaveProperty('HARNESS_FLAG_CONTROL_V1');
  expect(child).not.toHaveProperty('SECRET');
 });

 it('reads only the exact owner receipt for the invoked installer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'m16-owner-'));
  try{
   const installDirectory='C:\\workspace\\.harness-app-abc123';
   await writeFile(join(root,'owner.json'),JSON.stringify({setupSha256:sha,installDirectory}));
   await expect(readM16Owner(root,sha)).resolves.toBe(installDirectory);
   await expect(readM16Owner(root,'c'.repeat(64))).rejects.toThrow(/does not match the invoked installer/);
   await writeFile(join(root,'owner.json'),JSON.stringify({setupSha256:sha,installDirectory:'relative\\.harness-app'}));
   await expect(readM16Owner(root,sha)).rejects.toThrow(/does not match the invoked installer/);
  }finally{await rm(root,{recursive:true,force:true});}
 });

 it('requires bound provenance, both callbacks, one direct load and owned cleanup',()=>{
  expect(()=>assertM16IdentityVerificationReceipt(receipt(),electron)).not.toThrow();
  const unbound=receipt();(unbound.installedIntegration as Record<string,unknown>).status='unbound';
  expect(()=>assertM16IdentityVerificationReceipt(unbound,electron)).toThrow(/bound source provenance/);
  const oneLaunch=receipt();oneLaunch.launches=[{passed:true,verifiedOwner:true}];
  expect(()=>assertM16IdentityVerificationReceipt(oneLaunch,electron)).toThrow(/exactly two/);
  const failedLaunch=receipt();(failedLaunch.launches as Record<string,unknown>[])[0]!.verifiedOwner=false;
  expect(()=>assertM16IdentityVerificationReceipt(failedLaunch,electron)).toThrow(/owned verification/);
  const noLoad=receipt();((noLoad.integrations as Record<string,unknown>[])[0]!.receipt as Record<string,unknown>).directModuleLoad={status:'NOT_RUN'};
  expect(()=>assertM16IdentityVerificationReceipt(noLoad,electron)).toThrow(/module-load receipt/);
  const proved=receipt();((proved.integrations as Record<string,unknown>[])[0]!.receipt as Record<string,unknown>).runtimeRegistration={status:'PROVED'};
  expect(()=>assertM16IdentityVerificationReceipt(proved,electron)).toThrow(/runtime registration/);
  const dirty=receipt();dirty.cleanup={status:'preserved-for-inspection'};
  expect(()=>assertM16IdentityVerificationReceipt(dirty,electron)).toThrow(/clean up/);
 });

 it('records the browser scenario review without wiring flag, registration, capture or Stop',()=>{
  expect(M16_BROWSER_SCENARIO_REVIEW).toMatchObject({status:'NOT_WIRED',coverage:expect.arrayContaining(['consent-request-and-grant','bounded-selected-tab-capture','post-stop-capture-denied'])});
  expect(M16_BROWSER_SCENARIO_REVIEW.prerequisites).toEqual(expect.arrayContaining(['control-flag-activation','live-driver-registration','independent-stop']));
 });

 it('keeps the hosted adaptation inside the existing installed-memory job without memory activation',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  expect(workflow.match(/^  installed-memory:\n/gm)).toHaveLength(1);
  const start=workflow.indexOf('- name: Verify installed default-off identity and direct module load'),end=workflow.indexOf('- name: Preserve installed verification receipts');
  expect(start).toBeGreaterThan(-1);expect(end).toBeGreaterThan(start);
  const step=workflow.slice(start,end);
  expect(step).toContain('scripts/m16-installed-identity.ts');
  expect(step).not.toContain('--project-memory');
  expect(workflow).toContain('.harness-desktop-installed/run-*/m16-identity-receipt.json');
 });
});
