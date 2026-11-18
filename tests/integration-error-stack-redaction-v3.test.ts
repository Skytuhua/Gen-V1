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
