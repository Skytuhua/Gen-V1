import { expect, it } from 'vitest';
import { createProgressiveToolSession } from '../packages/core/context-tool-discovery.ts';

it('does not spend deferred discovery slots on already-direct tools', () => {
  const direct = Array.from({ length: 64 }, (_, index) => ({
    name: 'direct-' + index, description: 'Direct tool', schema: {}, exposure: 'DIRECT' as const,
  }));
  const session = createProgressiveToolSession([
    ...direct, { name: 'deferred', description: 'Deferred tool', schema: {}, exposure: 'DEFERRED' },
  ], () => true);
  session.capture();
  for (const entry of direct) expect(session.describe(entry.name)).not.toBeNull();
  expect(session.describe('deferred')).not.toBeNull();
  expect(session.canInvoke('deferred')).toBe(false);
  expect(session.capture().tools.map(tool => tool.name)).toContain('deferred');
  expect(session.canInvoke('deferred')).toBe(true);
});
