import {inspect} from 'node:util';
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

it.each([true, false])('redacts or blocks an immutable child cause (configurable=%s)', configurable => {
 const secret = 'CONTEXT7_IMMUTABLE_CAUSE_FIXTURE_153';
 const inner = new Error('safe nested failure');
 Object.defineProperty(inner, 'cause', {
  value: 'child echoed ' + secret, configurable, writable: false, enumerable: false,
 });
 const failure = new Error('safe outer failure', {cause: inner});
 // Native Node formatting includes a non-enumerable own Error.cause, even
 // when the property is read-only. This reproduces the leak before sanitizing.
 expect(inspect(failure)).toContain(secret);
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
 if(configurable){
  const returned = sanitize.redactFailure({redactor}, failure);
  expect(returned).toBe(failure);
  expect(Object.getOwnPropertyDescriptor(inner, 'cause')?.value).toBe('child echoed [REDACTED]');
  expect(inspect(returned)).not.toContain(secret);
 }else{
  let safelyRejected: unknown;
  try{sanitize.redactFailure({redactor}, failure);}catch(error){safelyRejected=error;}
  expect(safelyRejected).toBeInstanceOf(Error);
  expect((safelyRejected as Error).message).toContain('could not be safely redacted');
  expect(inspect(safelyRejected)).not.toContain(secret);
 }
});

it.each(['raw', 'base64'] as const)('blocks structured child Error.cause metadata (%s) without invoking getters', form => {
 const secret = 'CONTEXT7_STRUCTURED_CAUSE_FIXTURE_154';
 const exposed = form === 'raw' ? secret : Buffer.from(secret, 'utf8').toString('base64');
 let getterCalls = 0;
 const metadata = {token: exposed};
 Object.defineProperty(metadata, 'unsafeGetter', {
  enumerable: true, get() { getterCalls++; throw new Error('untrusted getter must not run'); },
 });
 const failure = new Error('safe outer failure', {cause: {details: metadata}});
 // The real Node formatter prints even nested values in Error.cause.
 expect(inspect(failure, {depth: 6})).toContain(exposed);
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
 let rejected: unknown;
 try { sanitize.redactFailure({redactor}, failure); } catch (error) { rejected = error; }
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(inspect(rejected)).not.toContain(exposed);
 expect(getterCalls).toBe(0);
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

it.each(['raw', 'base64'] as const)('blocks structured child Error metadata before Node logging (%s)', form => {
 const secret='CONTEXT7_ERROR_OWN_METADATA_FIXTURE_157';
 const exposed=form==='raw'?secret:Buffer.from(secret,'utf8').toString('base64');
 let getterCalls=0;
 const details={token:exposed};
 Object.defineProperty(details,'hostile',{get(){getterCalls++;throw Error('must not inspect');}});
 const failure=new Error('safe child failure') as Error&{data?:unknown};
 failure.data=details;
 expect(inspect(failure,{depth:6})).toContain(exposed);
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:Error):Error;
 };
 let rejected:unknown;
 try{sanitize.redactFailure({redactor},failure);}catch(error){rejected=error;}
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(inspect(rejected,{depth:6})).not.toContain(exposed);
 expect(getterCalls).toBe(0);
});

it.each(['raw', 'base64'] as const)('redacts a primitive own Error field (%s)', form => {
 const secret='CONTEXT7_ERROR_OWN_STRING_FIXTURE_158';
 const exposed=form==='raw'?secret:Buffer.from(secret,'utf8').toString('base64');
 const failure=new Error('safe child failure') as Error&{response?:string};
 failure.response='Child response: '+exposed;
 expect(inspect(failure)).toContain(exposed);
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:Error):Error;
 };
 expect(sanitize.redactFailure({redactor},failure)).toBe(failure);
 expect(failure.response).toBe('Child response: [REDACTED]');
 expect(inspect(failure)).not.toContain(exposed);
});

it.each(['frozen', 'getter'] as const)('fails closed on unsafe own Error field (%s)', kind => {
 const secret='CONTEXT7_ERROR_OWN_UNSAFE_FIXTURE_159';
 let getterCalls=0;
 const failure=new Error('safe child failure');
 Object.defineProperty(failure,'metadata',kind==='getter'
  ?{get(){getterCalls++;return secret;},enumerable:true,configurable:true}
  :{value:'Child echoed '+secret,writable:false,configurable:false,enumerable:true});
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:Error):Error;
 };
 let rejected:unknown;
 try{sanitize.redactFailure({redactor},failure);}catch(error){rejected=error;}
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(inspect(rejected)).not.toContain(secret);
 expect(getterCalls).toBe(0);
});

it.each(['raw', 'base64'] as const)('fails closed on a credential-bearing Symbol Error.cause before Node formatting (%s)', form => {
 const secret='CONTEXT7_SYMBOL_CAUSE_FIXTURE_160';
 const exposed=form==='raw'?secret:Buffer.from(secret,'utf8').toString('base64');
 const failure=new Error('safe child failure',{cause:Symbol('child echoed '+exposed)});
 // Node 22 util.inspect renders the Symbol description from Error.cause.
 expect(inspect(failure,{depth:6})).toContain(exposed);
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:Error):Error;
 };
 let rejected:unknown;
 try{sanitize.redactFailure({redactor},failure);}catch(error){rejected=error;}
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(inspect(rejected,{depth:6})).not.toContain(exposed);
});

it.each(['number', 'bigint'] as const)('fails closed on a numeric credential in Error.cause (%s)', kind => {
 const secret='987654321234';
 const cause=kind==='number'?Number(secret):BigInt(secret);
 const failure=new Error('safe child failure',{cause});
 // Native Node rendering exposes both number and bigint causes verbatim.
 expect(inspect(failure,{depth:6})).toContain(secret);
 const manager=new IntegrationManager({
  root:process.cwd(),dataRoot:process.cwd(),
  getPreferences:async()=>({}),setPreference:async()=>{},
  authorize:async()=>({profileId:'test-only'}),
  hostComplete:async(_scope,prompt)=>({output:prompt}),
  onDisable:async()=>{},
 });
 const redactor=createSecretRedactor([secret]);
 const sanitize=manager as unknown as {
  redactFailure(session:{redactor:typeof redactor},error:Error):Error;
 };
 let rejected:unknown;
 try{sanitize.redactFailure({redactor},failure);}catch(error){rejected=error;}
 expect(rejected).toBeInstanceOf(Error);
 expect((rejected as Error).message).toBe('The integration error could not be safely redacted.');
 expect(inspect(rejected,{depth:6})).not.toContain(secret);
});
