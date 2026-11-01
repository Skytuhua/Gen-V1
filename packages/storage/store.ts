import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { HarnessError, type CommandReceipt, type HostCommand, type Snapshot, type WorkspaceEvent } from "../contracts/index.ts";

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalized(v)]));
  return value;
}
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(normalized(value))).digest("hex"); }

export class Store {
  readonly db: DatabaseSync;
  readonly dataDir: string;
  private listeners = new Set<(event: WorkspaceEvent) => void>();
  private transactionOpen = false;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = realpathSync(dataDir);
    this.db = new DatabaseSync(join(this.dataDir, "harness.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, thread_id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS entities_thread ON entities(kind,thread_id);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, type TEXT NOT NULL, thread_id TEXT, payload TEXT NOT NULL, occurred_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations(version) VALUES (1);
    `);
  }
  get<T = unknown>(kind: string, id: string): T | null {
    const row = this.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as T : null;
  }
  all<T = unknown>(kind: string, threadId?: string): T[] {
    const rows = (threadId === undefined ? this.db.prepare("SELECT body FROM entities WHERE kind=?").all(kind) : this.db.prepare("SELECT body FROM entities WHERE kind=? AND thread_id=?").all(kind, threadId)) as { body: string }[];
    return rows.map(row => JSON.parse(row.body) as T);
  }
  put(kind: string, id: string, threadId: string | null, value: unknown): void {
    if (!this.transactionOpen) throw new Error("Projection writes require a command transaction");
    this.db.prepare("INSERT INTO entities(kind,id,thread_id,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET thread_id=excluded.thread_id,body=excluded.body").run(kind, id, threadId, JSON.stringify(value));
  }
  remove(kind: string, id: string): void {
    if (!this.transactionOpen) throw new Error("Projection writes require a command transaction");
    this.db.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind, id);
  }
  receipt(command: HostCommand): CommandReceipt | null {
    const row = this.db.prepare("SELECT hash,body FROM receipts WHERE id=?").get(command.id) as { hash: string; body: string } | undefined;
    if (!row) return null;
    if (row.hash !== digest(command)) throw new HarnessError("DUPLICATE_COMMAND", "Command ID reused with different content");
    return JSON.parse(row.body) as CommandReceipt;
  }
  command(command: HostCommand, apply: () => unknown): CommandReceipt {
    const existing = this.receipt(command); if (existing) return existing;
    const {event,result}=this.commit(command.type,command.threadId??null,apply,command);
    return {commandId:command.id,eventSeq:event.seq,result};
  }
  private commit(type: string, threadId: string | null, apply: () => unknown, command?: HostCommand): {event:WorkspaceEvent;result:unknown} {
    if (this.transactionOpen) throw new Error("Nested command transaction");
    this.db.exec("BEGIN IMMEDIATE"); this.transactionOpen = true;
    let event: WorkspaceEvent;
    let result: unknown;
    try {
      result = apply() ?? null;
      if (result && typeof (result as Promise<unknown>).then === "function") throw new Error("Async work cannot run in a SQLite transaction");
      const id = randomUUID(), occurredAt = new Date().toISOString();
      const inserted = this.db.prepare("INSERT INTO events(id,type,thread_id,payload,occurred_at) VALUES(?,?,?,?,?)").run(id, type, threadId, JSON.stringify({ result }), occurredAt);
      event = { seq: Number(inserted.lastInsertRowid), id, type, threadId, payload: { result }, occurredAt };
      if(command){const receipt:CommandReceipt={commandId:command.id,eventSeq:event.seq,result};this.db.prepare("INSERT INTO receipts(id,hash,body) VALUES(?,?,?)").run(command.id,digest(command),JSON.stringify(receipt));}
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.transactionOpen = false; }
    for (const listener of this.listeners) { try { listener(event!); } catch { /* A subscriber cannot roll back a committed command. */ } }
    return {event:event!,result};
  }
  internal(type: string, threadId: string | null, apply: () => unknown): unknown {
    return this.commit(type,threadId,apply).result;
  }
  eventsAfter(seq: number, limit?: number): WorkspaceEvent[] {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) throw new HarnessError('INVALID_INPUT', 'Event page size must be between 1 and 1000');
    const statement = this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq" + (limit === undefined ? '' : ' LIMIT ?'));
    const rows = (limit === undefined ? statement.all(seq) : statement.all(seq, limit)) as unknown as { seq: number; id: string; type: string; thread_id: string | null; payload: string; occurred_at: string }[];
    return rows.map(row => ({ seq: row.seq, id: row.id, type: row.type, threadId: row.thread_id, payload: JSON.parse(row.payload), occurredAt: row.occurred_at }));
  }
  get sequence(): number { return Number((this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get() as { seq: number }).seq); }
  snapshot(): Snapshot {
    const allThreads = this.all<Snapshot["threads"][number]>("thread");
    const archivedRows = this.db.prepare("SELECT id,body FROM entities WHERE kind=?").all("archivedThread") as { id: string; body: string }[];
    const archived = new Set(archivedRows.filter(row => JSON.parse(row.body)).map(row => row.id));
    const threads = allThreads.filter(thread => !archived.has(thread.id));
    const artifacts = this.all<Snapshot["artifacts"][number]>("artifact"), requests = this.all<Snapshot["requests"][number]>("request");
    const data = this.all<Snapshot["data"][number]>("data"), seen = new Set(data.map(d => d.id + "@" + d.revision));
    const refs = [...artifacts.flatMap(a => Object.values(a.bindings).flatMap(b => b.mode === "snapshot" ? [b.ref] : [])), ...requests.flatMap(r => r.basis)];
    for (const ref of refs) { const key = ref.id + "@" + ref.revision; if (!seen.has(key)) { const item = this.get<Snapshot["data"][number]>("dataVersion", key); if (item) { data.push(item); seen.add(key); } } }
    return {
      seq: this.sequence, threads, archivedThreads: allThreads.filter(thread => archived.has(thread.id)), messages: this.all("message"), artifacts, userStates: this.all("userState"),
      data, requests, accounts: this.all('account'), operations: this.all("operation"), resources: this.all("resource"), memory: this.all('taskMemory'),
      usage: Object.fromEntries(this.all<{ id: string; value: unknown }>("usage").map(x => [x.id, x.value])) as Snapshot["usage"],
      settings: this.get("settings", "global") ?? { theme: "dark", modelId: null },
      activeThreadId: threads.find(t => !t.sideParentId && t.runId !== null && (t.status === "working" || t.status === "awaiting_input"))?.id ?? null
    };
  }
  subscribe(listener: (event: WorkspaceEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close(): void { this.listeners.clear(); this.db.close(); }
}
