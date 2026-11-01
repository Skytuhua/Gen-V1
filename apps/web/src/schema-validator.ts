import Ajv, { type ValidateFunction } from 'ajv';

const engines = [new Ajv({ strict: false, validateFormats: false }), new Ajv({ strict: false })];
const validators = new Map<string, ValidateFunction>();
const capacity = 64;

/** Snapshot identity is transient. Retain at most 64 validators by JSON content,
 * and release Ajv's own schema registry so it cannot retain evicted snapshots. */
export function validateSchema(schema: Record<string, unknown>, value: unknown, validateFormats = true) {
  if (schema.$async) throw new Error('Only synchronous response schemas are supported.');
  const serialized = JSON.stringify(schema), key = `${Number(validateFormats)}:${serialized}`;
  let validate = validators.get(key);
  if (validate) validators.delete(key);
  else {
    const engine = engines[Number(validateFormats)];
    // Compile the content represented by the key, independent of later caller edits.
    try { validate = engine.compile(JSON.parse(serialized)); }
    finally { engine.removeSchema(); }
    if (validators.size === capacity) validators.delete(validators.keys().next().value!);
  }
  validators.set(key, validate);
  const result: unknown = validate(value);
  if (typeof result !== 'boolean') {
    validators.delete(key);
    if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
    throw new Error('Only synchronous response schemas are supported.');
  }
  return result;
}
