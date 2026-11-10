export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
type ErrorCode = 'invalid_json_type' | 'wire_limit' | 'invalid_utf8' | 'invalid_json' |
  'integer_token' | 'unsafe_integer' | 'duplicate_key' | 'invalid_unicode' |
  'depth_limit' | 'fields' | 'text_limit' | 'audience';

export class CommunicationContractError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'CommunicationContractError'; }
}
const fail = (code: ErrorCode): never => { throw new CommunicationContractError(code); };
const encoder = new TextEncoder();

function unicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('invalid_unicode');
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('invalid_unicode');
  }
}

/** Strict raw input is required: JSON.parse alone erases duplicates and numeric lexemes. */
export function decodeBoundedJson(raw: Uint8Array, maximum: 32768 | 262144): JsonValue {
  if (maximum !== 32768 && maximum !== 262144) fail('invalid_json_type');
  if (!(raw instanceof Uint8Array)) fail('invalid_json_type');
  if (raw.byteLength > maximum) fail('wire_limit');
  let source: string;
  try { source = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(raw); }
  catch { return fail('invalid_utf8'); }
  let at = 0;
  const whitespace = () => { while (at < source.length && ' \t\r\n'.includes(source[at])) at++; };
  function string(depth: number): string {
    if (depth > 64) fail('depth_limit');
    const start = at++;
    while (at < source.length) {
      const char = source[at++];
      if (char === '"') {
        let value: string;
        try { value = JSON.parse(source.slice(start, at)) as string; }
        catch { return fail('invalid_json'); }
        unicode(value);
        return value;
      }
      if (char === '\\') at++;
    }
    return fail('invalid_json');
  }
  function value(depth: number): JsonValue {
    if (depth > 64) fail('depth_limit');
    whitespace();
    const char = source[at];
    if (char === '"') return string(depth);
    if (char === '{') {
      at++; whitespace();
      const object: {[key: string]: JsonValue} = Object.create(null);
      if (source[at] === '}') { at++; return object; }
      while (true) {
        if (source[at] !== '"') fail('invalid_json');
        const key = string(depth + 1);
        if (Object.hasOwn(object, key)) fail('duplicate_key');
        whitespace(); if (source[at++] !== ':') fail('invalid_json');
        object[key] = value(depth + 1);
        whitespace();
        const separator = source[at++];
        if (separator === '}') return object;
        if (separator !== ',') fail('invalid_json');
        whitespace();
      }
    }
    if (char === '[') {
      at++; whitespace();
      const array: JsonValue[] = [];
      if (source[at] === ']') { at++; return array; }
      while (true) {
        array.push(value(depth + 1)); whitespace();
        const separator = source[at++];
        if (separator === ']') return array;
        if (separator !== ',') fail('invalid_json');
      }
    }
    for (const token of ['true', 'false', 'null'] as const) {
      if (source.startsWith(token, at)) { at += token.length; return JSON.parse(token) as JsonValue; }
    }
    if (['NaN', 'Infinity', '-Infinity'].some(token => source.startsWith(token, at))) fail('integer_token');
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(at))?.[0];
    if (!token) return fail('invalid_json');
    at += token.length;
    if (token === '-0' || /[.eE]/.test(token)) fail('integer_token');
    const number = Number(token);
    if (!Number.isSafeInteger(number)) fail('unsafe_integer');
    return number;
  }
  const decoded = value(0); whitespace();
  if (at !== source.length) fail('invalid_json');
  return decoded;
}

/** Separate from legacy/planning canonicalization; input must already be JSON data. */
export function canonicalBytes(value: unknown): Uint8Array<ArrayBuffer> {
  function emit(item: unknown, depth: number): string {
    if (depth > 64) fail('depth_limit');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') { unicode(item); return JSON.stringify(item); }
    if (typeof item === 'number') {
      if (Object.is(item, -0) || !Number.isInteger(item)) fail('integer_token');
      if (!Number.isSafeInteger(item)) fail('unsafe_integer');
      return String(item);
    }
    if (typeof item !== 'object' || item === null) return fail('invalid_json_type');
    const prototype: unknown = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== null && prototype !== Object.prototype) fail('invalid_json_type');
    if (Object.getOwnPropertySymbols(item).length) fail('invalid_json_type');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail('invalid_json_type');
    }
    if (Array.isArray(item)) {
      if (Object.keys(descriptors).length !== item.length + 1) fail('invalid_json_type');
      const parts: string[] = [];
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(descriptors, String(i))) fail('invalid_json_type');
        parts.push(emit(descriptors[String(i)].value, depth + 1));
      }
      return '[' + parts.join(',') + ']';
    }
    return '{' + Object.keys(descriptors).sort().map(key =>
      emit(key, depth + 1) + ':' + emit(descriptors[key].value, depth + 1),
    ).join(',') + '}';
  }
  return encoder.encode(emit(value, 0));
}

