import {afterEach, expect, it, vi} from 'vitest';

afterEach(() => {vi.unstubAllGlobals(); vi.resetModules();});

const page = {enabled: true, projectId: 'project-1', threadId: 'thread-1', query: 'rea', items: [{path: 'README.md', name: 'README.md', directory: ''}], complete: true};

const stubFetch = (response: unknown) => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({csrfToken: 'csrf'}))
    .mockResolvedValueOnce(Response.json(response));
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

it('requests bounded project file suggestions with the owner binding', async () => {
  const fetch = stubFetch(page);
  const {fetchFileSuggestions} = await import('../apps/web/src/files/file-suggestions-api');
  const signal = new AbortController().signal;
  await expect(fetchFileSuggestions({projectId: 'project-1', threadId: 'thread-1', q: 'rea', limit: 20}, signal)).resolves.toEqual(page);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]).toEqual(['/api/projects/project-1/file-suggestions?threadId=thread-1&q=rea&limit=20', expect.objectContaining({credentials: 'same-origin', signal})]);
});

it('rejects a response bound to a different owner or query', async () => {
  stubFetch({...page, threadId: 'other-thread'});
  const {fetchFileSuggestions} = await import('../apps/web/src/files/file-suggestions-api');
  await expect(fetchFileSuggestions({projectId: 'project-1', threadId: 'thread-1', q: 'rea'}, new AbortController().signal)).rejects.toThrow('belong to another composer');
});

it('rejects a malformed response instead of trusting the list', async () => {
  stubFetch({enabled: true, projectId: 'project-1', threadId: 'thread-1', query: 'rea', items: [{path: 'README.md', name: 'README.md'}], complete: true});
  const {fetchFileSuggestions} = await import('../apps/web/src/files/file-suggestions-api');
  await expect(fetchFileSuggestions({projectId: 'project-1', threadId: 'thread-1', q: 'rea'}, new AbortController().signal)).rejects.toThrow();
});
