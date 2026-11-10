import {afterEach, expect, it, vi} from 'vitest';
import {captureCompanyInstruction, recordCompanyInstruction} from '../apps/web/src/company/workflow-api';

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules();});
it('bounds the entire escaped UTF8 request before any auth or network request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const input = {project_id: 'alpha', message_id: '0'.repeat(36), instruction: '界'.repeat(16000)};
  expect(() => captureCompanyInstruction(input)).toThrow(/too large/);
  await expect(recordCompanyInstruction(input)).rejects.toThrow(/too large/);
  expect(fetch).not.toHaveBeenCalled();
  expect(captureCompanyInstruction({...input, instruction: 'é'.repeat(4096)}).captured.instruction).toHaveLength(4096);
  expect(() => captureCompanyInstruction({...input, instruction: '\u0001'.repeat(10000)})).toThrow(/too large/);
});
it('captures original arguments before bootstrap await and never automatically resends a rejected mutation', async () => {
  let finish!: (response: Response) => void;
  const calls: {url: string; options?: RequestInit}[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, options?: RequestInit) => {
    calls.push({url, options});
    if (url === '/api/bootstrap') return new Promise<Response>(resolve => {finish = resolve;});
    return Promise.resolve(new Response(JSON.stringify({error: {code: 'COMPANY_AUTH', message: 'Current owner denied'}}), {status: 401, headers: {'Content-Type': 'application/json'}}));
  }));
  const input = {project_id: 'alpha', message_id: 'request-1', instruction: 'Original instruction'};
  const pending = recordCompanyInstruction(input);
  input.instruction = 'Changed after call'; input.project_id = 'beta';
  finish(new Response(JSON.stringify({csrfToken: 'PUBLIC-test'}), {headers: {'Content-Type': 'application/json'}}));
  await expect(pending).rejects.toMatchObject({code: 'COMPANY_AUTH'});
  expect(calls.map(call => call.url)).toEqual(['/api/bootstrap', '/api/company/workflow/instruction']);
  expect(JSON.parse(calls[1].options?.body as string)).toEqual({project_id: 'alpha', message_id: 'request-1', instruction: 'Original instruction'});
});
