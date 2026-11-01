import { z } from 'zod';

const key = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const label = z.string().min(1).max(500);
const detail = z.string().max(2_000).optional();
const nodeId = z.string().min(1).max(200).regex(/^[^\s\u0000-\u001f]+$/);
export const workflowStatus = z.enum(['neutral', 'pending', 'running', 'success', 'error', 'merged']);
export const payloadFromState = z.record(key, key).refine(map => Object.keys(map).length <= 40, 'Map at most 40 saved fields').optional();
export const sourceCheck = z.strictObject({ label, status: workflowStatus, detail });
const sourceSummary = z.strictObject({ label, status: workflowStatus, detail });
// Source-bound records are validated again at render time; their status is never inferred
// from a label, an action click, or elapsed time.
export const relationshipData = z.strictObject({
  nodes: z.array(z.strictObject({
    id: nodeId, label, detail, status: workflowStatus.optional(), lane: z.number().int().min(0).max(7).optional(),
    column: z.number().int().min(0).max(20).optional(), kind: z.enum(['commit', 'point', 'endpoint']).optional(), tone: z.enum(['neutral', 'blue', 'teal', 'purple']).optional(),
    hash: z.string().max(80).optional(), author: z.string().max(120).optional(), time: z.string().max(100).optional(), branch: z.string().max(160).optional(),
    dimmed: z.boolean().optional(), conflictCount: z.number().int().min(0).max(10_000).optional(),
    excerpts: z.array(z.strictObject({ label, text: z.string().max(2_000) })).max(4).optional(),
    checks: z.array(sourceCheck).max(8).optional(),
  })).min(1).max(80),
  edges: z.array(z.strictObject({ from: nodeId, to: nodeId, label: detail, status: workflowStatus.optional(), prospective: z.boolean().optional() })).max(160),
  branchLabels: z.array(z.strictObject({ label, lane: z.number().int().min(0).max(7), column: z.number().int().min(0).max(20), tone: z.enum(['neutral', 'blue', 'teal', 'purple']).optional() })).max(16).optional(), tone: z.enum(['neutral', 'merged']).optional(),
  checks: z.array(sourceCheck).max(8).optional(), summary: sourceSummary.optional(), source: z.string().max(2_000).optional(),
}).superRefine((data, ctx) => {
  const ids = new Set(data.nodes.map(node => node.id));
  if (ids.size !== data.nodes.length) ctx.addIssue({ code: 'custom', message: 'Node identities must be unique' });
  if (data.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) ctx.addIssue({ code: 'custom', message: 'Every relationship must reference a source node' });
});
export type RelationshipData = z.infer<typeof relationshipData>;
export const disclosureData = z.strictObject({ status: z.enum(['idle', 'pending', 'ready', 'error']), answer: z.string().max(100_000).optional(), error: z.string().max(2_000).optional(), followupsPending: z.boolean().optional() });
export type DisclosureData = z.infer<typeof disclosureData>;
export const tableChangesData = z.strictObject({
  revision: z.number().int().nonnegative().optional(), activeRowId: nodeId.optional(),
  rows: z.array(z.strictObject({ id: nodeId, status: z.enum(['added', 'updated', 'removed']).optional(), cells: z.array(z.strictObject({ key, status: z.enum(['added', 'updated', 'removed']).optional(), before: z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]).optional(), detail })).max(40).optional() })).max(2_000),
}).refine(data => new Set(data.rows.map(row => row.id)).size === data.rows.length, 'Changed row identities must be unique');
export type TableChangesData = z.infer<typeof tableChangesData>;
export const tabStateData = z.strictObject({
  title: z.string().max(300).optional(), detail: z.string().max(500).optional(), status: workflowStatus.optional(),
  items: z.array(z.strictObject({ label: z.string().max(500), status: workflowStatus.optional(), detail: z.string().max(500).optional(), code: z.string().max(2_000).optional() })).max(20),
  footer: z.strictObject({ label: z.string().max(200), detail: z.string().max(500).optional(), code: z.string().max(2_000).optional() }).optional(),
});
export const mapData = z.strictObject({
  points: z.array(z.strictObject({ id: nodeId, label, x: z.number().min(0).max(100), y: z.number().min(0).max(100), detail, category: z.string().max(100).optional(), address: z.string().max(300).optional() })).min(1).max(60),
  routes: z.array(z.strictObject({ id: nodeId, pointIds: z.array(nodeId).min(2).max(60), label: z.string().max(300).optional() })).max(20).optional(),
  source: z.string().max(2_000).optional(),
}).superRefine((data, ctx) => {
  const ids = new Set(data.points.map(point => point.id));
  if (ids.size !== data.points.length) ctx.addIssue({ code: 'custom', message: 'Map point identities must be unique' });
  if (data.routes?.some(route => route.pointIds.some(id => !ids.has(id)))) ctx.addIssue({ code: 'custom', message: 'Every route point must reference a source point' });
  if (data.routes && new Set(data.routes.map(route => route.id)).size !== data.routes.length) ctx.addIssue({ code: 'custom', message: 'Map route identities must be unique' });
});
export type MapData = z.infer<typeof mapData>;
export const statusData = z.strictObject({ status: workflowStatus, label, detail });
export const operationStatusData = z.object({
  operationId: z.string().min(1).max(200), status: z.enum(['prepared', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']),
  kind: z.string().max(200).optional(), description: z.string().max(10_000).optional(),
  approved: z.boolean().optional(), result: z.unknown().optional(), error: z.string().nullable().optional(),
  message: z.string().optional(), progress: z.object({ message: z.string().optional() }).passthrough().optional(),
}).passthrough();
export const WORKFLOW_SCHEMAS = {
  ChoiceList: z.strictObject({ stateKey: key, label, options: z.array(z.strictObject({ value: key.or(z.string().min(1).max(500)), label, description: detail, detail, disabled: z.boolean().optional() })).min(1).max(50).refine(options => new Set(options.map(option => option.value)).size === options.length, 'Choice values must be unique'), custom: z.strictObject({ label, placeholder: z.string().max(500).optional() }).optional(), required: z.boolean().optional(), disabled: z.boolean().optional() }),
  Steps: z.strictObject({ stateKey: key, steps: z.array(z.strictObject({ key, label, description: detail })).min(1).max(12).refine(steps => new Set(steps.map(step => step.key)).size === steps.length, 'Step keys must be unique'), defaultStep: key.optional() }).refine(props => !props.defaultStep || props.steps.some(step => step.key === props.defaultStep), 'defaultStep must reference a stable step key'),
  RelationshipGraph: z.strictObject({ dataBinding: key.optional(), nodes: relationshipData.shape.nodes.optional(), edges: relationshipData.shape.edges.optional(), source: z.string().min(1).max(2_000).optional(), stateKey: key.optional(), label: label.optional(), orientation: z.enum(['vertical', 'horizontal']).optional() }).superRefine((props, ctx) => {
    if (props.dataBinding) {
      if (props.nodes || props.edges) ctx.addIssue({ code: 'custom', message: 'Use one source: a data binding or literal relationships' });
    } else if (!props.nodes || !props.edges || !props.source) ctx.addIssue({ code: 'custom', message: 'Literal relationships require nodes, edges and a source explanation' });
    else {
      const parsed = relationshipData.safeParse({ nodes: props.nodes, edges: props.edges });
      if (!parsed.success) ctx.addIssue({ code: 'custom', message: parsed.error.message });
    }
  }),
  MapView: z.strictObject({ dataBinding: key, stateKey: key, themeStateKey: key.optional(), label: label.optional(), feedbackActionId: key.optional(), payload: z.record(key, z.unknown()).optional(), payloadFromState }),
  Status: z.strictObject({ label: label.optional(), detail, status: workflowStatus.optional(), dataBinding: key.optional(), presentation: z.enum(['inline', 'receipt']).optional() }).refine(props => Boolean(props.dataBinding) || Boolean(props.label && props.status), 'Provide a source binding or an explicit status and label'),
};
export const WORKFLOW_EXAMPLES: Record<keyof typeof WORKFLOW_SCHEMAS, Record<string, unknown>> = {
  ChoiceList: { stateKey: 'deliveryMethod', label: 'How should this be delivered?', options: [{ value: 'email', label: 'Email', description: 'Send to the selected address' }, { value: 'download', label: 'Download' }] },
  Steps: { stateKey: 'currentStep', steps: [{ key: 'details', label: 'Details' }, { key: 'confirm', label: 'Confirm' }], defaultStep: 'details' },
  RelationshipGraph: { dataBinding: 'relationships', stateKey: 'selectedNode', label: 'Branch review', orientation: 'vertical' },
  MapView: { dataBinding: 'places', stateKey: 'selectedPlace', themeStateKey: 'mapTheme', label: 'Places along the route', feedbackActionId: 'requestFeedback', payloadFromState: { note: 'feedbackNote' } },
  Status: { dataBinding: 'operationStatus' },
};
