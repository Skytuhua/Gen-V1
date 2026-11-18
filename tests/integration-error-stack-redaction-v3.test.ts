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
