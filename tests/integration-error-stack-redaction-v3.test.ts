import {expect, it} from 'vitest';
import {IntegrationManager} from '../packages/integrations/index.ts';
import {createSecretRedactor} from '../packages/core/secret-references.ts';

it.each(['raw', 'base64'] as const)('redacts an already-materialized %s child error stack', form => {
 const secret = 'CONTEXT7_CREDENTIAL_STACK_FIXTURE_124';
 const exposed = form === 'raw' ? secret : Buffer.from(secret, 'utf8').toString('base64');
 // This is the real Error instance and integration failure boundary. Accessing
 // stack first reproduces Node's cached stack, which changing message alone
 // cannot sanitize before the error reaches a caller or a log sink.
 const failure = new Error('MCP child echoed ' + exposed);
 const originalStack = failure.stack;
 expect(originalStack).toContain(exposed);
 const manager = new IntegrationManager({
  root: process.cwd(), dataRoot: process.cwd(),
  getPreferences: async () => ({}), setPreference: async () => {},
  authorize: async () => ({profileId: 'test-only'}),
  hostComplete: async (_scope, prompt) => ({output: prompt}),
  onDisable: async () => {},
 });
 const redactor = createSecretRedactor([secret]);
 const sanitize = manager as unknown as {
  redactFailure(session: {redactor: typeof redactor}, error: Error): Error;
 };
 const returned = sanitize.redactFailure({redactor}, failure);
 expect(returned).toBe(failure);
 expect(returned.message).not.toContain(exposed);
 expect(returned.stack).not.toContain(exposed);
 expect(returned.message).toContain('[REDACTED]');
 expect(returned.stack).toContain('[REDACTED]');
});

it.each(['raw', 'base64'] as const)('redacts an already-materialized %s nested child Error.cause before logging', form => {
 const secret = 'CONTEXT7_NESTED_CAUSE_FIXTURE_151';
 const exposed = form === 'raw' ? secret : Buffer.from(secret, 'utf8').toString('base64');
 const inner = new Error('child failed: ' + exposed);
 const originalStack = inner.stack;
 expect(originalStack).toContain(exposed);
 const failure = new Error('Context7 failed', {cause: inner});
 const manager = new IntegrationManager({
  root: process.cwd(), dataRoot: process.cwd(),
  getPreferences: async () => ({}), setPreference: async () => {},
  authorize: async () => ({profileId: 'test-only'}),
  hostComplete: async (_scope, prompt) => ({output: prompt}),
  onDisable: async () => {},
 });
 const redactor = createSecretRedactor([secret]);
 const sanitize = manager as unknown as {
  redactFailure(session: {redactor: typeof redactor}, error: Error): Error;
 };
 const returned = sanitize.redactFailure({redactor}, failure);
 expect(returned).toBe(failure);
 expect(returned.cause).toBe(inner);
 expect(inner.message).toContain('[REDACTED]');
 expect(inner.stack).toContain('[REDACTED]');
 expect(inner.message).not.toContain(exposed);
 expect(inner.stack).not.toContain(exposed);
});

it('redacts string Error.cause and safely walks a cyclic Error cause chain', () => {
 const secret = 'CONTEXT7_CAUSE_STRING_FIXTURE_152';
 const failure = new Error('safe outer');
 const nested = new Error('safe nested');
 failure.cause = nested;
 nested.cause = failure;
 const stringCause = new Error('safe third', {cause: 'child echoed ' + secret});
 nested.cause = stringCause;
 stringCause.cause = failure;
 const manager = new IntegrationManager({
  root: process.cwd(), dataRoot: process.cwd(),
  getPreferences: async () => ({}), setPreference: async () => {},
  authorize: async () => ({profileId: 'test-only'}),
  hostComplete: async (_scope, prompt) => ({output: prompt}),
  onDisable: async () => {},
 });
 const redactor = createSecretRedactor([secret]);
 const sanitize = manager as unknown as {
  redactFailure(session: {redactor: typeof redactor}, error: Error): Error;
 };
 expect(sanitize.redactFailure({redactor}, failure)).toBe(failure);
 expect(stringCause.cause).toBe(failure);
 expect(nested.cause).toBe(stringCause);
 // Rewire the string cause without a cycle, preserving the same failure path.
 stringCause.cause = 'child echoed ' + secret;
 expect(sanitize.redactFailure({redactor}, failure)).toBe(failure);
 expect(stringCause.cause).toBe('child echoed [REDACTED]');
});

it.each(['raw', 'base64'] as const)('redacts a non-Error child rejection (%s) before it can be surfaced', form => {
 const secret='CONTEXT7_THROWN_STRING_FIXTURE_155';
 const exposed=form==='raw'?secret:Buffer.from(secret,'utf8').toString('base64');
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:unknown):unknown;
 };
 const leaked='MCP child rejected: '+exposed;
 expect(leaked).toContain(exposed);
 const safe=sanitize.redactFailure({redactor},leaked);
 expect(safe).toBe('MCP child rejected: [REDACTED]');
 expect(String(safe)).not.toContain(exposed);
});

it('fails closed on a structured non-Error child rejection without inspecting getters', () => {
 const secret='CONTEXT7_REJECTED_OBJECT_FIXTURE_156';
 let getterCalls=0;
 const metadata={message:'child echoed '+secret};
 Object.defineProperty(metadata,'unsafeGetter',{
  enumerable:true,get(){getterCalls++;throw Error('untrusted getter must not run');},
 });
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:unknown):unknown;
 };
 let rejected:unknown;
 try{sanitize.redactFailure({redactor},metadata);}catch(error){rejected=error;}
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(String(rejected)).not.toContain(secret);
 expect(getterCalls).toBe(0);
});
