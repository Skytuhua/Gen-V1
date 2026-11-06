import { z } from "zod";
import { HarnessError, type Capability } from "../contracts/index.ts";
import { WORKFLOW_SCHEMAS, WORKFLOW_EXAMPLES, payloadFromState } from './workflow.ts';
import { DOCUMENT_SCHEMAS, DOCUMENT_EXAMPLES } from './documents.ts';
import {IMAGE_COMPARE_SCHEMAS,IMAGE_COMPARE_EXAMPLES,IMAGE_COMPARE_DESCRIPTIONS} from './image-compare.ts';
import {EVERYDAY_SCHEMAS,EVERYDAY_EXAMPLES,EVERYDAY_DESCRIPTIONS,EVERYDAY_DATA_SCHEMAS} from './everyday.ts';
import {INTERACTION_SCHEMAS,INTERACTION_EXAMPLES,INTERACTION_DESCRIPTIONS,INTERACTION_DATA_SCHEMAS} from './interactions.ts';
import {EXPLORATION_SCHEMAS,EXPLORATION_EXAMPLES,EXPLORATION_DESCRIPTIONS} from './exploration.ts';
import { WORK_OBJECT_SCHEMAS, WORK_OBJECT_EXAMPLES, WORK_OBJECT_DESCRIPTIONS } from './work-objects.ts';
export { WORK_OBJECT_PACK } from './work-objects.ts';
export {EXPLORATION_PACK} from './exploration.ts';
export const INTERACTION_PACK={dataSchemas:Object.fromEntries(Object.entries(INTERACTION_DATA_SCHEMAS).map(([name,schema])=>[name,z.toJSONSchema(schema)]))};
export const EVERYDAY_PACK={dataSchemas:Object.fromEntries(Object.entries(EVERYDAY_DATA_SCHEMAS).map(([name,schema])=>[name,z.toJSONSchema(schema)]))};
import {SOFTWARE_SCHEMAS,SOFTWARE_EXAMPLES,SOFTWARE_DESCRIPTIONS,SOFTWARE_DISCOVERY,SOFTWARE_DATA_SCHEMAS} from './software-development.ts';
export const SOFTWARE_DEVELOPMENT_PACK={...SOFTWARE_DISCOVERY,dataSchemas:Object.fromEntries(Object.entries(SOFTWARE_DATA_SCHEMAS).map(([name,schema])=>[name,z.toJSONSchema(schema)]))};
export const CATALOG_VERSION = "1.0.0";
export const SURFACE_LIMITS = Object.freeze({ nodes: 200, depth: 12, bytes: 128 * 1024 });
const text = z.string().max(100_000);
const key = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(s => !["__proto__", "prototype", "constructor"].includes(s));
const opaqueId = z.string().min(1).max(200);
const gap = z.enum(["none", "xs", "sm", "md", "lg"]).optional();
const binding = key.optional();
const optionalText = text.optional();
const column = z.strictObject({ key, label: text });
// All strings are literal content. The trusted renderer must never eval strings or render raw HTML.
const schemas = {
  ...WORKFLOW_SCHEMAS,
  ...DOCUMENT_SCHEMAS,
  ...SOFTWARE_SCHEMAS,
  ...IMAGE_COMPARE_SCHEMAS,
  ...EVERYDAY_SCHEMAS,
  ...INTERACTION_SCHEMAS,
  ...EXPLORATION_SCHEMAS,
  ...WORK_OBJECT_SCHEMAS,
  Stack: z.strictObject({ gap, align: z.enum(["start", "center", "end", "stretch"]).optional(), scroll: z.literal('bounded').optional(), label: z.string().max(500).optional() }),
  Grid: z.strictObject({ columns: z.number().int().min(1).max(6).optional(), gap }),
  Split: z.strictObject({ ratio: z.number().min(0.1).max(0.9).optional(), gap }),
  Tabs: z.strictObject({ labels: z.array(text).min(1).max(20).meta({ uniqueItems: true }), stateKey: key, statusBinding: binding }),
  Panel: z.strictObject({ title: optionalText, description: optionalText, align: z.enum(['start', 'center']).optional() }),
  Disclosure: z.strictObject({ title: text, text: optionalText, stateKey: key, defaultOpen: z.boolean().optional(), dataBinding: binding, onOpenActionId: key.optional(), payload: z.record(key, z.unknown()).optional(), payloadFromState }),
  Text: z.strictObject({ text, tone: z.enum(["default", "muted", "success", "warning", "danger"]).optional(), size: z.enum(["sm", "md", "lg"]).optional() }),
  Markdown: z.strictObject({ text: optionalText, dataBinding: binding }),
  EvidenceList: z.strictObject({ rowsBinding: key, title: optionalText }),
  Metric: z.strictObject({ label: text, value: z.union([text, z.number().finite()]).optional(), dataBinding: binding, unit: optionalText }),
  Progress: z.strictObject({ value: z.number().finite().min(0).optional(), max: z.number().positive().optional(), label: optionalText, dataBinding: binding }),
  Timeline: z.strictObject({ rowsBinding: key }),
  Table: z.strictObject({ rowsBinding: key, columns: z.array(column).min(1).max(40), caption: optionalText, stateKey: key.optional(), rowKey: key.optional(), changesBinding: binding }),
  Chart: z.strictObject({ rowsBinding: key, kind: z.enum(["bar", "line", "scatter"]), xKey: key, yKey: key, title: optionalText }),
  Tree: z.strictObject({ rowsBinding: key }),
  Form: z.strictObject({ title: optionalText, actionId: key, submitLabel: z.string().max(200).optional(), payload: z.record(key, z.unknown()).optional(), payloadFromState, clearOnSuccess: z.array(key).max(40).optional() }),
  Input: z.strictObject({ stateKey: key, label: text, inputType: z.enum(["text", "number", "email", "date", "textarea"]).optional(), placeholder: optionalText, required: z.boolean().optional() }),
  Select: z.strictObject({ stateKey: key, label: text, options: z.array(z.strictObject({ label: text, value: text })).min(1).max(200) }),
  Toggle: z.strictObject({ stateKey: key, label: text }),
  Button: z.strictObject({ label: text, actionId: key, disabled: z.boolean().optional(), tone: z.enum(["default", "primary", "danger"]).optional(), payload: z.record(key, z.unknown()).optional(), payloadFromState }),
  Code: z.strictObject({ code: optionalText, language: z.string().max(40).optional(), dataBinding: binding }),
  Diff: z.strictObject({ before: optionalText, after: optionalText, language: z.string().max(40).optional(), dataBinding: binding }),
  Document: z.strictObject({ text: optionalText, dataBinding: binding, resourceId: opaqueId.optional(), resourcePath: z.string().min(1).max(1024).refine(path => !/[\u0000-\u001f:]/.test(path) && !/^[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)).optional(), title: optionalText, linkLabel: z.string().max(200).optional(), download: z.boolean().optional(), presentation: z.enum(['inline','window']).optional(), editableStateKey: key.optional() }).refine(value => !value.editableStateKey || value.presentation === 'window', 'Editable documents use window presentation'),
  Image: z.strictObject({ src: z.string().max(2048).refine(s => {
    try { const url = new URL(s); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !/[\u0000-\u0020\\]/.test(s); } catch { return false; }
  }, "Only safe HTTP(S) image URLs are allowed").optional(), resourceId: opaqueId.optional(), alt: text }),
} satisfies Record<string, z.ZodType>;
export type ComponentName = keyof typeof schemas;
const examples: Record<ComponentName, Record<string, unknown>> = {
  ...WORKFLOW_EXAMPLES,
  ...DOCUMENT_EXAMPLES,
  ...SOFTWARE_EXAMPLES,
  ...IMAGE_COMPARE_EXAMPLES,
  ...EVERYDAY_EXAMPLES,
  ...INTERACTION_EXAMPLES,
  ...EXPLORATION_EXAMPLES,
  ...WORK_OBJECT_EXAMPLES,
  Stack: { gap: "md" }, Grid: { columns: 2 }, Split: { ratio: 0.5 }, Tabs: { labels: ["Evidence", "Plan"], stateKey: "tab" }, Panel: { title: "Evidence" }, Disclosure: { title: "Can this be split across destinations?", stateKey: "deliveryOpen", dataBinding: "deliveryAnswer", onOpenActionId: "explainDelivery", payload: { topic: "splitDelivery" } },
  Text: { text: "Source-backed result" }, Markdown: { text: "## Evidence" }, EvidenceList: { rowsBinding: "evidence" }, Metric: { label: "Rows", dataBinding: "count" },
  Progress: { value: 2, max: 4, label: "Executed steps" }, Timeline: { rowsBinding: "events" }, Table: { rowsBinding: "rows", columns: [{ key: "title", label: "Title" }], changesBinding: "rowChanges", rowKey: "id" },
  Chart: { rowsBinding: "rows", kind: "bar", xKey: "label", yKey: "count" }, Tree: { rowsBinding: "nodes" }, Form: { title: "Review", actionId: "submit", submitLabel: "Confirm", payloadFromState: { email: "email" } },
  Input: { stateKey: "name", label: "Name" }, Select: { stateKey: "choice", label: "Choice", options: [{ label: "One", value: "one" }] }, Toggle: { stateKey: "accepted", label: "Accept" },
  Button: { label: "Continue", actionId: "continue", payloadFromState: { choice: "deliveryMethod" } }, Code: { code: "const n = 1;", language: "javascript" }, Diff: { before: "old", after: "new" }, Document: { dataBinding: "document", title: "Draft" }, Image: { resourceId: "image", alt: "Granted image" },
};
const layouts = new Set<string>(["Stack", "Grid", "Split", "Tabs", "Panel", "Disclosure", "Form", "Steps", "RelationshipGraph"]);
const descriptions: Partial<Record<ComponentName, string>> = {
  ...SOFTWARE_DESCRIPTIONS,
  ...IMAGE_COMPARE_DESCRIPTIONS,
  ...EVERYDAY_DESCRIPTIONS,
  ...INTERACTION_DESCRIPTIONS,
  ...EXPLORATION_DESCRIPTIONS,
  ...WORK_OBJECT_DESCRIPTIONS,
  Stack: 'A vertical composition of trusted components. gap controls spacing; align controls cross-axis placement. Inline history grows with the chat, which owns scrolling. scroll:"bounded" only bounds explicitly expanded/workspace history. Put the question Form in a sibling Stack to preserve its focus and state. Compose different source-bound questions, explanations, maps or controls through the same registry rather than selecting a fixed scenario screen.',
  Disclosure: 'A concise independent question with a retained answer and nested child questions. Multiple roots and branches may remain open. Bind {status: idle|pending|ready|error, answer?, error?, followupsPending?} through dataBinding; onOpenActionId requests missing content once while pending. Opening is immediate and local. Stream actual answer text; followupsPending shows a separate skeleton while a related question is being prepared. Patch child elements without replacing older branches. Use a sibling Form + Input for a durable new root question, with payloadFromState and clearOnSuccess. Answer first in plain everyday words and one to three short sentences. Prefer concrete examples to formulas. Keep source, calculation and signature-method detail under a closed Details disclosure; show action consequences and decision-blocking facts beside their controls. Retain saved answer text and state unless the user requests a revision.',
  RelationshipGraph: 'Source-bound relationships with distinct vertical commit rows or horizontal branch lanes. For schematic branches supply stable node.column values and lane identity; kind:point makes a small intermediate commit, kind:endpoint makes a compact merge endpoint. Optional node.tone retains branch identity independently of status. Edges may be prospective. Data may include branchLabels, checks, summary and merged tone. Hover/focus exposes hashes, metadata and paired conflict excerpts. Optional children are contextual footer controls displayed beside the summary, not a second report. Use compact presentation for commit review. All status comes from source evidence, never clicks or elapsed time.',
  ChoiceList: 'One contextual question with compact choices. Optional custom:{label,placeholder?} replaces its last choice with an inline input when selected, writing the same durable stateKey. Restore custom values without a second permanent field. Use short choice labels and detail for secondary information.',
  DocumentPreview: 'A persistent PDF canvas paired with contextual controls. Bound fields update immediately while a canonical draft is prepared. Use width fit for editing and fit:page for a completed whole-document review. Keep the same resource, field bindings and component identity during local edits and navigation. exportOperationId permits continuous handoff only to that same-thread approved successful PDF export with matching source/destination grants and byte hashes. Place a concise source-backed Status receipt and granted Document download beside the completed page.',
  SignaturePad: 'One stable signature well shared by Generate, Draw and Upload. nameStateKey supplies the known signer name; Edit name and Another style are contextual controls. Multi-stroke marks and saved bounded PNG resources use the same durable state and approved export path. No certificate-signature claim.',
  Document: 'Prepared text or a granted source document. presentation:window shows a local Open document control and opens the actual declared text/dataBinding or granted UTF-8 text resource beside chat. editableStateKey retains a durable draft in that artifact; editing never writes the source file or delivers it. A new source does not overwrite edits. Keep export/delivery a separately approved operation. Use concise linkLabel such as Open handoff. Default inline and granted PDF downloads remain compatible.',
  Tabs: 'Mounted tab panels with durable selection and keyboard navigation. Requires unique labels using exact string equality; the selected label is the durable identity. Optional statusBinding names validated source metadata {title?,detail?,status?,items:[{label,status?,detail?,code?}],footer?:{label,detail?,code?}} for a persistent operation header, per-tab checks and compact SQL/result footer. This is display metadata; it never establishes execution or changes the selected tab.',
  Status: 'A concise explicit or source-bound operation status. presentation:receipt centers a success receipt for completed document/task handoff; source details remain inspectable. Use actual operation results for completion. Do not expose hashes or long raw receipts in the initial view.',
  Table: 'A source-bound grid with a stable header; inline rows grow with chat instead of trapping scroll. rowsBinding supplies row values; rowKey defaults to id. Optional changesBinding supplies {revision?,activeRowId?,rows:[{id,status?,cells:[{key,status?,before?,detail?}]}]} with added/updated/removed metadata; it highlights accepted changes; inline changes never move the chat. Explicit bounded views may follow active rows until manual scrolling. Use Tabs around sibling Tables for migration phases; preserve every completed tab for inspection. Table metadata never changes row data or proves a database operation.',
  MapView: 'A trusted local vector map, linked point carousel and selected-place detail in one reusable view. Bind {points:[{id,label,x,y,detail?,category?,address?}],routes?:[{id,pointIds,label?}],source?}; x/y are bounded 0..100 coordinates on a schematic local plan. Show the place identity first; secondary addresses/descriptions are behind Place details. Supply only task-relevant sourced facts, never generic filler or invented street labels. No external tile/provider URLs or geographic accuracy are implied. stateKey synchronizes point and detail selection; themeStateKey retains paper/terrain/night choice without losing selection. Optional feedbackActionId sends a registered action with pointId and mapped payload; the UI acknowledges only the request.',
  Form: 'A durable action form for task decisions or a new question, composed from Input, ChoiceList and other controls. actionId must name an artifact action; payloadFromState maps saved fields. clearOnSuccess optionally clears only submitted fields that have not been edited again. Keeps controls mounted and focus stable, suppresses IME Enter submission and duplicates while pending. Successful submission is action acceptance, not proof of an external effect.',
  Steps: 'One current task question with stable keyed panels. Navigation retains all child controls mounted and saves the current step to stateKey. Use for a short decision sequence beside a document or other persistent artifact; defaultStep must match a stable step key. Navigation is local and is never evidence that a task completed.',
};
export const CAPABILITIES: Capability[] = Object.entries(schemas).map(([name, schema]) => ({
  name, category: layouts.has(name) ? "layout" : ["Input", "Select", "Toggle", "Button", "ChoiceList"].includes(name) ? "control" : "content",
  description: descriptions[name as ComponentName] ?? `${name}: trusted declarative component; bindings name artifact-local inputs, stateKey names persistent user state, actionId names an artifact action.`,
  props: z.toJSONSchema(schema) as Record<string, unknown>, example: examples[name as ComponentName],
}));
const element = z.strictObject({ type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()).max(200).optional() });
const surface = z.strictObject({ root: z.string(), elements: z.record(z.string(), element) });
export function validateSurface(spec: unknown): void {
  try {
    const encoded = JSON.stringify(spec);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > SURFACE_LIMITS.bytes) throw new Error("Surface exceeds 128 KiB");
    const parsed = surface.parse(spec), ids = Object.keys(parsed.elements);
    if (!ids.length || ids.length > SURFACE_LIMITS.nodes) throw new Error("Surface must have 1 to 200 nodes");
    if (!Object.hasOwn(parsed.elements, parsed.root)) throw new Error("Missing root");
    for (const id of ids) {
      if (["__proto__", "prototype", "constructor"].includes(id)) throw new Error("Unsafe element id");
      const node = parsed.elements[id];
      if (!Object.hasOwn(schemas, node.type)) throw new Error(`Unknown component ${node.type}`);
      schemas[node.type as ComponentName].parse(node.props);
      if (node.type === "Tabs" && new Set(node.props.labels as string[]).size !== (node.props.labels as string[]).length) throw new Error("Tabs labels must be unique");
      if (node.children?.length && !layouts.has(node.type)) throw new Error(`${node.type} cannot have children`);
      if (node.type === "Tabs" && node.children?.length && node.children.length !== (node.props.labels as string[]).length) throw new Error("Tabs labels and children must match");
      if (node.type === "Steps" && node.children?.length && node.children.length !== (node.props.steps as unknown[]).length) throw new Error("Steps and child panels must match");
      for (const child of node.children ?? []) if (!Object.hasOwn(parsed.elements, child)) throw new Error(`Dangling reference ${child}`);
    }
    const active = new Set<string>(), heights = new Map<string, number>();
    function height(id: string): number {
      if (active.has(id)) throw new Error("Surface graph contains a cycle");
      const known = heights.get(id); if (known !== undefined) return known;
      active.add(id);
      const depth = 1 + Math.max(0, ...(parsed.elements[id].children ?? []).map(height));
      active.delete(id); if (depth > SURFACE_LIMITS.depth) throw new Error("Surface exceeds depth 12");
      heights.set(id, depth); return depth;
    }
    // Validate every component, including disconnected graphs; reject unreachable content.
    height(parsed.root);
    const reachable = new Set(heights.keys());
    for (const id of ids) height(id);
    if (reachable.size !== ids.length) throw new Error("Surface contains unreachable elements");
  } catch (error) {
    throw new HarnessError("INVALID_SURFACE", error instanceof Error ? error.message : "Invalid surface");
  }
}
