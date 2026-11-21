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

it('bounds a stalled close stage and force-releases instead of hanging', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gen-host-stall-'));
  const fixture = new HostFixture(folder, join(folder, 'unused.md'));
  try {
    await fixture.start();
    const realClose = fixture.host.close.bind(fixture.host);
    fixture.host.close = () => new Promise<never>(() => {});
    const started = performance.now();
    await fixture.close();
    const elapsed = performance.now() - started;
    const stalled = fixture.closeStages.find(stage => stage.phase === 'host.close');
    expect(stalled?.status).toBe('timed-out');
    expect(elapsed).toBeLessThan(60_000);
    expect(fixture.closeStages.every(stage => stage.status !== 'pending')).toBe(true);
    await realClose();
  } finally {
    try { await fixture.close(); } finally { await rm(folder, { recursive: true, force: true }); }
  }
}, 90_000);
