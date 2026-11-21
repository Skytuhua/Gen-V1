import { describe, expect, it } from 'vitest';
import { inlineJson } from '../packages/integrations/inline-json.ts';
import { patchSpec, protectedFingerprint } from '../packages/core/presentation.ts';
import { memoryContainsSecret } from '../packages/core/memory-publication.ts';
import { contextResultReadArgs, CONTEXT_RESULT_READ } from '../packages/core/context-result-tool.ts';
import type { SurfaceSpec } from '../packages/contracts/index.ts';

describe('inlineJson', () => {
  it('returns a deep copy of plain JSON values', () => {
    const input = { a: 1, b: [true, null, 'x'], c: { d: [1, 2] } };
    const result = inlineJson(input) as typeof input;
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.c).not.toBe(input.c);
    expect(result.b).not.toBe(input.b);
  });
  it.each([null, true, false, 0, -0, 3.5, -1e10, Number.MAX_SAFE_INTEGER, ''])('accepts scalar %j', value => {
    expect(inlineJson(value)).toEqual(value);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects non-finite number %s', value => {
    expect(() => inlineJson(value)).toThrowError('inline JSON');
  });
  it.each([undefined, Symbol('s'), () => 1, new Date(), new Map(), new Set(), /re/, BigInt(1)])('rejects non-JSON value %s', value => {
    expect(() => inlineJson(value)).toThrowError('requires inline JSON values');
  });
  it('rejects objects with a non-Object prototype, including null-prototype objects', () => {
    class C {}
    expect(() => inlineJson(new C())).toThrowError('requires inline JSON values');
    expect(() => inlineJson(Object.create(null))).toThrowError('requires inline JSON values');
  });
  it.each(['file:///etc/passwd', ' file:x', '\npackage:loader', 'PACKAGE:x', '\tFile:x'])('rejects external loader string %j', value => {
    expect(() => inlineJson(value)).toThrowError('external loaders');
    expect(() => inlineJson({ nested: [value] })).toThrowError('external loaders');
  });
  it('accepts strings that merely contain loader-looking text', () => {
    expect(inlineJson('read the file: docs')).toBe('read the file: docs');
    expect(inlineJson('a package: x')).toBe('a package: x');
  });
  it('accepts a 128 KiB string and rejects one byte over', () => {
    expect(inlineJson('x'.repeat(128 * 1024))).toHaveLength(128 * 1024);
    expect(() => inlineJson('x'.repeat(128 * 1024 + 1))).toThrowError('external loaders');
  });
  it('rejects nesting deeper than 20 levels', () => {
    let value: unknown = 1;
    for (let i = 0; i < 21; i++) value = [value];
    expect(() => inlineJson(value)).toThrowError('exceeds its bound');
  });
  it('rejects more than 10000 entries', () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 10001; i++) wide['k' + i] = i;
    expect(() => inlineJson(wide)).toThrowError('exceeds its bound');
  });
  it('rejects output larger than 1 MiB across many small strings', () => {
    const chunk = 'x'.repeat(120 * 1024);
    expect(() => inlineJson([chunk, chunk, chunk, chunk, chunk, chunk, chunk, chunk, chunk])).toThrowError('exceeds its bound');
  });
});

const spec = (): SurfaceSpec => ({
  root: 'root',
  elements: {
    root: { type: 'col', props: {}, children: ['a', 'b'] },
    a: { type: 'text', props: { text: 'A', stateKey: 'field1' } },
    b: { type: 'text', props: { text: 'B' } },
  },
});

describe('patchSpec', () => {
  it('applies replace, add and remove on object members', () => {
    const base = spec();
    const next = patchSpec(base, [
      { op: 'replace', path: '/elements/a/props/text', value: 'A2' },
      { op: 'add', path: '/elements/b/props/extra', value: 1 },
      { op: 'remove', path: '/elements/b/props/extra' },
    ]);
    expect(next.elements['a']!.props.text).toBe('A2');
    expect(next.elements['b']!.props.extra).toBeUndefined();
    expect(base.elements['a']!.props.text).toBe('A');
  });
  it('supports array index ops and the - append marker', () => {
    const next = patchSpec(spec(), [
      { op: 'add', path: '/elements/root/children/-', value: 'c' },
      { op: 'add', path: '/elements/root/children/0', value: 'z' },
      { op: 'remove', path: '/elements/root/children/1' },
    ]);
    expect(next.elements['root']!.children).toEqual(['z', 'b', 'c']);
  });
  it('unescapes JSON-pointer ~0 and ~1 in keys', () => {
    const base = spec();
    base.elements['x/y~z'] = { type: 't', props: { k: 0 } };
    const next = patchSpec(base, [{ op: 'replace', path: '/elements/x~1y~0z/props/k', value: 1 }]);
    expect(next.elements['x/y~z']!.props.k).toBe(1);
  });
  it.each([null, undefined, {}, 'x', 5])('rejects a non-array patch list %j', patches => {
    expect(() => patchSpec(spec(), patches)).toThrowError('array of at most 200');
  });
  it('rejects more than 200 patch operations', () => {
    const patches = Array.from({ length: 201 }, () => ({ op: 'add', path: '/elements/b/props/x', value: 1 }));
    expect(() => patchSpec(spec(), patches)).toThrowError('array of at most 200');
  });
  it.each([{ op: 'move', path: '/elements/a', value: 1 }, { op: 'add', path: '/other/x', value: 1 }, { op: 'add', path: 'elements/a', value: 1 }, { op: 'add' }])('rejects invalid patch %j', patch => {
    expect(() => patchSpec(spec(), [patch])).toThrowError('Unsupported patch operation or path');
  });
  it.each(['/elements/__proto__/x', '/elements/a/props/constructor', '/elements/a/props/prototype/p'])('rejects unsafe path %s', path => {
    expect(() => patchSpec(spec(), [{ op: 'replace', path, value: 1 }])).toThrowError('Unsafe patch path');
  });
  it('rejects missing or non-object parents and missing targets', () => {
    expect(() => patchSpec(spec(), [{ op: 'replace', path: '/elements/nope/x', value: 1 }])).toThrowError('parent does not exist');
    expect(() => patchSpec(spec(), [{ op: 'replace', path: '/elements/a/props/text/deep', value: 1 }])).toThrowError('parent does not exist');
    expect(() => patchSpec(spec(), [{ op: 'remove', path: '/elements/a/props/missing' }])).toThrowError('target does not exist');
    expect(() => patchSpec(spec(), [{ op: 'replace', path: '/elements/a/props/missing', value: 1 }])).toThrowError('target does not exist');
  });
  it('rejects invalid array indexes', () => {
    // remove/replace first require the key to exist
    expect(() => patchSpec(spec(), [{ op: 'remove', path: '/elements/root/children/2' }])).toThrowError('target does not exist');
    expect(() => patchSpec(spec(), [{ op: 'remove', path: '/elements/root/children/-1' }])).toThrowError('target does not exist');
    expect(() => patchSpec(spec(), [{ op: 'replace', path: '/elements/root/children/-', value: 'x' }])).toThrowError('target does not exist');
    expect(() => patchSpec(spec(), [{ op: 'remove', path: '/elements/root/children/1.5' }])).toThrowError('target does not exist');
    // add reaches the bounds check
    expect(() => patchSpec(spec(), [{ op: 'add', path: '/elements/root/children/1.5', value: 'x' }])).toThrowError('array index');
    expect(patchSpec(spec(), [{ op: 'add', path: '/elements/root/children/2', value: 'x' }]).elements['root']!.children).toEqual(['a', 'b', 'x']);
    expect(() => patchSpec(spec(), [{ op: 'add', path: '/elements/root/children/9', value: 'x' }])).toThrowError('array index');
    // '-' appends only for add
    expect(() => patchSpec(spec(), [{ op: 'remove', path: '/elements/root/children/-' }])).toThrowError('target does not exist');
  });
  it('replaces the root node', () => {
    const next = patchSpec(spec(), [{ op: 'replace', path: '/root', value: 'b' }]);
    expect(next.root).toBe('b');
  });
});

describe('protectedFingerprint', () => {
  it('returns "widget" for a null spec', () => {
    expect(protectedFingerprint(null, ['s'])).toBe('widget');
  });
  it('includes only stateKey-matched elements and their ancestors', () => {
    const fingerprint = JSON.parse(protectedFingerprint(spec(), ['field1']));
    expect(fingerprint.root).toBe('root');
    expect(fingerprint.nodes.map(([id]: [string]) => id).sort()).toEqual(['a', 'root']);
  });
  it('is insensitive to sibling changes outside the protected subtree', () => {
    const base = spec();
    const changed = spec();
    changed.elements['b']!.props.text = 'CHANGED';
    expect(protectedFingerprint(base, ['field1'])).toBe(protectedFingerprint(changed, ['field1']));
  });
  it('changes when a protected element changes', () => {
    const changed = spec();
    changed.elements['a']!.props.text = 'CHANGED';
    expect(protectedFingerprint(spec(), ['field1'])).not.toBe(protectedFingerprint(changed, ['field1']));
  });
  it('protects the transitive ancestor chain, not unrelated nodes', () => {
    const deep: SurfaceSpec = { root: 'r', elements: { r: { type: 'col', props: {}, children: ['m'] }, m: { type: 'col', props: {}, children: ['leaf'] }, leaf: { type: 't', props: { stateKey: 'k' } }, other: { type: 't', props: {} } } };
    const fingerprint = JSON.parse(protectedFingerprint(deep, ['k']));
    expect(fingerprint.nodes.map(([id]: [string]) => id).sort()).toEqual(['leaf', 'm', 'r']);
  });
  it('returns an empty protected set when no stateKey matches', () => {
    expect(JSON.parse(protectedFingerprint(spec(), ['nope'])).nodes).toEqual([]);
  });
});

describe('memoryContainsSecret', () => {
  it.each([
    'token: sk-' + 'a'.repeat(20),
    'key ghp_' + 'a1B2'.repeat(8),
    'github_pat_' + 'x'.repeat(30),
    'AIza' + 'y'.repeat(30),
    'AKIA' + 'Z'.repeat(16),
    '-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----',
    'api_key = "abcdef123456789"',
    'password: hunter2secret',
    'Authorization: Bearer ' + 't'.repeat(30),
    'jwt eyJ' + 'a'.repeat(10) + '.b.c',
  ])('detects secret-like content: %s', text => {
    expect(memoryContainsSecret(text)).toBe(true);
  });
  it.each([
    '',
    'an ordinary note about the project',
    'sk-short',
    'AKIA' + 'Z'.repeat(10),
    'bearer token discussion without a value',
    'password: 123',
    'api_key = short',
  ])('ignores non-secret content: %s', text => {
    expect(memoryContainsSecret(text)).toBe(false);
  });
});

describe('contextResultReadArgs / CONTEXT_RESULT_READ', () => {
  const valid = { handle: crypto.randomUUID(), offset: 0, length: 1 };
  it('accepts a minimal valid range', () => {
    expect(contextResultReadArgs.parse(valid)).toEqual(valid);
  });
  it('accepts the maximum length and a large offset', () => {
    expect(contextResultReadArgs.parse({ ...valid, offset: 5_000_000, length: 1024 * 1024 }).length).toBe(1024 * 1024);
  });
  it.each([
    { handle: 'not-a-uuid' },
    { offset: -1 },
    { offset: 1.5 },
    { length: 0 },
    { length: 1024 * 1024 + 1 },
    { length: 'x' },
    { extra: true },
  ])('rejects %j', patch => {
    expect(contextResultReadArgs.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it('rejects missing required fields', () => {
    expect(contextResultReadArgs.safeParse({}).success).toBe(false);
    expect(contextResultReadArgs.safeParse({ handle: valid.handle }).success).toBe(false);
  });
  it('exposes a tool name and a JSON-schema parameter document', () => {
    expect(CONTEXT_RESULT_READ.name).toBe('context_result_read');
    expect(CONTEXT_RESULT_READ.parameters).toMatchObject({ type: 'object' });
    expect(CONTEXT_RESULT_READ.description).toContain('bounded range');
  });
});
