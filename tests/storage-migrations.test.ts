import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../packages/storage/store.ts";
import { applyMigrations, backupDatabaseSync, currentVersion, listBackups, restoreBackup, type Migration } from "../packages/storage/migrations.ts";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });
function dir() { const d = mkdtempSync(join(tmpdir(), "harness-migrations-")); cleanups.push(() => rmSync(d, { recursive: true, force: true })); return d; }

const v2: Migration = { version: 2, name: "add migration probe column", up: db => db.exec("ALTER TABLE entities ADD COLUMN probe TEXT") };

describe("crash-safe migrations", () => {
  it("opens a fresh store at version 1 with no backup or migration work", () => {
    const d = dir(); const store = new Store(d); cleanups.push(() => store.close());
    expect(currentVersion(store.db)).toBe(1);
    expect(store.lastBackupPath).toBeNull();
    expect(listBackups(d)).toEqual([]);
    store.close(); cleanups.pop();
    const reopen = new Store(d); cleanups.push(() => reopen.close());
    expect(reopen.lastBackupPath).toBeNull(); expect(listBackups(d)).toEqual([]);
  });

  it("runs a pending migration inside one transaction and keeps a pre-migration backup", () => {
    const d = dir(); const seeded = new Store(d); seeded.close();
    const store = new Store(d, { migrations: [v2] }); cleanups.push(() => store.close());
    expect(currentVersion(store.db)).toBe(2);
    const backups = listBackups(d);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^harness-v1-pre-v1-\d{8}T\d{6}Z\.sqlite$/);
    expect(store.lastBackupPath).toBe(join(d, "backups", backups[0]));
    const backup = new DatabaseSync(join(d, "backups", backups[0])); cleanups.push(() => backup.close());
    expect(currentVersion(backup)).toBe(1);
  });

  it("rolls back a crashed migration, stays at the old version and re-runs cleanly", () => {
    const d = dir(); const seeded = new Store(d); seeded.close();
    const crashing: Migration = { version: 2, name: "crash after one write", up: db => { db.exec("CREATE TABLE scratch (id TEXT)"); throw new Error("boom"); } };
    expect(() => new Store(d, { migrations: [crashing] })).toThrowError(expect.objectContaining({ code: "MIGRATION_FAILED" }));
    const plain = new Store(d); cleanups.push(() => plain.close());
    expect(currentVersion(plain.db)).toBe(1);
    expect(() => plain.db.prepare("SELECT id FROM scratch")).toThrow();
    plain.close(); cleanups.pop();
    const fixed = new Store(d, { migrations: [v2] }); cleanups.push(() => fixed.close());
    expect(currentVersion(fixed.db)).toBe(2);
    expect(listBackups(d).length).toBeGreaterThanOrEqual(1);
  });

  it("refuses a database newer than this binary without writing", () => {
    const d = dir(); const db = new DatabaseSync(join(d, "harness.sqlite")); cleanups.push(() => db.close());
    db.exec("CREATE TABLE migrations (version INTEGER PRIMARY KEY); INSERT INTO migrations(version) VALUES (3)");
    expect(() => applyMigrations(db, d, [])).toThrowError(expect.objectContaining({ code: "STORAGE_DOWNGRADE_UNSUPPORTED" }));
    expect(currentVersion(db)).toBe(3);
  });

  it("restores a pre-migration backup over a corrupted store", () => {
    const d = dir(); const seeded = new Store(d);
    seeded.internal("fixture", null, () => seeded.put("data", "kept", null, { id: "kept", revision: 1, value: "before" }));
    seeded.close();
    const migrated = new Store(d, { migrations: [v2] }); const backup = listBackups(d)[0]; migrated.close();
    const corrupted = new DatabaseSync(join(d, "harness.sqlite"));
    corrupted.exec("DELETE FROM entities; INSERT INTO migrations(version) VALUES (9)"); corrupted.close();
    restoreBackup(d, backup);
    const reopened = new Store(d, { migrations: [v2] }); cleanups.push(() => reopened.close());
    expect(reopened.get<{ value: string }>("data", "kept")?.value).toBe("before");
    expect(currentVersion(reopened.db)).toBe(2);
  }, 120000);

  it.each(["../evil", "harness.sqlite", "harness-v1-pre-v1-badname.sqlite", "harness-v9-pre-v9-20990101T000000Z.sqlite"])(
    "rejects invalid or missing backup names: %s", name => {
      const d = dir();
      expect(() => restoreBackup(d, name)).toThrowError(expect.objectContaining({ code: "RESTORE_INVALID_BACKUP" }));
    });

  it("rejects a non-contiguous registry before any write", () => {
    const d = dir(); const seeded = new Store(d); seeded.close();
    const v4: Migration = { version: 4, name: "skipped v3", up: () => {} };
    expect(() => new Store(d, { migrations: [v2, v4] })).toThrowError(expect.objectContaining({ code: "MIGRATION_FAILED" }));
    const plain = new Store(d); cleanups.push(() => plain.close());
    expect(currentVersion(plain.db)).toBe(1);
    expect(listBackups(d)).toEqual([]);
  });

  it("keeps at most five backups", () => {
    const d = dir(); const seeded = new Store(d); seeded.close();
    const db = new DatabaseSync(join(d, "harness.sqlite")); cleanups.push(() => db.close());
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 7; i++) { vi.setSystemTime(new Date(2026, 0, 1, 0, 0, i)); backupDatabaseSync(db, d, 2); }
    } finally { vi.useRealTimers(); }
    expect(listBackups(d)).toHaveLength(5);
  });
});
