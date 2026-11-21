import {fileSuggestionsResponseSchema} from '../../../../packages/contracts/file-mentions';
import {authenticated, read} from '../api.ts';

export type FileSuggestionsResponse = ReturnType<typeof fileSuggestionsResponseSchema.parse>;

/** Same-origin, no-store fetch; a response bound to a different owner or query
 * is rejected so a late reply can never populate another composer. */
export async function fetchFileSuggestions(input: {projectId: string; threadId: string; q: string; limit?: number}, signal?: AbortSignal): Promise<FileSuggestionsResponse> {
  const query = new URLSearchParams({threadId: input.threadId, q: input.q, ...(input.limit !== undefined ? {limit: String(input.limit)} : {})});
  const value = await authenticated(() => fetch(`/api/projects/${encodeURIComponent(input.projectId)}/file-suggestions?${query}`, {credentials: 'same-origin', cache: 'no-store', signal})).then(read<unknown>);
  const response = fileSuggestionsResponseSchema.parse(value);
  if (response.projectId !== input.projectId || response.threadId !== input.threadId || response.query !== input.q) throw Error('The file suggestions belong to another composer.');
  return response;
}
