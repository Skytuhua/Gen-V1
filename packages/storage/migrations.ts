import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HarnessError } from "../contracts/index.ts";

/** One schema step. version must be a positive integer, applied strictly in
 * ascending order, each inside its own BEGIN IMMEDIATE transaction. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: (db: DatabaseSync) => void;
}

/** Highest schema version this binary understands. Bump when adding a Migration. */
export const SCHEMA_VERSION = 1;

const KEEP_BACKUPS = 5;
const BACKUP_NAME = /^harness-v\d+-pre-v\d+-\d{8}T\d{6}Z\.sqlite$/;

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM migrations").get() as { v: number };
  return row.v;
}

/** Runs every pending migration in ascending order inside its own transaction.
 * Returns the pre-migration backup path when a backup was taken. */
export function applyMigrations(db: DatabaseSync, dataDir: string, migrations: readonly Migration[]): { backupPath: string | null } {
  const from = currentVersion(db);
  if (from > SCHEMA_VERSION) throw new HarnessError("STORAGE_DOWNGRADE_UNSUPPORTED", `Database schema version ${from} is newer than this binary supports (${SCHEMA_VERSION}).`);
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version < 1 || seen.has(migration.version)) throw new HarnessError("MIGRATION_FAILED", "Migration registry has an invalid or duplicate version");
    seen.add(migration.version);
  }
  const pending = migrations.filter(migration => migration.version > from).sort((a, b) => a.version - b.version);
  // Pending steps must be gap-free from `from + 1` and cover every version this binary owns.
  if (pending.some((migration, index) => migration.version !== from + index + 1) || (from < SCHEMA_VERSION && pending.length !== SCHEMA_VERSION - from)) throw new HarnessError("MIGRATION_FAILED", "Migration registry is not contiguous");
  let backupPath: string | null = null;
  if (pending.length && fileBacked(db)) backupPath = backupDatabaseSync(db, dataDir, SCHEMA_VERSION);
  for (const migration of pending) {
    try {
      db.exec("BEGIN IMMEDIATE");
      migration.up(db);
      db.prepare("INSERT INTO migrations(version) VALUES (?)").run(migration.version);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* The failed transaction may have already released itself. */ }
      const message = error instanceof Error ? error.message : String(error);
      throw new HarnessError("MIGRATION_FAILED", `Migration ${migration.version} (${migration.name}) failed: ${message}`, { cause: error });
    }
  }
  return { backupPath };
}

function fileBacked(db: DatabaseSync): boolean {
  const rows = db.prepare("PRAGMA database_list").all() as { name: string; file: string }[];
  return rows.some(row => row.name === "main" && row.file !== "");
}

export function backupDatabaseSync(db: DatabaseSync, dataDir: string, toVersion: number): string {
  const backupsDir = join(dataDir, "backups");
  try {
    mkdirSync(backupsDir, { recursive: true });
    // Fold the WAL into the main file first so the copy holds every committed byte.
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
    const name = `harness-v${currentVersion(db)}-pre-v${toVersion}-${stamp}.sqlite`;
    const target = join(backupsDir, name);
    copyFileSync(join(dataDir, "harness.sqlite"), target);
    const backups = readdirSync(backupsDir).filter(file => BACKUP_NAME.test(file)).sort();
    for (const stale of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) rmSync(join(backupsDir, stale));
    return target;
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessError("BACKUP_FAILED", `Could not back up the store before migration: ${message}`, { cause: error });
  }
}

export function listBackups(dataDir: string): string[] {
  const backupsDir = join(dataDir, "backups");
  if (!existsSync(backupsDir)) return [];
  return readdirSync(backupsDir).filter(file => BACKUP_NAME.test(file)).sort();
}

/** Restore is destructive and must never run inside a live Store: close every
 * handle, call this, then reopen. */
export function restoreBackup(dataDir: string, backupFile: string): string {
  const backupsDir = join(dataDir, "backups");
  const source = join(backupsDir, backupFile);
  if (backupFile !== basename(backupFile) || !BACKUP_NAME.test(backupFile) || !resolve(source).startsWith(resolve(backupsDir) + sep) || !existsSync(source)) {
    throw new HarnessError("RESTORE_INVALID_BACKUP", "Select a backup file inside the store backups directory.");
  }
  const target = join(dataDir, "harness.sqlite");
  copyFileSync(source, target);
  // A stale WAL must never replay over the restored file.
  for (const suffix of ["-wal", "-shm"]) { const stray = target + suffix; if (existsSync(stray)) rmSync(stray); }
  return target;
}
