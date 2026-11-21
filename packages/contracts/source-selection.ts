import {z} from 'zod';
import { Sha256Hex } from './hashing.ts';

/** Presentation and quoted context only. None of these references is a grant. */
export const WORKBENCH_LIMITS = Object.freeze({maxSourceRefs: 8, maxViewEntries: 64, maxSourceBytes: 1024 * 1024, maxSelectedBytes: 64 * 1024, maxPreviewBytes: 1024, maxCandidates: 100, maxQueuedInputs: 100, maxOutputMessages: 500, maxOutputBytes: 4 * 1024 * 1024, maxOutputRows: 100000});
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9:_.-]*$/);
const digest = Sha256Hex;
const revision = z.string().min(1).max(200);
const path = z.string().min(1).max(4096).refine(value => !/[\\:\0]/.test(value) && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'), 'Use a relative source path');
const pointer = z.string().max(4096).refine(value => value === '' || value.startsWith('/') && value.slice(1).split('/').every(part => !/~(?![01])/.test(part) && !['__proto__', 'prototype', 'constructor'].includes(part.replace(/~1/g, '/').replace(/~0/g, '~'))), 'Use a safe JSON pointer');

export const logicalOwnerV1Schema = z.strictObject({threadId: id, projectId: id.nullable(), workspaceId: id.nullable()});
export type LogicalOwnerV1 = z.infer<typeof logicalOwnerV1Schema>;
export function sameLogicalOwner(a: LogicalOwnerV1, b: LogicalOwnerV1): boolean {return a.threadId === b.threadId && a.projectId === b.projectId && a.workspaceId === b.workspaceId;}

const comparison = z.discriminatedUnion('kind', [z.strictObject({kind: z.literal('local'), scope: z.enum(['staged', 'worktree'])}), z.strictObject({kind: z.literal('pull-request'), number: z.number().int().positive()})]);
const messageLocator = {kind: z.literal('MESSAGE'), sourceId: id};
const fileLocator = {kind: z.literal('FILE_RANGE'), sourceId: id, path: path.optional()};
const diffLocator = {kind: z.literal('DIFF_HUNK'), sourceId: digest, path, comparison};
const artifactLocator = {kind: z.literal('ARTIFACT_REGION'), sourceId: id, binding: z.string().min(1).max(100)};
export const sourceLocatorV1Schema = z.discriminatedUnion('kind', [z.strictObject(messageLocator), z.strictObject(fileLocator), z.strictObject(diffLocator), z.strictObject(artifactLocator)]);
export type SourceLocatorV1 = z.infer<typeof sourceLocatorV1Schema>;

const common = {sourceRevision: revision, logicalOwner: logicalOwnerV1Schema, contentDigest: digest, capturedAt: z.string().datetime()};
/** Offsets count UTF-16 code units, start inclusive and end exclusive. The host
 * rejects boundaries inside surrogate pairs and checks the selected UTF-8 hash. */
const messageRange = z.strictObject({encoding: z.literal('UTF16'), start: z.number().int().nonnegative(), end: z.number().int().positive(), selectedTextDigest: digest}).refine(value => value.end > value.start, 'The selection must be nonempty');
const fileRange = z.strictObject({encoding: z.literal('LINES_1_BASED'), startLine: z.number().int().positive(), endLine: z.number().int().positive()}).refine(value => value.endLine >= value.startLine, 'Line ranges are inclusive and ordered');
const diffRange = z.strictObject({encoding: z.literal('DIFF_LINES_1_BASED'), startLine: z.number().int().positive(), endLine: z.number().int().positive()}).refine(value => value.endLine >= value.startLine, 'Select one complete diff hunk');
export const selectedSourceV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({...messageLocator, ...common, range: messageRange}),
  z.strictObject({...fileLocator, ...common, range: fileRange}),
  z.strictObject({...diffLocator, ...common, range: diffRange}),
  z.strictObject({...artifactLocator, ...common, range: z.strictObject({encoding: z.literal('JSON_POINTER'), pointer})}),
]);
export type SelectedSourceV1 = z.infer<typeof selectedSourceV1Schema>;
export const sourceRefV1Schema = z.strictObject({captureId: id, source: selectedSourceV1Schema, keepCaptured: z.boolean()});
export type SourceRefV1 = z.infer<typeof sourceRefV1Schema>;
export const sourceRefsV1Schema = z.array(sourceRefV1Schema).max(WORKBENCH_LIMITS.maxSourceRefs).refine(refs => new Set(refs.map(ref => ref.captureId)).size === refs.length, 'A captured source may appear only once');
export const sendModeV1Schema = z.enum(['NOW', 'AFTER_CURRENT']);
export type SendModeV1 = z.infer<typeof sendModeV1Schema>;
export const draftContextV1Schema = z.strictObject({draftId: id, logicalOwner: logicalOwnerV1Schema, revision: z.number().int().nonnegative(), text: z.string().max(100000), sourceRefs: sourceRefsV1Schema, sendMode: sendModeV1Schema, conflictState: z.enum(['NONE', 'CONFLICT', 'UNCERTAIN'])}).refine(value => value.sourceRefs.every(ref => sameLogicalOwner(value.logicalOwner, ref.source.logicalOwner)), 'Draft sources must belong to the destination owner');
export type DraftContextV1 = z.infer<typeof draftContextV1Schema>;
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
export const workbenchViewV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, revision: z.number().int().nonnegative(), viewType: z.enum(['CONVERSATION', 'SOURCES', 'EVIDENCE', 'RUN']), selectedItem: id.nullable(), scrollAnchor: z.strictObject({itemId: id, offset: coordinate}).nullable(), panelGeometry: z.strictObject({x: coordinate, y: coordinate, width: z.number().finite().min(120).max(8192), height: z.number().finite().min(80).max(8192)}).optional(), deviceId: id, updatedAt: z.string().datetime()});
export type WorkbenchViewV1 = z.infer<typeof workbenchViewV1Schema>;

export const sourceCandidateV1Schema = z.strictObject({locator: sourceLocatorV1Schema, label: z.string().min(1).max(300)});
export type SourceCandidateV1 = z.infer<typeof sourceCandidateV1Schema>;
export const sourceCapabilityV1Schema = z.strictObject({kind: z.enum(['MESSAGE', 'FILE_RANGE', 'DIFF_HUNK', 'ARTIFACT_REGION']), state: z.enum(['AVAILABLE', 'UNSUPPORTED']), reason: z.string().max(1000).nullable()});
export type SourceCapabilityV1 = z.infer<typeof sourceCapabilityV1Schema>;
export const sourceDescriptorV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, locator: sourceLocatorV1Schema, label: z.string().min(1).max(300), sourceRevision: revision, contentDigest: digest, text: z.string().max(WORKBENCH_LIMITS.maxSourceBytes)});
export type SourceDescriptorV1 = z.infer<typeof sourceDescriptorV1Schema>;
const captureFields = {ref: sourceRefV1Schema, label: z.string().min(1).max(300), preview: z.string().max(WORKBENCH_LIMITS.maxPreviewBytes), previewTruncated: z.boolean(), selectedBytes: z.number().int().nonnegative().max(WORKBENCH_LIMITS.maxSelectedBytes), retained: z.literal(true)};
export const capturedSourceV1Schema = z.strictObject({...captureFields, state: z.literal('CURRENT')});
export type CapturedSourceV1 = z.infer<typeof capturedSourceV1Schema>;
export const sourceOpenV1Schema = z.strictObject({...captureFields, state: z.enum(['CURRENT', 'STALE', 'UNAVAILABLE']), text: z.string().max(WORKBENCH_LIMITS.maxSelectedBytes)});
export type SourceOpenV1 = z.infer<typeof sourceOpenV1Schema>;
export const workbenchEvidenceItemV1Schema = z.strictObject({id: z.string().min(1).max(256), kind: z.enum(['REQUIREMENT', 'CHECK', 'ARTIFACT', 'CLAIM', 'SOURCE']), label: z.string().min(1).max(2000), grade: z.enum(['REPORTED', 'OBSERVED', 'VERIFIED']), freshness: z.enum(['CURRENT', 'STALE', 'UNKNOWN']), outcome: z.string().max(200).nullable(), sourceRevision: z.string().max(200).nullable(), command: z.array(z.string().max(4096)).max(64).nullable(), logRefs: z.array(z.string().max(1000)).max(64), screenshotRefs: z.array(z.string().max(1000)).max(64), sourceRef: sourceRefV1Schema.optional(), parentId: z.string().min(1).max(256).optional()});
export type WorkbenchEvidenceItemV1 = z.infer<typeof workbenchEvidenceItemV1Schema>;
export const workbenchModuleV1Schema = z.strictObject({id: z.enum(['M04', 'M05', 'M06', 'M08', 'M09', 'M10', 'M11', 'M14']), title: z.string().min(1).max(100), state: z.enum(['AVAILABLE', 'UNSUPPORTED', 'DISABLED', 'EMPTY']), reason: z.string().max(1000).nullable(), href: z.string().max(1000).nullable(), readOnly: z.literal(true)});
export type WorkbenchModuleV1 = z.infer<typeof workbenchModuleV1Schema>;
export const sourceDescribeRequestV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, locator: sourceLocatorV1Schema});
export const sourceCaptureRequestV1Schema = z.strictObject({commandId: id, source: selectedSourceV1Schema});
export const sourceOpenRequestV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, ref: sourceRefV1Schema});
export const sourceRefreshRequestV1Schema = sourceOpenRequestV1Schema.extend({commandId: id}).strict();
export const outputReadRequestV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, messageIds: z.array(id).min(1).max(WORKBENCH_LIMITS.maxOutputMessages).refine(ids => new Set(ids).size === ids.length, 'Activity identifiers must be unique'), sourceRevision: digest});
export const outputReadResultV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, sourceId: id, sourceRevision: digest, rows: z.array(z.strictObject({id: z.string().min(1).max(256), text: z.string().max(WORKBENCH_LIMITS.maxOutputBytes)})).max(WORKBENCH_LIMITS.maxOutputRows), complete: z.literal(true), trailingNewline: z.boolean().optional()});
export type WorkbenchOutputReadV1 = z.infer<typeof outputReadResultV1Schema>;

/** Recovery operates on an existing accepted input. The renderer cannot replace
 * its text, destination, source identities, or runtime delivery history. */
export const workbenchInputV1Schema = z.strictObject({inputId: id, state: z.enum(['QUEUED', 'BLOCKED']), sourceCount: z.number().int().min(1).max(WORKBENCH_LIMITS.maxSourceRefs), canKeepCaptured: z.boolean(), canCancel: z.boolean(), reason: z.string().max(1000).nullable(), sourceRefs: sourceRefsV1Schema.optional()});
export type WorkbenchInputV1 = z.infer<typeof workbenchInputV1Schema>;
export const workbenchInputsV1Schema = z.strictObject({logicalOwner: logicalOwnerV1Schema, inputs: z.array(workbenchInputV1Schema).max(WORKBENCH_LIMITS.maxQueuedInputs)});
export type WorkbenchInputsV1 = z.infer<typeof workbenchInputsV1Schema>;
export const workbenchInputRecoveryRequestV1Schema = z.strictObject({commandId: id, logicalOwner: logicalOwnerV1Schema, inputId: id, action: z.enum(['KEEP_CAPTURED', 'CANCEL'])});
export type WorkbenchInputRecoveryRequestV1 = z.infer<typeof workbenchInputRecoveryRequestV1Schema>;
export const workbenchInputRecoveryResultV1Schema = z.strictObject({inputId: id, action: z.enum(['KEEP_CAPTURED', 'CANCEL']), resumeRequired: z.boolean()});
export type WorkbenchInputRecoveryResultV1 = z.infer<typeof workbenchInputRecoveryResultV1Schema>;
