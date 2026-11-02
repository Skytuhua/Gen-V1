import { expect, test } from '@playwright/test';
import type { HostCommand, UserStateRecord } from '../../packages/contracts';
import { serveTaskFixture, taskFixture } from './task-interface-fixture';

test('an older snapshot cannot replace a newer acknowledged selection', async ({ page }) => {
  const snapshot = taskFixture({ root: 'records', elements: {
    records: { type: 'Table', props: { rowsBinding: 'rows', stateKey: 'selection', rowKey: 'id', caption: 'Review records', columns: [{ key: 'name', label: 'Name' }] } },
  } }, { rows: [{ id: 'row-0', name: 'First record' }] }, { selection: ['row-0'] });
  snapshot.userStates[0].revision = 1;
  const host = await serveTaskFixture(page, snapshot);
  const saves: UserStateRecord[] = [];
  let visibleState = structuredClone(snapshot.userStates[0]), endHeld = false;
  let releaseFirst!: () => void, releaseEnd!: () => void;
  const firstReceipt = new Promise<void>(resolve => { releaseFirst = resolve; });
  const finalEnd = new Promise<void>(resolve => { releaseEnd = resolve; });
  await page.route('**/api/snapshot', route => route.fulfill({ json: { ...snapshot, userStates: [visibleState] } }));
  await page.route('**/api/commands', async route => {
    const command = route.request().postDataJSON() as HostCommand;
    if (command.type === 'state.save') {
      const accepted = { ...snapshot.userStates[0], revision: snapshot.userStates[0].revision + 1, values: command.payload.values as Record<string, unknown> };
      snapshot.userStates[0] = accepted; snapshot.seq++; saves.push(accepted);
      if (saves.length === 1) await firstReceipt;
      return route.fulfill({ json: { commandId: command.id, eventSeq: snapshot.seq, result: accepted } });
    }
    if (command.type === 'edit.end' && saves.length === 2) { endHeld = true; await finalEnd; }
    await route.fallback();
  });
  try {
    await page.goto('/');
    const selected = page.getByRole('checkbox', { name: 'Select row 1', exact: true });
    await expect(selected).toBeChecked();
    await selected.click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toMatchObject({ revision: 2, values: { selection: [] } });
    await selected.click(); await expect(selected).toBeChecked();
    // Revision 2 reaches the renderer while the newer local edit is still dirty.
    visibleState = structuredClone(saves[0]); snapshot.messages[0].content = 'Earlier projection received';
    await host.publish(); await expect(page.getByText('Earlier projection received', { exact: true })).toBeVisible();
    await expect(selected).toBeChecked(); releaseFirst();
    await expect.poll(() => endHeld).toBe(true);
    expect(saves[1]).toMatchObject({ revision: 3, values: { selection: ['row-0'] } });
    // The save receipt is authoritative before the next full snapshot arrives.
    snapshot.messages[0].content = 'Newer save acknowledged';
    await host.publish(); await expect(page.getByText('Newer save acknowledged', { exact: true })).toBeVisible();
    await expect(selected).toBeChecked(); expect(saves).toHaveLength(2);
    releaseEnd(); visibleState = structuredClone(saves[1]); await host.publish();
    await expect(page.locator('.save-state')).toHaveText('Saved');
    // A genuinely later host edit must still be applied.
    visibleState = { ...visibleState, revision: 4, values: { selection: [] } };
    snapshot.userStates[0] = visibleState; await host.publish();
    await expect(selected).not.toBeChecked();
    // Observe beyond the 500 ms autosave debounce: host updates must stay clean.
    await page.waitForTimeout(650);
    await expect(page.locator('.save-state')).toHaveText('Saved'); expect(saves).toHaveLength(2);
  } finally { releaseFirst(); releaseEnd(); }
});
