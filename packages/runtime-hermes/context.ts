import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HarnessError, type StartRun } from '../contracts/index.ts';
import type { NativeContextProjectionV1, RequestContextV1 } from '../contracts/request-context.ts';
import { createContextCompiler } from '../core/context-compiler.ts';

const sha = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const category = z.enum(['SYSTEM', 'INSTRUCTION', 'MEMORY', 'USER', 'TOOL', 'REFERENCE']);
const sourceSchema = z.strictObject({ sequence: count.max(4095), id: z.string().min(1).max(100), revision: z.literal(1), category,
  utf8Bytes: count.max(32 * 1024 * 1024), sha256: sha });
const cutSchema = z.union([
  z.strictObject({ version: z.literal(1), status: z.literal('UNAVAILABLE'), reason: z.enum(['SOURCE_LIMIT', 'UNSUPPORTED_SOURCE']) }),
  z.strictObject({ version: z.literal(1), status: z.literal('AVAILABLE'), bindingDigest: sha, schemaDigest: sha,
    generation: count.min(1), previousDigest: sha.nullable(), revisionDigest: sha, sourceCount: count.max(4096), sourceBytes: count.max(32 * 1024 * 1024),
    reusedSources: count.max(4096), inspectedSources: count.max(4096), sources: z.array(sourceSchema).max(4096),
    change: z.enum(['RESET', 'APPEND', 'UNCHANGED']), newToolResults: count.max(4096).nullable(), newToolResultBytes: count.max(32 * 1024 * 1024).nullable() }),
]);
export interface NativeContextBinding {
  owner: RequestContextV1['owner']; modelBinding: RequestContextV1['modelBinding'];
  bindingDigest: string; instructionDigest: string; toolRegistryDigest: string; grantDigest: string;
}
export interface NativeContextCompilation { receipt: RequestContextV1 | null; projection: NativeContextProjectionV1 | null; unavailableReason: 'SOURCE_LIMIT' | 'UNSUPPORTED_SOURCE' | null; previousDigest?: string | null }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (): never => { throw new HarnessError('HERMES_CONTEXT_INVALID', 'The native context cut does not match its admitted source prefix.'); };

export function nativeContextBinding(input: StartRun, systemPrompt: string, tools: unknown): NativeContextBinding {
  const owner = { threadId: input.threadId, workspaceId: input.requestContext?.owner.workspaceId ?? 'thread:' + input.threadId };
  const modelBinding = { modelId: input.modelId, accountId: input.accountId ?? null };
  const instructionDigest = hash(systemPrompt), toolRegistryDigest = hash(tools);
  const grantDigest = hash([...input.resources].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { owner, modelBinding, instructionDigest, toolRegistryDigest, grantDigest,
    bindingDigest: hash([owner, modelBinding, input.thinkingLevel ?? null, instructionDigest, toolRegistryDigest, grantDigest]) };
}

/** Retains metadata only. Worker fingerprints prove the prefix; compiler reads
 * only newly eligible metadata. Every owner and source revision remains bound. */
export function createNativeContextCompiler() {
  type Source = z.infer<typeof sourceSchema>;
  let retained: { scope: string; generation: number; digest: string; schema: string; sources: Source[] } | undefined;
  let available = new Map<string, Source>(), reads = 0;
  const makeCompiler = () => createContextCompiler({ readSourceBytes: source => { const value = available.get(source.id); if (!value) return invalid(); reads++; return value.utf8Bytes; } });
  let compiler = makeCompiler();
  const clear = () => { retained = undefined; available.clear(); compiler = makeCompiler(); };
  return {
    clear,
    accept(binding: NativeContextBinding, value: unknown): NativeContextCompilation {
      const parsed = cutSchema.safeParse(value); if (!parsed.success) return invalid();
      const cut = parsed.data;
      if (cut.status === 'UNAVAILABLE') { clear(); return { receipt: null, projection: null, unavailableReason: cut.reason }; }
      const scope = hash(binding);
      if (cut.bindingDigest !== binding.bindingDigest || cut.inspectedSources !== cut.sourceCount) return invalid();
      const append = cut.change !== 'RESET';
      if (append ? !retained || retained.scope !== scope || retained.generation !== cut.generation || retained.digest !== cut.previousDigest || retained.schema !== cut.schemaDigest || retained.sources.length !== cut.reusedSources :
        cut.previousDigest !== null || cut.reusedSources !== 0 || retained && cut.generation <= retained.generation) return invalid();
      if (cut.sources.length + cut.reusedSources !== cut.sourceCount || cut.change === 'UNCHANGED' && cut.sources.length !== 0 || cut.change === 'APPEND' && cut.sources.length === 0) return invalid();
      if (cut.sources.some((source, index) => source.sequence !== cut.reusedSources + index || source.id !== `native:${cut.generation}:${source.sequence}`)) return invalid();
      const sources = [...(append ? retained!.sources : []), ...cut.sources];
      if (sources.reduce((sum, source) => sum + source.utf8Bytes, 0) !== cut.sourceBytes ||
        hash([cut.bindingDigest, cut.schemaDigest, cut.generation, sources.map(source => [source.sha256, source.utf8Bytes, source.category])]) !== cut.revisionDigest) return invalid();
      const tools = cut.sources.filter(source => source.category === 'TOOL');
      if (append ? cut.newToolResults !== tools.length || cut.newToolResultBytes !== tools.reduce((sum, source) => sum + source.utf8Bytes, 0) : cut.newToolResults !== null || cut.newToolResultBytes !== null) return invalid();
      // Mutate the cache only after every incoming field and prefix is verified.
      available = new Map(sources.map(source => [source.id, source])); reads = 0;
      const receipt = compiler.compile({ owner: binding.owner, modelBinding: binding.modelBinding, contextGeneration: cut.generation,
        instructionDigest: binding.instructionDigest, toolRegistryDigest: hash([binding.toolRegistryDigest, cut.schemaDigest]), grantDigest: binding.grantDigest,
        sources: sources.map(source => ({ sequence: source.sequence, id: source.id, revision: source.revision, category: source.category,
          contentRef: 'native-sha256:' + source.sha256, inclusionReason: 'observed original ACP source metadata; provider formatting remains opaque' })) });
      retained = { scope, generation: cut.generation, digest: cut.revisionDigest, schema: cut.schemaDigest, sources };
      return { receipt, unavailableReason: null, previousDigest: cut.previousDigest, projection: { source: 'ORIGINAL_ACP_MESSAGES', measurement: 'BYTE_ONLY', generation: cut.generation,
        revisionDigest: cut.revisionDigest, change: cut.change, sourceCount: cut.sourceCount, sourceBytes: cut.sourceBytes, reusedSources: cut.reusedSources,
        compiledSources: reads, inspectedSources: cut.inspectedSources, newToolResults: cut.newToolResults, newToolResultBytes: cut.newToolResultBytes,
        sources: sources.slice(0, 32).map(source => ({ category: source.category, sourceId: source.id, sourceRevision: source.revision, utf8Bytes: source.utf8Bytes, sha256: source.sha256 })),
        omittedSources: Math.max(0, sources.length - 32) } };
    },
  };
}
