import { z } from 'zod';
import { HarnessError } from '../contracts/index.ts';
import { sameToolOwner } from '../contracts/tool-results.ts';
import { toolOwnerSchema, type ToolOwner } from '../contracts/tool-effects.ts';
import { descriptions, toolSchemas, type ToolName } from '../capabilities/schemas.ts';
import { digest, type Store } from '../storage/store.ts';
import type { RegistryEntry, ToolAuthority } from './tool-authority.ts';

/** Reviewed adapters with actual host read handlers. Configuration can only narrow this list. */
export const PROGRAM_READ_TOOLS = Object.freeze([
  'repository_files', 'repository_read', 'repository_status', 'repository_diff',
  'repository_log', 'text_import', 'database_inspect', 'pdf_inspect',
] as const);
const implemented: ReadonlySet<string> = new Set(PROGRAM_READ_TOOLS);
const KIND = 'programToolDisclosure';
interface DisclosureRecord { version: 1; owner: ToolOwner; definitions: Record<string, string> }
export interface ProgramToolIndexEntry { name: string; description: string; definitionDigest: string }
export interface ProgramToolDetail extends ProgramToolIndexEntry { parameters: Record<string, unknown> }
export interface ToolDisclosureHooks { currentOwner(threadId: string): ToolOwner; eligibleTools?: readonly string[] }

/** Shared with M02: approval and all authority fields participate, not only the parameter schema. */
export function toolDefinitionDigest(definition: RegistryEntry): string { return digest(definition); }

/** Progressive metadata for the M12 lane. Disclosure is host-owned and grants no resources. */
export class ToolDisclosure {
  private readonly eligible: ReadonlySet<string>;
  constructor(private readonly store: Store, private readonly authority: ToolAuthority, private readonly hooks: ToolDisclosureHooks) {
    this.eligible = new Set((hooks.eligibleTools ?? PROGRAM_READ_TOOLS).filter(name => implemented.has(name)));
  }

  private assertOwner(owner: ToolOwner): void {
    let current: ToolOwner;
    try { current = this.hooks.currentOwner(owner.threadId); }
    catch { throw new HarnessError('TOOL_DISCLOSURE_DENIED', 'This tool disclosure owner is no longer current.'); }
    if (!sameToolOwner(owner, current)) throw new HarnessError('TOOL_DISCLOSURE_DENIED', 'This tool disclosure owner is no longer current.');
  }
  private names(names: readonly string[], allowEmpty = false): string[] {
    if (!Array.isArray(names) || names.length > 64 || (!allowEmpty && !names.length) ||
      names.some(name => typeof name !== 'string' || !name || name.length > 200) || new Set(names).size !== names.length)
      throw new HarnessError('INVALID_TOOL_DISCLOSURE', 'Choose a bounded unique list of tool names.');
    return [...names].sort();
  }
  private definition(name: string): { definition: RegistryEntry; parameters: Record<string, unknown> } {
    const definition = this.authority.definition(name);
    if (!this.eligible.has(name) || !definition || definition.risk !== 'READ' || definition.replayClass !== 'READ_RETRYABLE' ||
      definition.approval !== 'none' || definition.executorBinding !== 'read' || !definition.allowedRoles.includes('run'))
      throw new HarnessError('TOOL_NOT_ELIGIBLE', 'This tool is not an eligible program read.');
    const schema = toolSchemas[name as ToolName];
    if (!schema) throw new HarnessError('TOOL_NOT_ELIGIBLE', 'This tool has no reviewed program adapter.');
    const parameters = z.toJSONSchema(schema) as Record<string, unknown>;
    if (digest(parameters) !== definition.schemaDigest) throw new HarnessError('TOOL_DISCLOSURE_STALE', 'This tool schema changed; disclose its current definition.');
    return { definition: structuredClone(definition), parameters };
  }
  index(owner: ToolOwner): ProgramToolIndexEntry[] {
    this.assertOwner(owner);
    return [...this.eligible].sort().flatMap(name => {
      try { const { definition } = this.definition(name); return [{ name, description: descriptions[name as ToolName].slice(0, 200), definitionDigest: toolDefinitionDigest(definition) }]; }
      catch (error) { if (error instanceof HarnessError && error.code === 'TOOL_NOT_ELIGIBLE') return []; throw error; }
    });
  }
  disclose(owner: ToolOwner, names: readonly string[]): ProgramToolDetail[] {
    this.assertOwner(owner);
    const requested = this.names(names), details = requested.map(name => {
      const { definition, parameters } = this.definition(name);
      return { name, description: descriptions[name as ToolName], definitionDigest: toolDefinitionDigest(definition), parameters };
    });
    const key = digest(owner);
    this.store.internal('programTools.disclosed', owner.threadId, () => {
      this.assertOwner(owner);
      const old = this.store.get<DisclosureRecord>(KIND, key);
      if (old && (!sameToolOwner(owner, old.owner) || old.version !== 1)) throw new HarnessError('TOOL_DISCLOSURE_DENIED', 'The saved tool disclosure is unavailable.');
      const definitions = { ...(old?.definitions ?? {}) };
      for (const detail of details) definitions[detail.name] = detail.definitionDigest;
      this.store.put(KIND, key, owner.threadId, { version: 1, owner: toolOwnerSchema.parse(owner), definitions } satisfies DisclosureRecord);
      return { count: details.length };
    });
    return details;
  }
  require(owner: ToolOwner, name: string, expectedDefinitionDigest?: string): RegistryEntry {
    this.assertOwner(owner);
    const { definition } = this.definition(name), currentDigest = toolDefinitionDigest(definition);
    const record = this.store.get<DisclosureRecord>(KIND, digest(owner));
    if (!record || record.version !== 1 || !sameToolOwner(owner, record.owner) || !Object.hasOwn(record.definitions, name))
      throw new HarnessError('TOOL_NOT_DISCLOSED', 'Disclose this tool to the current owner before using it in a program.');
    if (record.definitions[name] !== currentDigest || expectedDefinitionDigest !== undefined && expectedDefinitionDigest !== currentDigest)
      throw new HarnessError('TOOL_DISCLOSURE_STALE', 'The disclosed tool definition changed.');
    return definition;
  }
  snapshot(owner: ToolOwner, names: readonly string[]): { registryDigest: string; definitions: RegistryEntry[] } {
    this.assertOwner(owner);
    const definitions = this.names(names, true).map(name => this.require(owner, name));
    return { registryDigest: digest(definitions), definitions };
  }
}
