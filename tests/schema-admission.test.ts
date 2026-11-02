import Ajv from 'ajv';
import { afterEach, expect, it, vi } from 'vitest';
import { admitSchema, validateJson } from '../packages/core/widgets.ts';

afterEach(() => vi.restoreAllMocks());
it.each([
  { name: 'root', schema: { $async: true, type: 'string', const: 'allow' } },
  { name: 'nested', schema: { type: 'object', properties: { value: { $async: true, type: 'string' } } } },
])('rejects $name asynchronous schemas before invoking a validator', ({ schema }) => {
  expect(() => admitSchema(schema)).toThrow(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
});
it('rejects an asynchronously flagged validator without invoking it', () => {
  const validate = Object.assign(vi.fn(() => Promise.resolve(false)), { $async: true, errors: null, schema: {} });
  vi.spyOn(Ajv.prototype, 'compile').mockReturnValue(validate as unknown as ReturnType<Ajv['compile']>);
  expect(() => validateJson({ type: 'string' }, 'deny')).toThrow(expect.objectContaining({ code: 'INVALID_SCHEMA' }));
  expect(validate).not.toHaveBeenCalled();
});
it('releases native schema identities after admission and synchronous validation', () => {
  const compile = vi.spyOn(Ajv.prototype, 'compile');
  for (let n = 0; n < 100; n++) { admitSchema({ type: 'string', maxLength: 100 }); validateJson({ type: 'string', maxLength: 100 }, 'valid'); }
  const engine = compile.mock.contexts.at(-1) as unknown as { _cache: Map<unknown, unknown> };
  expect(engine._cache.size).toBeLessThanOrEqual(1);
  expect(() => validateJson({ type: 'string', const: 'allow' }, 'deny')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
