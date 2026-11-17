import {z} from 'zod';
import {verificationPrepareSchema} from '../contracts/verification-workflow.ts';
import type {ToolMetadata} from '../runtime-pi/tool-definitions.ts';

export const VERIFICATION_PREPARE: ToolMetadata = {
  name: 'verification_prepare',
  description: 'Prepare one exact project verification recipe for ordinary user operation approval. Supply a host-registered profileId, typed executable IDs/argv phases, relative source and dependency files, requirement checks by phase or checklistItemId, and an optional strict browser checklist with owned START/READINESS. The host derives the project root, full owner, executable identities and environment. START timeoutMs is the total server lifetime through readiness and browser checks, not only startup. This does not execute or approve commands. Each rerun requires a new approval; use recipeId and the current baseRevision to retain or revise an existing recipe.',
  parameters: z.toJSONSchema(verificationPrepareSchema) as Record<string, unknown>,
};
