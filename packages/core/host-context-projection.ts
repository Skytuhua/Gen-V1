import { createHash } from 'node:crypto';
import type { HostRequestProjectionV1 } from '../contracts/request-context.ts';
import type { StartRun } from '../contracts/index.ts';
import { createContextCompiler, type ContextSource } from './context-compiler.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Shadow projection of captured host fragments, never a prompt constructor. */
export function projectHostRequest(input: StartRun, workspaceId: string, toolRegistryDigest: string,
  guidance: string, fragments: readonly { id: string; content: string; isToolResult: boolean }[]): HostRequestProjectionV1 {
  const sources: ContextSource[] = [], captured = new Map<string, string>();
  const add = (id: string, category: ContextSource['category'], content: string) => {
    const sourceId = category + ':' + id;
    sources.push({ sequence: sources.length, id: sourceId, revision: 1, category });
    captured.set(sourceId, content);
  };
  if (guidance) add('host-guidance', 'INSTRUCTION', guidance);
  if (input.personalInstructions) add('personal-instructions', 'INSTRUCTION', input.personalInstructions.text);
  if (input.approvedProjectContext?.instructionText) add('approved-project-instructions', 'INSTRUCTION', input.approvedProjectContext.instructionText);
  if (input.memory) add('thread-memory', 'MEMORY', input.memory);
  for (const fragment of fragments.slice(0, 32)) add(fragment.id, fragment.isToolResult ? 'TOOL' : 'USER', fragment.content);
  const measured = createContextCompiler({
    readSource: source => {
      const value = captured.get(source.id);
      if (value === undefined) throw new Error('Uncaptured host context source');
      return value;
    },
  }).compile({
    owner: { threadId: input.threadId, workspaceId },
    modelBinding: { modelId: input.modelId, accountId: input.accountId ?? null },
    contextGeneration: input.epoch, instructionDigest: hash(guidance + (input.approvedProjectContext?.instructionText ?? '')), toolRegistryDigest, sources,
  });
  const omitted = fragments.slice(32);
  return {
    threadId: input.threadId, runId: input.runId, epoch: input.epoch,
    sourceCutDigest: measured.sourceCut.revisionDigest, measurement: 'BYTE_ONLY',
    sources: [
      ...measured.segments.map(source => ({ category: source.category, revision: source.sourceRevision, utf8Bytes: source.utf8Bytes,
        inclusionReason: source.inclusionReason ?? null, tokens: source.tokens, measurement: source.measurement, exclusionReason: null as string | null })),
      ...omitted.map(fragment => ({ category: (fragment.isToolResult ? 'TOOL' : 'USER') as ContextSource['category'], revision: 1,
        utf8Bytes: Buffer.byteLength(fragment.content, 'utf8'), inclusionReason: null, tokens: null,
        measurement: 'BYTE_ONLY' as const, exclusionReason: 'Beyond the bounded host projection fragment count' as string | null })),
    ],
    omittedSources: omitted.length,
    ...(input.approvedProjectContext ? { projectInstructions: input.approvedProjectContext.instructions } : {}),
    ...(input.personalInstructions ? { personalInstructions: { utf8Bytes: Buffer.byteLength(input.personalInstructions.text, 'utf8'), digest: input.personalInstructions.digest } } : {}),
  };
}
