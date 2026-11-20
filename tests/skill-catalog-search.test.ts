import {expect, it} from 'vitest';
import {catalogItem, personalScope, SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';
import type {SkillCatalogSource} from '../packages/contracts/skill-catalog.ts';

it('matches every case-insensitive search term across display fields and keeps pagination order', async () => {
  const source: SkillCatalogSource = {id: 'catalog', kind: 'bundled', label: 'Proof Tools', availability: {status: 'available'}};
  const item = (key: string, name: string, description: string) =>
    catalogItem(source.id, key, {name, description}, {kind: 'harness', binding: key, files: []});
  const accepted = [item('1', 'Filing', 'Budget support'), item('2', 'Budget', 'Filing support')];
  const repo = new SkillCatalogRepository([{scope: personalScope, read: async () => ({
    sources: [source],
    items: [...accepted, item('3', 'Budget calendar', 'Generic tools'), item('4', 'Filing', 'General support')],
  })}]);
  const query = '  PROOF   Budget filing ';
  const first = await repo.list({query, limit: 1});
  const second = await repo.list({query, limit: 1, cursor: first.nextCursor!});
  expect([...first.skills, ...second.skills].map(entry => entry.id)).toEqual(accepted.map(item => item.entry.id).sort());
  expect(second.nextCursor).toBeNull();
  expect((await repo.list({query: 'missing'})).skills).toEqual([]);
  expect((await repo.list({query: '  '})).skills).toHaveLength(4);
});

it('continues the same project search with an explicit default page size', async () => {
  const source: SkillCatalogSource = {id: 'catalog', kind: 'project', label: 'Proof Tools', availability: {status: 'available'}};
  const items = Array.from({length: 51}, (_, index) => {
    const key = String(index);
    return catalogItem(source.id, key, {name: 'Notes ' + key, description: 'Proof'}, {kind: 'harness', binding: key, files: []});
  });
  const repo = new SkillCatalogRepository([{scope: personalScope, read: async () => ({sources: [source], items})}]);
  const query = {query: 'notes', projectId: 'project-1'};
  const first = await repo.list(query);
  expect(first.skills).toHaveLength(50);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await repo.list({...query, limit: 50, cursor: first.nextCursor!});
  expect(second.skills).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.skills, ...second.skills].map(entry => entry.id)).size).toBe(51);
  await expect(repo.list({...query, projectId: 'project-2', limit: 50, cursor: first.nextCursor!})).rejects.toMatchObject({code: 'INVALID_CURSOR'});
  await expect(repo.list({...query, limit: 49, cursor: first.nextCursor!})).rejects.toMatchObject({code: 'INVALID_CURSOR'});
});
