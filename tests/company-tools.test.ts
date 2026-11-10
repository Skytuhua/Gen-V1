import { describe, expect, it, vi } from 'vitest';
import { CompanyClient, createCompanyManagerTools } from '../packages/company-client/index.ts';

describe('employee-only manager tool adapter', () => {
  it('refuses an owner client instead of laundering its authority', () => {
    const owner = new CompanyClient({ origin: 'http://127.0.0.1:1', credential: () => 'fixture-owner', role: 'owner' });
    expect(() => createCompanyManagerTools(owner)).toThrowError(expect.objectContaining({ code: 'COMPANY_FORBIDDEN' }));
  });
  it('exposes only three scoped reads and never falls back to owner or handoff tools', async () => {
    const credential = vi.fn(() => 'fixture');
    const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential, role: 'employee' });
    const tools = createCompanyManagerTools(client);
    expect(tools.names).toEqual(['status_scoped', 'read_assignment', 'read_artifact']);
    for (const tool of ['start', 'plan', 'handoff', 'pause', 'shell']) {
      await expect(tools.invoke({ project_id: 'alpha', tool, arguments: {} })).rejects.toMatchObject({ code: 'COMPANY_REQUEST' });
    }
    expect(credential).not.toHaveBeenCalled();
  });
  it('delegates an exact read to the employee client without identity fields', async () => {
    const client = new CompanyClient({ origin: 'http://127.0.0.1:1', credential: () => 'fixture', role: 'employee' });
    const spy = vi.spyOn(client, 'employeeTool').mockResolvedValue({ artifact_id: 'a1', html: '<pre>source</pre>', evidence_scope: 'synthetic_only' });
    const input = { project_id: 'alpha', tool: 'read_artifact' as const, arguments: { artifact_id: 'a1' } };
    expect(await createCompanyManagerTools(client).invoke(input)).toMatchObject({ artifact_id: 'a1' }); expect(spy).toHaveBeenCalledWith(input);
  });
});
