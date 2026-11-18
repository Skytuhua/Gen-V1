import { describe, expect, it } from 'vitest';
import { selectRegressionTests } from '../scripts/select-regression-tests.ts';

const suite = ['tests/a.test.ts', 'tests/b.test.ts'];

describe('M01 source filenames never inherit mapping entries', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])('falls back safely for %s', path => {
    const result = selectRegressionTests([{ status: 'M', path }], suite);
    expect(result.tests).toEqual(suite);
    expect(result.coverage).toBe('FULL');
    expect(result.needsReview).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ path, code: 'UNMAPPED_SOURCE' }));
  });

  it('does not treat inherited arrays as reviewed mappings', () => {
    const mapping = Object.create({ 'packages/new.ts': [suite[0]] }) as Record<string, string[]>;
    const result = selectRegressionTests([{ status: 'M', path: 'packages/new.ts' }], suite, mapping);
    expect(result.coverage).toBe('FULL');
    expect(result.tests).toEqual(suite);
    expect(result.needsReview).toBe(true);
  });

  it.each(['constructor', 'toString', '__proto__'])('honors an explicitly owned %s mapping', path => {
    const mapping = JSON.parse(JSON.stringify({ [path]: [suite[0]] })) as Record<string, string[]>;
    const result = selectRegressionTests([{ status: 'M', path }], suite, mapping);
    expect(result.tests).toEqual([suite[0]]);
    expect(result.needsReview).toBe(false);
  });
});
