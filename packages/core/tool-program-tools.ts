import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { programInputRefsSchema } from '../contracts/tool-program.ts';
import type { ToolMetadata } from '../runtime-pi/tool-definitions.ts';

const id = z.string().min(1).max(200);
const limits = z.strictObject({
  deadlineMs: z.number().int().positive().max(30_000).optional(), maxCalls: z.number().int().positive().max(64).optional(),
  maxConcurrentCalls: z.number().int().positive().max(4).optional(), maxOutputBytes: z.number().int().min(2048).max(262_144).optional(),
});
export const programArguments = z.strictObject({
  commandId: id, source: z.string().min(1).max(128 * 1024), allowedTools: z.array(id).max(64),
  inputRefs: programInputRefsSchema.optional(), requestedAggregate: z.string().min(1).max(2048), limits: limits.optional(),
});
export const pythonCellArguments = programArguments.extend({ kernelId: id.optional() });
export const programDiscoveryArguments = z.strictObject({ names: z.array(id).min(1).max(8).optional() });
export const programResultArguments = z.strictObject({ programId: id, resultRef: id,
  offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(64 * 1024).default(16 * 1024) });
const metadata = (name: string, description: string, schema: z.ZodType): ToolMetadata => ({ name, description, parameters: z.toJSONSchema(schema) as Record<string, unknown> });
export const PROGRAM_TOOLS: readonly ToolMetadata[] = [
  metadata('tool_program_discover', 'Discover host-classified read tools for bounded programs. Without names returns a small index; request up to eight exact names to disclose their schemas. Disclosure grants no resources or account access.', programDiscoveryArguments),
  metadata('tool_program', 'Run an isolated JavaScript async function body for an explicitly requested aggregate. First disclose allowedTools. Immutable inputs contains values of unique authorized inputRefs, bounded together to 4 MiB of serialized JSON and 100000 JSON nodes. await tools.call(name,args) reads only through the host. Return only the aggregate; bulk source results stay in private handles. No Node, imports, filesystem, network or process globals. 30 seconds, 64 calls, four admitted reads, 256 KiB visible output. commandId deduplicates this exact request. Failed source calls keep the program failed.', programArguments),
  metadata('python_cell', 'Run a Python cell in an approved owner-scoped confined persistent kernel. Set result explicitly to the requested aggregate. Immutable inputs contains values of unique authorized inputRefs, bounded together to 4 MiB of serialized JSON and 100000 JSON nodes; tools.call(name,args) uses disclosed host read tools. Reuse kernelId to retain variables; failed/cancelled cells require the user to Reset. Every cell has fresh 30-second, 64-call and 256 KiB output budgets. No host credentials, network or filesystem outside the approved private profile. commandId is never automatically replayed.', pythonCellArguments),
  metadata('tool_program_result', 'Read an explicitly requested UTF-8 byte range from a retained program result. The same owner and current resource grants are required. Source failures remain labeled FAILED; a partial range is not the whole result.', programResultArguments),
];
export const PROGRAM_TOOL_NAMES = new Set(PROGRAM_TOOLS.map(tool => tool.name));
export function programResultFailed(name: string, result: unknown): boolean {
  return (name === 'tool_program' || name === 'python_cell') && !!result && typeof result === 'object' && 'state' in result && result.state !== 'SUCCEEDED';
}

/** Transport metadata is selected by the host from this finite canonical list. */
export function selectProgramTools(selected: readonly ToolMetadata[] = []): ToolMetadata[] {
  const seen = new Set<string>();
  return selected.map(tool => {
    const canonical = PROGRAM_TOOLS.find(value => value.name === tool.name);
    if (!canonical || seen.has(tool.name) || JSON.stringify(tool) !== JSON.stringify(canonical))
      throw new HarnessError('PROGRAM_TOOL_METADATA', 'Program tool metadata differs from the host contract');
    seen.add(tool.name);
    return structuredClone(canonical);
  });
}
