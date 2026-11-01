import Ajv from "ajv";
import { HarnessError, type WidgetDefinition } from "../contracts/index.ts";
import { createHash } from "node:crypto";
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
// Enable only after storage, startup, and browser responsiveness gates pass.
export const GENERATED_APPS_ENABLED = false;
function compileSchema(schema: Record<string, unknown>) {
  if (JSON.stringify(schema).length > 16384) throw new HarnessError("INVALID_SCHEMA", "Schema exceeds the supported size");
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (!value || typeof value !== "object") return;
    if (++nodes > 200 || depth > 12) throw new HarnessError("INVALID_SCHEMA", "Schema exceeds the supported complexity");
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === '$async') throw new HarnessError('INVALID_SCHEMA', 'Only synchronous schemas are supported');
      if (["$ref", "$dynamicRef", "pattern", "patternProperties", "__proto__", "constructor", "prototype"].includes(key)) throw new HarnessError("INVALID_SCHEMA", "References, regex validation and prototype keys are unsupported; use bounded values or enums");
      visit(child, depth + 1);
    }
  }
  visit(schema, 0);
  try {
    const validate = ajv.compile(schema);
    if ('$async' in validate && validate.$async) throw new Error('Asynchronous validator');
    return validate;
  } catch { throw new HarnessError("INVALID_SCHEMA", "The supplied schema is not supported"); }
  finally { ajv.removeSchema(); }
}
export function admitSchema(schema: Record<string, unknown>): void { compileSchema(schema); }
export function validateJson(schema: Record<string, unknown>, value: unknown): void {
  try {
    const validate = compileSchema(schema), valid = validate(value);
    if (typeof valid !== 'boolean') { void Promise.resolve(valid).catch(() => {}); throw new HarnessError('INVALID_SCHEMA', 'Only synchronous validation is supported'); }
    if (!valid) throw new HarnessError("INVALID_INPUT", "Input does not match its declared schema", validate.errors?.map(e => ({ path: e.instancePath, message: e.message })));
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INVALID_SCHEMA", "The supplied schema is not supported");
  }
}
export function widgetDefinition(args: Record<string, unknown>): WidgetDefinition {
  if (typeof args.html !== "string" || !args.html.trim() || Buffer.byteLength(args.html) > 128 * 1024) throw new HarnessError("INVALID_SPEC", "Widget HTML must be nonempty and at most 128 KiB");
  for (const name of ["inputSchema", "eventSchema", "stateSchema"]) {
    if (!args[name] || typeof args[name] !== "object" || Array.isArray(args[name])) throw new HarnessError("INVALID_SCHEMA", "Declare inputSchema, eventSchema and stateSchema");
    admitSchema(args[name] as Record<string, unknown>);
  }
  return { html: args.html, hash: createHash("sha256").update(args.html).digest("hex"), inputSchema: args.inputSchema as Record<string, unknown>, eventSchema: args.eventSchema as Record<string, unknown>, stateSchema: args.stateSchema as Record<string, unknown>, stateSchemaVersion: Number(args.stateSchemaVersion ?? 1) };
}
