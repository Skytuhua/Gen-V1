import { z } from 'zod';
import { journalCompareAndSwap, journalGeneration, journalReadRecord, journalRefreshRecord, journalSubscribe, type JournalRecord } from './journal.ts';

export const SNIPPET_LIMIT = 100, SNIPPET_NAME_LIMIT = 80, SNIPPET_BODY_LIMIT = 20_000, SNIPPET_LIBRARY_BYTES = 2_000_000;
const encoder = new TextEncoder();

export interface PromptSnippet { id: string; name: string; body: string; createdAt: string; updatedAt: string }
export interface SnippetLibrary { version: 1; profileId: string; snippets: PromptSnippet[] }
export type SnippetError = 'validation' | 'conflict' | 'storage';
export type SnippetResult = { ok: true; library: SnippetLibrary; generation: string | undefined } | { ok: false; error: SnippetError; message: string };

const fail = (error: SnippetError, message: string): SnippetResult => ({ ok: false, error, message });
const valid = (library: SnippetLibrary, generation: string | undefined): SnippetResult => ({ ok: true, library, generation });

export function snippetLibraryKey(profileId: string): string {
  return 'prompt-snippets:v1:' + JSON.stringify([profileId]);
}

/** Trimmed NFC name; the uniqueness key is locale-independent so A==a and composed==decomposed. */
export function normalizeSnippetName(name: string): string {
  return name.trim().normalize('NFC');
}
const nameKey = (name: string) => normalizeSnippetName(name).toLowerCase();

const nameSchema = z.string().transform(name => normalizeSnippetName(name)).refine(name => [...name].length >= 1 && [...name].length <= SNIPPET_NAME_LIMIT, `Keep the name between 1 and ${SNIPPET_NAME_LIMIT} characters.`).refine(name => !/[\p{Cc}\p{Cf}]/u.test(name), 'Names cannot contain control characters or line breaks.');
const bodySchema = z.string().refine(body => body.length >= 1 && body.length <= SNIPPET_BODY_LIMIT, `Keep the body between 1 and ${SNIPPET_BODY_LIMIT} characters.`).refine(body => body.trim().length > 0, 'A snippet needs some non-whitespace text.').refine(body => !body.includes('\0'), 'Snippet bodies cannot contain NUL characters.');
export const promptSnippetSchema = z.object({ id: z.string().uuid(), name: nameSchema, body: bodySchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
const librarySchema = z.object({ version: z.literal(1), profileId: z.string().min(1).max(240), snippets: z.array(promptSnippetSchema).max(SNIPPET_LIMIT, `Keep at most ${SNIPPET_LIMIT} snippets.`) }).strict();

export function sortSnippets(snippets: readonly PromptSnippet[]): PromptSnippet[] {
  return [...snippets].sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)) || a.id.localeCompare(b.id));
}

/** Strict whole-library validation: schema, limits, duplicate ids/names, profile match and serialized byte bound. */
export function parseSnippetLibrary(profileId: string, value: unknown): SnippetResult {
  const parsed = librarySchema.safeParse(value);
  if (!parsed.success) return fail('validation', parsed.error.issues[0]?.message ?? 'The snippet library is not valid.');
  if (parsed.data.profileId !== profileId) return fail('validation', 'This snippet library belongs to another profile.');
  const ids = new Set<string>(), names = new Set<string>();
  for (const snippet of parsed.data.snippets) {
    if (ids.has(snippet.id)) return fail('validation', 'Two snippets share an ID.');
    if (names.has(nameKey(snippet.name))) return fail('validation', `Another snippet is already named ${JSON.stringify(snippet.name)}.`);
    ids.add(snippet.id); names.add(nameKey(snippet.name));
  }
  const library: SnippetLibrary = { ...parsed.data, snippets: sortSnippets(parsed.data.snippets) };
  if (encoder.encode(JSON.stringify(library)).length > SNIPPET_LIBRARY_BYTES) return fail('validation', 'The snippet library exceeds its storage limit.');
  return { ok: true, library, generation: undefined };
}

export function filterSnippets(library: SnippetLibrary, query: string): PromptSnippet[] {
  const normalized = normalizeSnippetName(query).toLowerCase();
  if (!normalized) return library.snippets;
  return library.snippets.filter(snippet => nameKey(snippet.name).includes(normalized) || snippet.body.toLowerCase().includes(normalized));
}

async function mutate(profileId: string, generation: string | undefined, edit: (library: SnippetLibrary) => PromptSnippet[] | SnippetResult): Promise<SnippetResult> {
  const key = snippetLibraryKey(profileId);
  let record: JournalRecord | undefined;
  try { record = await journalReadRecord(key); } catch (cause) { return fail('storage', cause instanceof Error ? cause.message : 'The snippet library could not be read.'); }
  if (record?.generation !== generation) return fail('conflict', 'Snippets changed in another window. Review and save again.');
  const parsed = record === undefined
    ? { ok: true as const, library: { version: 1 as const, profileId, snippets: [] }, generation: undefined }
    : parseSnippetLibrary(profileId, record.value);
  if (!parsed.ok) return parsed;
  const edited = edit(parsed.library);
  if (typeof edited === 'object' && 'ok' in edited) return edited;
  const proposed = parseSnippetLibrary(profileId, { ...parsed.library, snippets: edited as PromptSnippet[] });
  if (!proposed.ok) return proposed;
  try {
    if (!(await journalCompareAndSwap(key, generation, proposed.library))) return fail('conflict', 'Snippets changed in another window. Review and save again.');
  } catch (cause) { return fail('storage', cause instanceof Error ? cause.message : 'The snippet library could not be saved.'); }
  return valid(proposed.library, journalGeneration(key));
}

export async function loadSnippetLibrary(profileId: string): Promise<SnippetResult> {
  let record: JournalRecord | undefined;
  try { record = await journalReadRecord(snippetLibraryKey(profileId)); } catch (cause) { return fail('storage', cause instanceof Error ? cause.message : 'The snippet library could not be read.'); }
  if (record === undefined) return valid({ version: 1, profileId, snippets: [] }, undefined);
  const parsed = parseSnippetLibrary(profileId, record.value);
  return parsed.ok ? valid(parsed.library, record.generation) : parsed;
}

/** Durable reload for open/focus/visibility recovery; never downgrades pending or failed local journal work. */
export async function refreshSnippetLibrary(profileId: string): Promise<SnippetResult> {
  let record: JournalRecord | undefined;
  try { record = await journalRefreshRecord(snippetLibraryKey(profileId)); } catch (cause) { return fail('storage', cause instanceof Error ? cause.message : 'The snippet library could not be read.'); }
  if (record === undefined) return valid({ version: 1, profileId, snippets: [] }, undefined);
  const parsed = parseSnippetLibrary(profileId, record.value);
  return parsed.ok ? valid(parsed.library, record.generation) : parsed;
}

export function subscribeSnippetLibrary(profileId: string, listener: (result: SnippetResult) => void): () => void {
  const key = snippetLibraryKey(profileId);
  return journalSubscribe(key, value => {
    const parsed = parseSnippetLibrary(profileId, value);
    listener(parsed.ok ? valid(parsed.library, journalGeneration(key)) : parsed);
  });
}

export function createSnippet(profileId: string, generation: string | undefined, input: { name: string; body: string }): Promise<SnippetResult> {
  const name = nameSchema.safeParse(input.name), body = bodySchema.safeParse(input.body);
  if (!name.success) return Promise.resolve(fail('validation', name.error.issues[0]?.message ?? 'Invalid snippet name.'));
  if (!body.success) return Promise.resolve(fail('validation', body.error.issues[0]?.message ?? 'Invalid snippet body.'));
  const now = new Date().toISOString();
  const snippet: PromptSnippet = { id: crypto.randomUUID(), name: name.data, body: body.data, createdAt: now, updatedAt: now };
  return mutate(profileId, generation, library => [...library.snippets, snippet]);
}

export function updateSnippet(profileId: string, generation: string | undefined, id: string, input: { name: string; body: string }): Promise<SnippetResult> {
  const name = nameSchema.safeParse(input.name), body = bodySchema.safeParse(input.body);
  if (!name.success) return Promise.resolve(fail('validation', name.error.issues[0]?.message ?? 'Invalid snippet name.'));
  if (!body.success) return Promise.resolve(fail('validation', body.error.issues[0]?.message ?? 'Invalid snippet body.'));
  return mutate(profileId, generation, library => {
    if (!library.snippets.some(snippet => snippet.id === id)) return fail('validation', 'That snippet no longer exists. Reload and try again.');
    return library.snippets.map(snippet => snippet.id === id ? { ...snippet, name: name.data, body: body.data, updatedAt: new Date().toISOString() } : snippet);
  });
}

export function deleteSnippet(profileId: string, generation: string | undefined, id: string): Promise<SnippetResult> {
  return mutate(profileId, generation, library => {
    if (!library.snippets.some(snippet => snippet.id === id)) return fail('validation', 'That snippet no longer exists. Reload and try again.');
    return library.snippets.filter(snippet => snippet.id !== id);
  });
}
