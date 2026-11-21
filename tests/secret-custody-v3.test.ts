import {describe,it,expect} from 'vitest';
import {SecretReferenceLedger,buildChildEnvironment,createSecretRedactor} from '../packages/core/secret-references';
import {secretRefV1Schema,type SecretRefV1} from '../packages/contracts/execution-profile';
import {hostFlagEnabled,HOST_FLAG_REGISTRY,HOST_FLAG_NAMES} from '../packages/core/host-flags';
import {preferencesSchema} from '../packages/contracts/preferences';

const EXEC_SHA='a'.repeat(64);
const processRef=(over:Partial<SecretRefV1>={}):SecretRefV1=>secretRefV1Schema.parse({version:1,refId:'api-token',purpose:'call the example api',owner:'account-1',destination:{kind:'process-env',executableSha256:EXEC_SHA,envName:'API_TOKEN'},...over});
const httpRef=(over:Partial<SecretRefV1>={}):SecretRefV1=>secretRefV1Schema.parse({version:1,refId:'http-key',purpose:'authorize example origin',owner:'account-1',destination:{kind:'http-header',origin:'https://api.example.com',header:'Authorization'},...over});

describe('secret reference custody',()=>{
 it('exposes only opaque id, purpose, owner and permitted destination',()=>{
  const ledger=new SecretReferenceLedger();
  ledger.register(processRef(),()=>'SUPER_SECRET_VALUE_9f27');
  const listing=ledger.list();
  expect(listing).toHaveLength(1);
  expect(listing[0]).toMatchObject({refId:'api-token',purpose:'call the example api',owner:'account-1'});
  expect(JSON.stringify(listing)).not.toContain('SUPER_SECRET_VALUE_9f27');
  expect(JSON.stringify(listing)).not.toContain('resolver');
  expect(Object.keys(listing[0]!)).not.toContain('value');
 });

 it('resolves only inside the authorized executor after exact-destination approval',async()=>{
  const ledger=new SecretReferenceLedger();
  ledger.register(processRef(),async()=>'SUPER_SECRET_VALUE_9f27');
  const destination=processRef().destination;
  await expect(ledger.resolve('api-token',destination)).rejects.toThrow(/approval|denied/i);
  expect(()=>ledger.approve('api-token',{kind:'process-env',executableSha256:'f'.repeat(64),envName:'API_TOKEN'})).toThrow(/destination|denied/i);
  expect(()=>ledger.approve('api-token',{kind:'http-header',origin:'https://api.example.com',header:'Authorization'})).toThrow(/destination|denied/i);
  const approval=ledger.approve('api-token',destination,{actor:'operator'});
  const resolved=await ledger.resolve('api-token',destination,approval);
  expect(resolved.env).toEqual({API_TOKEN:'SUPER_SECRET_VALUE_9f27'});
  await expect(ledger.resolve('api-token',destination,approval)).rejects.toThrow(/approval|used|consumed/i);
 });

 it('http destination yields headers for the exact origin only',async()=>{
  const ledger=new SecretReferenceLedger();
  ledger.register(httpRef(),()=>'Bearer SECRETHTTP_77');
  const approval=ledger.approve('http-key',httpRef().destination);
  const resolved=await ledger.resolve('http-key',httpRef().destination,approval);
  expect(resolved.headers).toEqual({Authorization:'Bearer SECRETHTTP_77'});
  expect(resolved.env).toBeUndefined();
 });

 it('revocation blocks the correct reference without invalidating unrelated ones',async()=>{
  const ledger=new SecretReferenceLedger();
  ledger.register(processRef(),()=>'ONE_SECRET_111');
  ledger.register(processRef({refId:'other-token',destination:{kind:'process-env',executableSha256:'c'.repeat(64),envName:'OTHER_TOKEN'}}),()=>'TWO_SECRET_222');
  ledger.revoke('api-token');
  expect(()=>ledger.approve('api-token',processRef().destination)).toThrow(/revoked/i);
  const other=ledger.list().find(r=>r.refId==='other-token')!;
  expect(other.revoked).toBe(false);
  const approval=ledger.approve('other-token',other.destination);
  const resolved=await ledger.resolve('other-token',other.destination,approval);
  expect(resolved.env).toEqual({OTHER_TOKEN:'TWO_SECRET_222'});
 });

 it('expired approvals cannot resolve',async()=>{
  let time=1_000;
  const ledger=new SecretReferenceLedger(()=>time);
  ledger.register(processRef(),()=>'EXPIRED_SECRET_333');
  const approval=ledger.approve('api-token',processRef().destination,{ttlMs:50});
  time+=100;
  await expect(ledger.resolve('api-token',processRef().destination,approval)).rejects.toThrow(/expired|approval/i);
 });

 it('revocation while the resolver is pending prevents delivery',async()=>{
  let finish!:(value:string)=>void;
  const ledger=new SecretReferenceLedger();
  ledger.register(processRef(),()=>new Promise<string>(resolve=>{finish=resolve;}));
  const approval=ledger.approve('api-token',processRef().destination);
  const pending=ledger.resolve('api-token',processRef().destination,approval);
  ledger.revoke('api-token');
  finish('REVOKED_SECRET_333');
  await expect(pending).rejects.toThrow(/revoked/i);
  await expect(ledger.resolve('api-token',processRef().destination,approval)).rejects.toThrow(/revoked/i);
 });

 it('expiry while the resolver is pending prevents delivery and keeps approval consumed',async()=>{
  let time=1_000;
  let finish!:(value:string)=>void;
  const ledger=new SecretReferenceLedger(()=>time);
  ledger.register(processRef(),()=>new Promise<string>(resolve=>{finish=resolve;}));
  const approval=ledger.approve('api-token',processRef().destination,{ttlMs:50});
  const pending=ledger.resolve('api-token',processRef().destination,approval);
  time+=50;
  finish('EXPIRED_SECRET_444');
  await expect(pending).rejects.toThrow(/expired/i);
  await expect(ledger.resolve('api-token',processRef().destination,approval)).rejects.toThrow(/approval/i);
 });
});

 it('children start from an explicit environment allowlist, never a process.env copy',()=>{
  const base:Record<string,string|undefined>={PATH:'/usr/bin',HOME:'/home/u',AWS_SECRET_ACCESS_KEY:'host-wide',NPM_TOKEN:'host-wide-2',EMPTY:undefined};
  const env=buildChildEnvironment(base,['PATH','HOME'],[{name:'API_TOKEN',value:'INJECTED_1'}]);
  expect(env).toEqual({PATH:'/usr/bin',HOME:'/home/u',API_TOKEN:'INJECTED_1'});
  expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
  expect(env).not.toHaveProperty('NPM_TOKEN');
  expect(env).not.toHaveProperty('EMPTY');
  expect(Object.keys(env).sort()).toEqual(['API_TOKEN','HOME','PATH']);
 });

describe('structured secret redaction',()=>{
 const TOKEN='sk-live-9f27ab31cd';
 it('redacts known token fields before logs or model output',()=>{
  const redactor=createSecretRedactor([TOKEN]);
  const {text,redactions}=redactor.redact(`{"api_key":"${TOKEN}","note":"ok"}`);
  expect(text).not.toContain(TOKEN);expect(text).toContain('[REDACTED]');expect(redactions).toBe(1);
 });
 it('matches across ANSI escape splits and multiline values',()=>{
  const ansi=createSecretRedactor([TOKEN]);
  const split=`prefix sk-\u001b[31mlive\u001b[0m-9f27ab31cd suffix`;
  expect(ansi.redact(split).text).not.toContain('9f27ab31cd');
  const multi=createSecretRedactor(['first-line\nsecond-line-secret']);
  const out=multi.redact('before first-line\nsecond-line-secret after');
  expect(out.text).not.toContain('second-line-secret');
 });
 it('covers JSON-escaped, percent-encoded and base64-encoded forms of known values',()=>{
  const tricky='token"with\\slash';
  const redactor=createSecretRedactor([tricky]);
  expect(redactor.redact(`value=${JSON.stringify(tricky).slice(1,-1)}`).text).not.toContain('with');
  const encoded=createSecretRedactor([TOKEN]);
  expect(encoded.redact(`data=${encodeURIComponent(TOKEN)}`).text).not.toContain(encodeURIComponent(TOKEN));
  expect(encoded.redact(`data=${Buffer.from(TOKEN,'utf8').toString('base64')}`).text).not.toContain(Buffer.from(TOKEN,'utf8').toString('base64'));
 });
 it('declared secret field names redact structured values even when the value is unknown',()=>{
  const redactor=createSecretRedactor([], {fields:['api_key','access_token']});
  const {text}=redactor.redact('{"api_key":"unknown-but-sensitive","other":"visible"}');
  expect(text).not.toContain('unknown-but-sensitive');expect(text).toContain('visible');
 });
 it('does not claim universal redaction and ignores low-entropy inputs',()=>{
  const redactor=createSecretRedactor(['abc']); // below minimum tracked length
  const {text,redactions}=redactor.redact('abc appears but is not a tracked secret');
  expect(redactions).toBe(0);expect(text).toContain('abc');
  const scoped=createSecretRedactor([TOKEN]);
  expect(scoped.redact('a different unknown secret VALUE-999 passes through').text).toContain('VALUE-999');
 });
});

describe('host-owned security flags',()=>{
 it('registers exactly the seven finite keys, all default false',()=>{
  expect(HOST_FLAG_NAMES.sort()).toEqual(['browser.accessibilityAuditV1','coding.debuggerV1','coding.intelligenceV1','coding.renameV1','security.executionProfilesV1','security.projectTrustV1','security.secretRefsV1','verification.workflowV1']);
  for(const name of HOST_FLAG_NAMES){expect(HOST_FLAG_REGISTRY[name].default).toBe(false);expect(hostFlagEnabled(name,{})).toBe(false);}
  expect(hostFlagEnabled('security.projectTrustV1',{HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1:'1'})).toBe(true);
  expect(hostFlagEnabled('security.projectTrustV1',{HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1:'true'})).toBe(true);
  expect(hostFlagEnabled('security.projectTrustV1',{HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1:'yes'})).toBe(false);
 });
 it('is not reachable through strict UI preferences or agent/plugin writable settings',()=>{
  for(const name of HOST_FLAG_NAMES){
   expect(preferencesSchema.safeParse({[name]:true}).success).toBe(false);
  }
 });
});
