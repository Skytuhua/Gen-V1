import Ajv from 'ajv';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());
it('compiles equivalent snapshot schemas once while preserving validation results', async () => {
  const compile = vi.spyOn(Ajv.prototype, 'compile'), { validateSchema } = await import('../apps/web/src/schema-validator');
  const schema = { title: 'Snapshot response', type: 'object', properties: { choice: { enum: ['accept', 'revise'] } }, required: ['choice'], additionalProperties: false };
  for (let index = 0; index < 100; index++) expect(validateSchema(structuredClone(schema), { choice: 'accept' }, false)).toBe(true);
  expect(validateSchema(structuredClone(schema), { choice: 'unknown' }, false)).toBe(false);
  expect(validateSchema(structuredClone(schema), { choice: 'accept', extra: true }, false)).toBe(false);
  expect(compile.mock.calls.filter(([value]) => typeof value === 'object' && value?.title === schema.title)).toHaveLength(1);
});
it('uses changed schema content and rejects malformed schemas without poisoning later validations', async () => {
  const { validateSchema } = await import('../apps/web/src/schema-validator');
  const schema = { $id: 'urn:harness:decision', type: 'string', enum: ['first'] };
  expect(validateSchema(schema, 'first')).toBe(true);
  schema.enum = ['second'];
  expect(validateSchema(schema, 'first')).toBe(false);
  expect(validateSchema(schema, 'second')).toBe(true);
  expect(validateSchema({ ...schema, enum: ['first'] }, 'first')).toBe(true);
  expect(() => validateSchema({ type: 'not-a-json-schema-type' }, 'x')).toThrow();
  expect(validateSchema({ type: 'integer', minimum: 1 }, 1)).toBe(true);
  expect(validateSchema({ type: 'integer', minimum: 1 }, 0)).toBe(false);
});
it('bounds retained compiled schemas, evicts old entries and keeps format modes separate', async () => {
  const compile = vi.spyOn(Ajv.prototype, 'compile'), { validateSchema } = await import('../apps/web/src/schema-validator');
  for (let index = 0; index < 80; index++) expect(validateSchema({ $id: `urn:harness:bounded:${index}`, type: 'integer', maximum: index }, index)).toBe(true);
  const engines = new Set(compile.mock.contexts as unknown as { _cache: Map<unknown, unknown>; refs: Record<string, unknown> }[]);
  for (const engine of engines) {
    expect(engine._cache.size).toBeLessThanOrEqual(1);
    expect(Object.keys(engine.refs).filter(key => key.startsWith('urn:harness:bounded:'))).toHaveLength(0);
  }
  expect(validateSchema({ $id: 'urn:harness:bounded:0', type: 'integer', maximum: 0 }, 0)).toBe(true);
  expect(compile.mock.calls.filter(([schema]) => typeof schema === 'object' && schema?.$id === 'urn:harness:bounded:0')).toHaveLength(2);
  const same = { title: 'Separate format behavior', type: 'string' };
  expect(validateSchema(same, 'ok', false)).toBe(true); expect(validateSchema(same, 'ok', true)).toBe(true);
  expect(compile.mock.calls.filter(([schema]) => typeof schema === 'object' && schema?.title === same.title)).toHaveLength(2);
});

it('rejects historical async schemas before compilation and never returns their rejected promise', async () => {
  const compile = vi.spyOn(Ajv.prototype, 'compile'), { validateSchema } = await import('../apps/web/src/schema-validator');
  const schema = { $async: true, type: 'string', minLength: 4 };
  expect(() => {
    const result: unknown = validateSchema(schema, 'x');
    if (result && typeof result === 'object' && 'then' in result) void (result as Promise<unknown>).catch(() => {});
  }).toThrow(/synchronous|async/i);
  expect(compile.mock.calls.filter(([value]) => typeof value === 'object' && value?.$async)).toHaveLength(0);
  expect(validateSchema({ type: 'integer' }, 2)).toBe(true);
});

it('rejects nonboolean validator results without leaking a rejected promise or retaining the validator', async () => {
  const unexpected = vi.fn(() => Promise.reject(new Error('Unexpected async validator')));
  const compile = vi.spyOn(Ajv.prototype, 'compile').mockReturnValueOnce(unexpected as unknown as ReturnType<Ajv['compile']>);
  const { validateSchema } = await import('../apps/web/src/schema-validator');
  const schema = { title: 'Unexpected validator result', type: 'string' };
  expect(() => validateSchema(schema, 'x')).toThrow(/synchronous|async/i);
  expect(validateSchema(schema, 'x')).toBe(true);
  expect(compile.mock.calls.filter(([value]) => typeof value === 'object' && value?.title === schema.title)).toHaveLength(2);
});
