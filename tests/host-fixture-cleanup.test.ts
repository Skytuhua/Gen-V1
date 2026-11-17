import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Store } from '../packages/storage/store.ts';
import { HostFixture } from './host-fixture.ts';

it('shares host fixture cleanup across concurrent and repeated teardown calls', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gen-host-close-'));
  const fixture = new HostFixture(folder, join(folder, 'unused.md'));
  fixture.store = new Store(join(folder, 'storage'));
  try {
    await expect(Promise.all([fixture.close(), fixture.close()])).resolves.toEqual([undefined, undefined]);
    await expect(fixture.close()).resolves.toBeUndefined();
  } finally {
    try { fixture.store.close(); } catch { /* Cleanup already ran. */ }
    await rm(folder, { recursive: true, force: true });
  }
});

it('closes the replacement generation after a real fixture restart', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gen-host-restart-'));
  const fixture = new HostFixture(folder, join(folder, 'unused.md'));
  try {
    await fixture.start();
    const previous = fixture.store;
    await fixture.restart();
    expect(fixture.store === previous).toBe(false);
    expect(() => previous.snapshot()).toThrow(/database is not open|statement has been finalized/);
    expect(fixture.snapshot().threads).toEqual([]);
    await fixture.close();
    expect(() => fixture.snapshot()).toThrow(/database is not open|statement has been finalized/);
  } finally {
    try { await fixture.close(); } finally { await rm(folder, { recursive: true, force: true }); }
  }
});
