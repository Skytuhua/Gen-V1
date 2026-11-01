import { Worker } from "node:worker_threads";
import { lstat, mkdtemp, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readBoundFile, removeOwnedFile, withPathGuard } from "../core/file-access.ts";
import { HarnessError } from "../contracts/index.ts";
import type { DomainContext } from "./index.ts";
import type { DatabaseArgs } from "./schemas.ts";
export function validateStatements(args: DatabaseArgs): void {
  for (const statement of args.statements) {
    // One statement only. Restrict comment/semicolon syntax rather than attempt to parse arbitrary SQL.
    const sql = statement.sql.trim().replace(/;$/, "").trim();
    if (/;|--|\/\*|\*\//.test(sql)) throw new HarnessError("INVALID_SQL", "One SQL statement per entry; SQL comments are unsupported");
    const verb = sql.match(/^([A-Za-z]+)/)?.[1].toUpperCase();
    if (!verb || !["INSERT", "UPDATE", "DELETE", ...(args.mode === "migration" ? ["CREATE", "ALTER", "DROP"] : [])].includes(verb)) throw new HarnessError("INVALID_SQL", "Only approved DML or schema migration statements are allowed");
    if (["INSERT", "UPDATE", "DELETE"].includes(verb) && statement.expectedChanges === undefined) throw new HarnessError("INVALID_SQL", "DML requires an exact expectedChanges count");
    if (/\b(?:ATTACH|DETACH|PRAGMA|VACUUM|load_extension|writable_schema|VIRTUAL|TEMP|TRIGGER)\b/i.test(sql)) throw new HarnessError("INVALID_SQL", "Unsafe/unsupported SQL operation");
  }
}
export interface DatabaseResult { resourceVersion: string; integrity: string; changes?: number; [key: string]: unknown }
export async function databaseJob(job: Record<string, unknown>, ctx: DomainContext): Promise<DatabaseResult> {
  const source = String(job.path), cleanupSignal = new AbortController().signal;
  return withPathGuard([{ path: source, leaf: true }], ctx.signal, async () => {
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      try { await lstat(source + suffix); throw new HarnessError("DATABASE_ERROR", "Active WAL/journal database unsupported; checkpoint and close it first"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    async function reserved(path: string) {
      const journal = path + "-journal", handle = await open(journal, "wx");
      const identity = await handle.stat({ bigint: true }); await handle.close();
      try {
        return await withPathGuard([{ path, leaf: true }, { path: journal, leaf: true, dev: String(identity.dev), ino: String(identity.ino), empty: true }], ctx.signal, () => runWorker({ ...job, path, reservedJournal: true }, ctx));
      } finally {
        // Never erase hot recovery bytes, a replacement inode or a preexisting file.
        await removeOwnedFile(journal, identity, cleanupSignal, true).catch(() => {});
      }
    }
    if (job.mode === "execute") return reserved(source);
    const bytes = await readBoundFile(source, 256 * 1024 * 1024);
    const stage = await mkdtemp(join(tmpdir(), "harness-db-read-"));
    const stageIdentity = await lstat(stage, { bigint: true });
    try {
      return await withPathGuard([{ path: stage, leaf: false }], ctx.signal, async () => {
        const path = join(stage, "snapshot.sqlite"), handle = await open(path, "wx");
        const identity = await handle.stat({ bigint: true });
        try { await handle.writeFile(bytes); } finally { await handle.close(); }
        try {
          const result = await reserved(path);
          const current = await readBoundFile(source, 256 * 1024 * 1024);
          if (createHash("sha256").update(current).digest("hex") !== result.resourceVersion) throw new HarnessError("PRECONDITION_FAILED", "Database changed while being inspected");
          return result;
        } finally { await removeOwnedFile(path, identity, cleanupSignal).catch(() => {}); }
      });
    } finally { await removeOwnedFile(stage, stageIdentity, cleanupSignal, false, true).catch(() => {}); }
  });
}
async function runWorker(job: Record<string, unknown>, ctx: DomainContext): Promise<DatabaseResult> {
  if (ctx.signal.aborted) throw new HarnessError("CANCELLED", "Database operation cancelled");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./sqlite-worker.mjs", import.meta.url), { workerData: job, execArgv: [] });
    let finished = false;
    const finish = (error?: Error, value?: DatabaseResult) => {
      if (finished) return; finished = true; clearTimeout(timer); ctx.signal.removeEventListener("abort", abort);
      // Wait for termination so no SQLite work remains when the host records the outcome.
      void worker.terminate().then(() => error ? reject(error) : resolve(value!));
    };
    const abort = () => finish(new HarnessError(job.mode === "execute" ? "OPERATION_OUTCOME_UNKNOWN" : "CANCELLED", "Database worker cancelled; committed outcome must be checked if cancellation raced COMMIT"));
    const timer = setTimeout(() => finish(new HarnessError(job.mode === "execute" ? "OPERATION_OUTCOME_UNKNOWN" : "DATABASE_TIMEOUT", "Database worker exceeded 30 seconds; inspect the resource before retrying")), 30_000); timer.unref();
    ctx.signal.addEventListener("abort", abort, { once: true });
    worker.on("message", message => {
      if (message.progress) ctx.progress(message.progress, message.counts);
      else if (message.error) finish(new HarnessError(message.outcomeUnknown ? "OPERATION_OUTCOME_UNKNOWN" : "DATABASE_ERROR", message.error));
      else if (message.result) finish(undefined, message.result);
    });
    worker.once("error", error => finish(error));
    worker.once("exit", code => { if (!finished) finish(new HarnessError("DATABASE_WORKER_EXIT", `Database worker exited without result (${code})`)); });
    if (ctx.signal.aborted) abort();
  });
}
