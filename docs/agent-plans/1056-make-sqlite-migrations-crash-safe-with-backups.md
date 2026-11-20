<!-- Fix plan for https://github.com/skytuhua-org/Gen-V1/issues/1056 — mirrors the canonical plan in the issue body. -->

## Fix plan (rev 1)

### META

- Feature: Crash-safe, versioned SQLite migrations with automatic backup and restore, in `packages/storage`.
- Repo: `skytuhua-org/Gen-V1` (local: `/home/ubuntu/repos/Gen-V1`).
- Plan revision: 1, dated 2026-11-20.
- Baseline: `main` @ `7ef0710c90a479233f8dd9fe484a296f8c3c86d3` (verified via `git rev-parse HEAD`).
- Issue: https://github.com/skytuhua-org/Gen-V1/issues/1056. No linked PRs.
- Current implementation status: no migration runner exists; `Store` bootstraps schema inline and records `migrations.version = 1` unconditionally.
- Source provenance: plan authored by `devin-a-cloud-3d96bc` (review/planning claim) from direct code inspection at the baseline SHA; no code changed.

### OBJECTIVE

Today `Store`'s constructor (`packages/storage/store.ts` lines 54–66) opens `harness.sqlite`, sets pragmas, runs `CREATE TABLE IF NOT EXISTS` for `migrations`, `entities`, `events`, `receipts`, and executes `INSERT OR IGNORE INTO migrations(version) VALUES (1)`. Consequences:

- There is no way to ship a schema change. Any future `ALTER` would be untracked, non-transactional, and unordered.
- A crash or process kill between two DDL statements leaves the DB in an untracked intermediate state with no recovery path.
- Nothing backs up the database before schema changes; a bad migration destroys user data (threads, messages, receipts) permanently.
- A binary downgrade (older code opening a newer DB) silently continues against a schema it does not understand.

Success = migrations run in order, each inside its own `BEGIN IMMEDIATE` transaction; a backup file is written before any upgrade runs; a crash mid-migration leaves the store readable at the old version and re-runs cleanly on next open; a downgrade attempt fails loudly; a documented restore path exists and is tested.

### REQUIREMENTS

In scope:

- A migration registry and runner in `packages/storage` used by `Store`.
- Automatic pre-migration backup (synchronous, inside the same process, before any migration transaction opens).
- A restore entry point and a documented operator procedure.
- Loud refusal (typed `HarnessError`) when the on-disk version is newer than the code (`SCHEMA_VERSION`).
- Unit tests covering: crash mid-migration, downgrade attempt, restore from backup, no-backup-when-current, idempotent re-run, non-contiguous registry rejection.
- The design note required by the issue in the first PR body (options considered, choice, migration/rollback).

Out of scope (explicitly, per issue's "no behavior change" constraint and to keep PRs < 400 lines):

- Changing any existing table, index, or statement. `SCHEMA_VERSION` stays `1`; this PR adds the machinery, not a migration.
- Changing `Store`'s public API (`get/put/remove/command/internal/snapshot/messagesFor/subscribe/eventsAfter/close`) or event semantics.
- Remote/off-device backup, scheduled backups, backup retention/pruning policies beyond a simple keep-last-N constant.
- `packages/capabilities/database.ts` (the skill-facing gated SQL executor) — not a store migration concern.
- `packages/workspace/git-storage.ts` — separate storage engine, not SQLite.

Compatibility/error requirements:

- WAL mode is already enabled (`PRAGMA journal_mode=WAL` at store.ts:58); backup must include WAL content, achieved by `PRAGMA wal_checkpoint(TRUNCATE)` before copying the main file.
- A backup is only taken when `currentVersion < SCHEMA_VERSION` (i.e. pending work exists). First-time databases (fresh `migrations` table seeded at v1) never trigger a backup.
- All failures surface as `HarnessError` with stable codes: `STORAGE_DOWNGRADE_UNSUPPORTED`, `MIGRATION_FAILED`, `BACKUP_FAILED`, `RESTORE_INVALID_BACKUP`.
- Backup filenames must be filesystem-safe on Windows (no `:` in timestamps).
- Privacy/security: backups live beside the DB inside `dataDir/backups/` (same directory permissions); they are never transmitted.

### REPO_MAP (verified at baseline)

- `packages/storage/store.ts` — `Store` class; constructor lines 54–106 open the DB and run inline DDL (lines 59–66). `dataDir` is canonicalized via `realpathSync` (line 56). `commit()` lines 164–182 already uses `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` — the same transaction idiom migrations reuse.
- `packages/storage/secret-codec.ts` — DPAPI codec; unrelated, untouched.
- `packages/contracts/index.ts` — exports `HarnessError` (used for typed errors, same as store.ts line 7).
- Node `>=24.10.0` (package.json `engines`); `node:sqlite` `DatabaseSync` is the only SQLite driver in `packages/storage`.
- Callers constructing `new Store(dataDir)`: `apps/server/host.ts`, `apps/server/server.ts`, plus test fixtures (`tests/store.test.ts`, `tests/checkpoint-restore-v3.test.ts`, `tests/memory-storage-boundary-v3.test.ts`, `tests/account-storage-boundary.test.ts`, `tests/credential-store.test.ts`). Constructor must remain backward compatible — all new parameters optional.
- `tests/store.test.ts` — existing store test patterns (temp dirs under `os.tmpdir()`).
- Discovery note: no file in `packages/storage` today imports anything for backups; `node:sqlite` exposes a module-level `backup()` (async) but the design below uses synchronous `wal_checkpoint` + `copyFileSync` so the `Store` constructor stays synchronous.

### DESIGN

New file `packages/storage/migrations.ts` (exact exported surface):

```ts
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
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

export function currentVersion(db: DatabaseSync): number;
export function applyMigrations(db: DatabaseSync, dataDir: string, migrations: readonly Migration[], targetVersion?: number): { backupPath: string | null };
export function backupDatabaseSync(db: DatabaseSync, dataDir: string, toVersion: number): string;
export function listBackups(dataDir: string): string[];
export function restoreBackup(dataDir: string, backupFile: string): string;
```

Semantics, exactly:

- `currentVersion(db)` → `SELECT COALESCE(MAX(version), 0) AS v FROM migrations`; returns `0` on a DB whose `migrations` table was just created empty (impossible today — v1 is inserted at bootstrap — but kept for tests).
- `applyMigrations(db, dataDir, migrations, targetVersion = SCHEMA_VERSION)` returns `{ backupPath }` — `targetVersion` exists so tests can register and apply a v2 migration while the binary's `SCHEMA_VERSION` stays `1`:
  1. Validate the registry once: versions are unique positive integers; reject gaps relative to `from = currentVersion(db)` — every `m.version` in `(from, targetVersion]` must be present exactly once; else throw `HarnessError('MIGRATION_FAILED', 'Migration registry is not contiguous')`.
  2. `if (current > targetVersion) throw new HarnessError('STORAGE_DOWNGRADE_UNSUPPORTED', ...)` — before any write.
  3. `if (pending.length && db is file-backed) backupDatabaseSync(db, dataDir, targetVersion)`.
  4. For each pending migration in ascending order: `db.exec("BEGIN IMMEDIATE")`; `m.up(db)`; `INSERT INTO migrations(version) VALUES (?)` with `m.version`; `db.exec("COMMIT")`. On any throw: `db.exec("ROLLBACK")` (guarded by its own try/catch), rethrow `HarnessError('MIGRATION_FAILED', `Migration ${m.version} (${m.name}) failed: ${msg}`, {cause})`.
- `backupDatabaseSync(db, dataDir, toVersion)`:
  1. `mkdirSync(join(dataDir, "backups"), { recursive: true })`.
  2. `db.exec("PRAGMA wal_checkpoint(TRUNCATE)")` — folds WAL into the main file; `-wal`/`-shm` then hold nothing uncommitted.
  3. `const name = `harness-v${currentVersion(db)}-pre-v${toVersion}-${yyyymmddThhmmssZ}.sqlite`` (timestamp via `new Date().toISOString().replace(/[-:]/g,"").replace(/\..+/,"Z")` — Windows-safe).
  4. `copyFileSync(join(dataDir,"harness.sqlite"), join(dataDir,"backups",name))`; return the absolute path. Wrap failures in `BACKUP_FAILED`.
  5. Keep at most 5 backups: after writing, delete oldest files beyond 5 (sorted by name; names sort chronologically).
- `restoreBackup(dataDir, backupFile)`:
  1. Reject `backupFile` that is not a plain filename (`backupFile` must equal its `basename` and match `/^harness-v\d+-pre-v\d+-\d{8}T\d{6}Z\.sqlite$/`) → `RESTORE_INVALID_BACKUP`.
  2. Source `join(dataDir,"backups",backupFile)` must exist → else `RESTORE_INVALID_BACKUP`.
  3. `copyFileSync(src, join(dataDir,"harness.sqlite"))`, then `rmSync` any `harness.sqlite-wal`/`-shm` in `dataDir` (stale WAL must not replay over the restored file). Return the restored path.
  - Documented operator flow: close all `Store` handles → `restoreBackup(dir, file)` → reopen. Restore never runs inside a live `Store`.
- `Store` constructor change (minimal, backward compatible):
  - New optional second parameter: `constructor(dataDir: string, options?: { readonly migrations?: readonly Migration[] })`.
  - After the existing pragma line, replace the inline DDL block with: keep `CREATE TABLE IF NOT EXISTS migrations` bootstrap plus the three baseline tables **unchanged** (baseline schema creation is not itself a migration — existing DBs must not re-run it), then `const { backupPath } = applyMigrations(this.db, this.dataDir, options?.migrations ?? [])` and assign `this.lastBackupPath = backupPath`.
  - `applyMigrations` performs steps 2–4 above; `backupDatabaseSync` needs `dataDir` — the runner signature carries it (`applyMigrations(db, dataDir, migrations, targetVersion)`).
  - Store the last backup path on the instance for diagnostics: `readonly lastBackupPath: string | null` (set by the runner via an out-param or a small internal hook — simplest: `backupDatabaseSync` returns the path and the constructor assigns it before calling `applyMigrations`; to keep one call site, `applyMigrations` returns `{ backupPath: string | null }`).

Error/cancel/retry: a failed migration rolls back its own transaction; the store stays at the last committed version and the next open retries the same migration. No partial `migrations` row is ever committed. Restore is destructive (overwrites `harness.sqlite`) and therefore only callable as a top-level function, never automatically.

Security boundary: backups and restore paths never leave `dataDir`; `restoreBackup` validates the filename pattern and stays inside `dataDir/backups` (verify with `resolve(src).startsWith(resolve(backupsDir) + sep)`).

### EXECUTION_DAG

- **T01 — Migration registry + runner** (file: `packages/storage/migrations.ts`, new, ~120 lines). Implements `Migration`, `SCHEMA_VERSION`, `currentVersion`, `applyMigrations(db, dataDir, migrations, targetVersion = SCHEMA_VERSION)` returning `{ backupPath }`, `backupDatabaseSync`, `listBackups`, `restoreBackup` per DESIGN. Deps: none. Done when: module compiles (`pnpm typecheck`), exported surface matches exactly. Tests: T03.
- **T02 — Wire into `Store`** (`packages/storage/store.ts`, ~15-line diff). Add optional `options.migrations` ctor param; keep baseline DDL; call `applyMigrations`; expose `lastBackupPath`. Deps: T01. Done when: `new Store(dir)` behaves identically on a v1 DB (no backup, no error); existing store tests still pass.
- **T03 — Unit tests** (`tests/storage-migrations.test.ts`, new). Cases, each with a temp dir under `os.tmpdir()`. v2-migration cases call `applyMigrations(db, dir, [v2], 2)` directly — the `Store` ctor path always uses the default `targetVersion = SCHEMA_VERSION` (production DBs are at v1), so it is exercised only by the no-migration cases:
  1. Fresh DB via `new Store(dir)`: version 1, `lastBackupPath === null`, `listBackups` empty.
  2. Pending migration runs: `applyMigrations(db, dir, [v2], 2)` where v2 adds a column/table → version 2, backup file exists matching the name pattern, backup DB opens at v1.
  3. Crash mid-migration: v2 migration that `db.exec` a valid statement then `throw new Error("boom")` → `MIGRATION_FAILED`; reopen with no migrations → still v1, entities table readable; `applyMigrations(db, dir, [v2fixed], 2)` → succeeds (idempotent).
  4. Downgrade: hand-craft DB at version 3 (`INSERT INTO migrations VALUES (3)`), `applyMigrations(db, dir, [v2], 2)` → `STORAGE_DOWNGRADE_UNSUPPORTED` (a `new Store(dir)` on the same file throws it too, since the default `targetVersion` is 1).
  5. Restore: create data, migrate to v2 (backup taken), corrupt/delete rows, `close()`, `restoreBackup(dir, backupName)`, reopen → original v1 data present.
  6. `restoreBackup` rejects `../evil` and nonexistent names with `RESTORE_INVALID_BACKUP`.
  7. Non-contiguous registry ([v2, v4] without v3) with `targetVersion` 4 → `MIGRATION_FAILED` before any write.
  Deps: T01, T02. Done when: `pnpm exec vitest run tests/storage-migrations.test.ts` green.
- **T04 — PR** one PR (< 400 lines, one concern): the three files above. PR body contains the required short design note (options: async `node:sqlite` `backup()` vs sync checkpoint+copy — chose sync to keep ctor sync; per-migration transactions vs one big transaction — chose per-migration so a crash commits prior steps). Deps: T01–T03.

### VALIDATION

Planned (not yet executed — review-only session):

- `pnpm exec vitest run tests/storage-migrations.test.ts` — all 7 cases pass.
- `pnpm exec vitest run tests/store.test.ts tests/checkpoint-restore-v3.test.ts` — no regressions.
- `pnpm typecheck && pnpm lint` — clean.
- Manual check: `new Store(tmp)` twice → second open performs no backup and no migration work.
- Acceptance matrix: issue "Done when" items 1 (crash mid-migration, downgrade, restore covered) maps to T03 cases 3–5; `pnpm lint/typecheck/test` maps to the commands above.

### STATE

Researched/decided: full design above, all file/line references verified at baseline. Implemented: nothing (review-only). Verified: nothing executed. Pending: T01–T04 unowned — first implementation worker claims them in a checkpoint on this issue. Risks: `wal_checkpoint(TRUNCATE)` can block on a concurrent reader — `busy_timeout=5000` is already set; document that backups may wait up to 5 s. Exact next step: implement T01.

### REFERENCES

- `packages/storage/store.ts` lines 54–66 (bootstrap), 164–182 (transaction idiom) at `7ef0710c`.
- Node docs: `node:sqlite` `DatabaseSync`, `PRAGMA wal_checkpoint`, `PRAGMA busy_timeout`.
- Issue contract: https://github.com/skytuhua-org/Gen-V1/issues/1056; AGENTS.md plan-publication contract.

