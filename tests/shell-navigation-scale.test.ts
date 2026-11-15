import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ShellReadModels } from '../packages/core/shell-read-models.ts';
import { Store } from '../packages/storage/store.ts';

it('returns navigation totals and order bounds for a large imported history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gen-navigation-scale-'));
  const store = new Store(dir);
  try {
    store.db.exec(`
      WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<135000)
      INSERT INTO entities(kind,id,thread_id,body)
      SELECT 'thread', printf('task-%06d',n), printf('task-%06d',n), json_object(
        'id',printf('task-%06d',n),'title','Imported task',
        'createdAt','2026-11-01T00:00:00Z','updatedAt','2026-11-01T00:00:00Z',
        'status',CASE n WHEN 1 THEN 'working' WHEN 2 THEN 'awaiting_input' ELSE 'ready' END,
        'presentation',json_object('order',n-100,'pinned',json(CASE n WHEN 1 THEN 'true' ELSE 'false' END),'settled',json(CASE n WHEN 2 THEN 'true' ELSE 'false' END))
      ) FROM ids;
    `);
    const model = new ShellReadModels(store), page = model.navigation({limit: 1});
    expect(page).toMatchObject({total: 135000, items: [{id: 'task-135000'}], stats: {minOrder: -99, maxOrder: 134900, pinned: 1, working: 1, waiting: 1, settled: 1}});
    expect(page.nextCursor).toBeTypeOf('string');
  } finally {
    store.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
