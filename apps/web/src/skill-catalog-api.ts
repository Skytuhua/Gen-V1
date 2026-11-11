import {z} from 'zod';
import {skillCatalogQuerySchema, skillReferenceSchema, type SkillCatalogPage, type SkillCatalogQuery} from '../../../packages/contracts/skill-catalog';
import {ApiError, authenticated, read} from './api';

const availability = z.discriminatedUnion('status', [z.strictObject({status: z.literal('available')}), z.strictObject({status: z.literal('unavailable'), reason: z.enum(['disabled', 'disconnected', 'unsupported', 'denied', 'changed', 'limit', 'invalid', 'missing'])})]);
const identity = z.string().min(1).max(305);
const source = z.strictObject({id: identity, kind: z.enum(['harness', 'bundled', 'personal', 'project', 'app']), label: z.string().min(1).max(240), availability});
const skill = z.strictObject({id: identity, sourceId: identity, name: z.string().min(1).max(240), description: z.string().max(4096), files: z.number().int().min(0).max(512), availability, ref: skillReferenceSchema.nullable()});
const schema = z.strictObject({scope: z.strictObject({kind: z.literal('personal')}), sources: z.array(source).max(512), skills: z.array(skill).max(100), inventoryRevision: z.string().regex(/^[a-f0-9]{64}$/), nextCursor: z.string().min(1).max(2048).nullable()});
const invalid = () => new ApiError('INVALID_RESPONSE', 'The skill catalog changed. Reload the menu.');
function checked(value: unknown): SkillCatalogPage {
  const parsed = schema.safeParse(value); if (!parsed.success) throw invalid();
  const page = parsed.data, sources = new Map(page.sources.map(item => [item.id, item])), ids = new Set<string>();
  if (sources.size !== page.sources.length) throw invalid();
  for (const item of page.skills) {
    const owner = sources.get(item.sourceId);
    if (!owner || ids.has(item.id)) throw invalid(); ids.add(item.id);
    if (item.availability.status === 'available') {
      if (owner.availability.status !== 'available' || !item.ref || item.ref.scope.kind !== 'personal' || item.ref.sourceId !== item.sourceId || item.ref.skillId !== item.id) throw invalid();
    } else if (item.ref !== null) throw invalid();
  }
  return page;
}
export async function getSkillCatalog(query: SkillCatalogQuery, signal?: AbortSignal): Promise<SkillCatalogPage> {
  const input = skillCatalogQuerySchema.parse(query);
  const params = new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]));
  return checked(await authenticated(() => fetch('/api/skill-catalog?' + params, {credentials: 'same-origin', cache: 'no-store', signal})).then(read<unknown>));
}
export function mergeSkillCatalogPages(previous: SkillCatalogPage, next: SkillCatalogPage): SkillCatalogPage {
  // The host signs paging to an inventory revision; never combine stale catalogs.
  if (previous.scope.kind !== 'personal' || next.scope.kind !== 'personal' || previous.inventoryRevision !== next.inventoryRevision || !previous.nextCursor || previous.nextCursor === next.nextCursor || JSON.stringify(previous.sources) !== JSON.stringify(next.sources)) throw invalid();
  const ids = new Set(previous.skills.map(item => item.id));
  if (next.skills.some(item => ids.has(item.id)) || previous.skills.length + next.skills.length > 20000) throw invalid();
  return {...next, skills: [...previous.skills, ...next.skills]};
}
