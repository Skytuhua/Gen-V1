import {z} from 'zod';

export const RESEARCH_SOURCE_BYTES = 4 * 1024 * 1024;
export const RESEARCH_PASSAGE_BYTES = 64 * 1024;
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/);
export const researchHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const researchAuthoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('personal')}),
  z.strictObject({kind: z.literal('company'), companyId: id}),
]);
type ResearchAuthority = z.infer<typeof researchAuthoritySchema>;
export const researchContextSchema = z.strictObject({authority: researchAuthoritySchema, threadId: id, projectId: id.nullable()});
export type ResearchContext = z.infer<typeof researchContextSchema>;
export const researchPassageSchema = z.strictObject({sourceId: id, revision: z.number().int().positive(), sha256: researchHashSchema, start: z.number().int().nonnegative(), end: z.number().int().positive()}).refine(v => v.end > v.start && v.end - v.start <= RESEARCH_PASSAGE_BYTES, {message: 'Choose a bounded nonempty passage in UTF-8 bytes.'});
/** Half-open offsets in the exact captured UTF-8 bytes, rather than JavaScript characters. */
export type ResearchPassage = z.infer<typeof researchPassageSchema>;
export const researchPageSchema = z.strictObject({kind: z.enum(['sources', 'documents']), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().max(2048).optional()});
export type ResearchPageQuery = z.infer<typeof researchPageSchema>;
type ResearchSourceIdentity = {kind: 'text'} | {kind: 'bookmark'; url: string} |
  {kind: 'file'; resourceId: string; relativePath?: string; grantBinding: string; dev: string; ino: string} |
  {kind: 'browser'; browserId: string; navigationId: string; authorizationId: string; url: string};
export interface ResearchSource extends ResearchContext {
  id: string; revision: number; title: string; identity: ResearchSourceIdentity; status: 'unconfirmed' | 'captured';
  capturedAt: string | null; sha256: string | null; bytes: number; materialId: string | null;
}
export interface ResearchDocument extends ResearchContext {
  id: string; revision: number; kind: 'findings' | 'working-notes'; title: string; body: string; sha256: string; savedAt: string; citations: ResearchPassage[];
}
export interface ResearchProvider {
  readonly authority: ResearchAuthority;
  source(context: ResearchContext, sourceId: string, revision?: number): ResearchSource;
  document(context: ResearchContext, documentId: string, revision?: number): ResearchDocument & {citations: (ResearchPassage & {status: 'current-capture' | 'stale' | 'unavailable'; liveStatus: 'unverified'})[]};
  passage(context: ResearchContext, passage: ResearchPassage): {text: string; sourceRevision: number; status: 'current-capture' | 'stale'};
}
