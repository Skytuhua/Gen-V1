import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync, constants as C } from "node:sqlite";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
const { mode, path, table, limit = 100, statements = [], expectedVersion, reservedJournal } = workerData;
const hash = () => {
  if (!statSync(path).isFile() || statSync(path).size > 256 * 1024 * 1024) throw new Error("Select a SQLite file of at most 256 MiB");
  if (existsSync(`${path}-wal`) || (!reservedJournal && existsSync(`${path}-journal`))) throw new Error("Active WAL/journal database unsupported; checkpoint and close it first");
  return createHash("sha256").update(readFileSync(path)).digest("hex");
};
let db, transaction = false, committed = false;
function integrity() { const rows = db.prepare("PRAGMA integrity_check").all(); if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") throw new Error("Database integrity check failed"); return "ok"; }
function schema() { return db.prepare("SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(); }
function authorizer(action, arg1, arg2, database) {
  const denied = [C.SQLITE_ATTACH, C.SQLITE_DETACH, C.SQLITE_PRAGMA, C.SQLITE_TRANSACTION, C.SQLITE_SAVEPOINT, C.SQLITE_CREATE_VTABLE, C.SQLITE_DROP_VTABLE, C.SQLITE_CREATE_TRIGGER, C.SQLITE_CREATE_TEMP_TRIGGER, C.SQLITE_CREATE_TEMP_TABLE, C.SQLITE_CREATE_TEMP_INDEX, C.SQLITE_CREATE_TEMP_VIEW];
  if (denied.includes(action) || (database && database !== "main") || (action === C.SQLITE_FUNCTION && ["load_extension", "writefile", "readfile"].includes((arg2 ?? arg1 ?? "").toLowerCase()))) return C.SQLITE_DENY;
  return C.SQLITE_OK;
}
try {
  const before = hash(); if (expectedVersion && before !== expectedVersion) throw new Error("Database resource version changed");
  db = new DatabaseSync(path, { readOnly: mode !== "execute", allowExtension: false, timeout: 1000, enableForeignKeyConstraints: true });
  if (typeof db.setAuthorizer !== "function") throw new Error("External SQLite operations require Node >=24.10 with setAuthorizer");
  db.enableLoadExtension(false);
  const journalMode = Object.values(db.prepare("PRAGMA journal_mode").get())[0];
  if (journalMode === "wal") throw new Error("WAL databases unsupported; select a closed rollback-journal database");
  // Host owns and pins this empty rollback-journal inode through COMMIT.
  // TRUNCATE preserves its identity; DELETE would require releasing the guard.
  if (mode === "execute" && reservedJournal) db.exec("PRAGMA journal_mode=TRUNCATE");
  integrity();
  if (mode === "inspect" || mode === "prepare") {
    const definitions = schema(); let rows = [], totalRows = null;
    if (table) {
      if (!definitions.some(d => d.name === table && d.type === "table")) throw new Error("Unknown table");
      const quoted = `"${table.replaceAll('"', '""')}"`;
      totalRows = db.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).get().n;
      rows = db.prepare(`SELECT * FROM ${quoted} LIMIT ?`).all(limit);
    }
    db.setAuthorizer(authorizer);
    for (const statement of statements) db.prepare(statement.sql); // Authorize, but never execute during preparation.
    db.setAuthorizer(null);
    const after = hash(); if (after !== before) throw new Error("Database changed while being inspected");
    parentPort.postMessage({ result: { resourceVersion: before, integrity: "ok", schema: definitions, rows, totalRows, journalMode } });
  } else if (mode === "execute") {
    db.exec("BEGIN IMMEDIATE"); transaction = true;
    if (hash() !== expectedVersion) throw new Error("Database resource version changed before transaction");
    let changes = 0; const results = [];
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      db.setAuthorizer(authorizer);
      const outcome = db.prepare(statement.sql).run(...(statement.params ?? []));
      db.setAuthorizer(null);
      // sqlite3_changes() retains the previous DML count across CREATE/ALTER/DROP.
      const count = /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(statement.sql) ? Number(outcome.changes) : 0;
      if (statement.expectedChanges !== undefined && count !== statement.expectedChanges) throw new Error(`Statement ${i + 1} changes count ${count} does not match expected ${statement.expectedChanges}`);
      changes += count; results.push({ index: i, changes: count, lastInsertRowid: outcome.lastInsertRowid });
      parentPort.postMessage({ progress: `Executed database statement ${i + 1}/${statements.length} (uncommitted)`, counts: { completed: i + 1, total: statements.length, changes } });
    }
    integrity();
    const violations = db.prepare("PRAGMA foreign_key_check").all(); if (violations.length) throw new Error("Database foreign key integrity failed");
    db.exec("COMMIT"); transaction = false; committed = true; db.close(); db = undefined;
    parentPort.postMessage({ result: { changes, statements: results, integrity: "ok", resourceVersion: hash() } });
  } else throw new Error("Unknown SQLite worker mode");
} catch (error) {
  if (db && transaction) { try { db.setAuthorizer(null); db.exec("ROLLBACK"); } catch { /* Preserve original failure. */ } }
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error), outcomeUnknown: committed });
} finally { db?.close(); }
