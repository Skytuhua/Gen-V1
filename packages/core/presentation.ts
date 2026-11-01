import { HarnessError, type SurfaceSpec } from "../contracts/index.ts";
export function patchSpec(base: SurfaceSpec, patches: unknown): SurfaceSpec {
  if (!Array.isArray(patches) || patches.length > 200) throw new HarnessError("INVALID_SPEC", "Patches must be an array of at most 200 operations");
  const next = structuredClone(base);
  for (const item of patches) {
    if (!item || !["add", "remove", "replace"].includes(item.op) || typeof item.path !== "string" || !/^\/(elements|root)(\/|$)/.test(item.path)) throw new HarnessError("INVALID_SPEC", "Unsupported patch operation or path");
    const keys = item.path.slice(1).split("/").map((x: string) => x.replace(/~1/g, "/").replace(/~0/g, "~"));
    if (keys.some((key: string) => ["__proto__", "constructor", "prototype"].includes(key))) throw new HarnessError("INVALID_SPEC", "Unsafe patch path");
    let parent: Record<string, unknown> | unknown[] = next as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || !parent[key as keyof typeof parent] || typeof parent[key as keyof typeof parent] !== "object") throw new HarnessError("INVALID_SPEC", "Patch parent does not exist");
      parent = parent[key as keyof typeof parent] as Record<string, unknown>;
    }
    const key = keys.at(-1)!;
    if (item.op !== "add" && !Object.hasOwn(parent, key)) throw new HarnessError("INVALID_SPEC", "Patch target does not exist");
    if (Array.isArray(parent)) {
      const index = key === "-" && item.op === "add" ? parent.length : Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index > parent.length || item.op !== "add" && index >= parent.length) throw new HarnessError("INVALID_SPEC", "Invalid patch array index");
      if (item.op === "add") parent.splice(index, 0, structuredClone(item.value));
      else if (item.op === "remove") parent.splice(index, 1);
      else parent[index] = structuredClone(item.value);
    } else if (item.op === "remove") delete parent[key];
    else parent[key] = structuredClone(item.value);
  }
  return next;
}
export function protectedFingerprint(spec: SurfaceSpec | null, fields: string[]): string {
  if (!spec) return "widget";
  const protectedIds = new Set(Object.entries(spec.elements).filter(([, node]) => typeof node.props.stateKey === "string" && fields.includes(node.props.stateKey)).map(([id]) => id));
  let changed = true;
  while (changed) { changed = false; for (const [id, node] of Object.entries(spec.elements)) if (!protectedIds.has(id) && node.children?.some(child => protectedIds.has(child))) { protectedIds.add(id); changed = true; } }
  return JSON.stringify({ root: spec.root, nodes: [...protectedIds].sort().map(id => [id, spec.elements[id]]) });
}
