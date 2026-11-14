import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
const MESSAGE_WINDOW = 300;

import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { HarnessError, type CommandReceipt, type HostCommand, type Message, type Snapshot, type WorkspaceEvent } from "../contracts/index.ts";

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
  private committedEvents: WorkspaceEvent[] = [];
  private drainingEvents = false;
  private readonly statements: {
    get: ReturnType<DatabaseSync['prepare']>;
    allKind: ReturnType<DatabaseSync['prepare']>;
    allKindThread: ReturnType<DatabaseSync['prepare']>;
    messageCursor: ReturnType<DatabaseSync['prepare']>;
    messageTail: ReturnType<DatabaseSync['prepare']>;
    messageBefore: ReturnType<DatabaseSync['prepare']>;
    messageCount: ReturnType<DatabaseSync['prepare']>;
    messageCountBefore: ReturnType<DatabaseSync['prepare']>;
    put: ReturnType<DatabaseSync['prepare']>;
    remove: ReturnType<DatabaseSync['prepare']>;
    receipt: ReturnType<DatabaseSync['prepare']>;
    insertEvent: ReturnType<DatabaseSync['prepare']>;
    insertReceipt: ReturnType<DatabaseSync['prepare']>;
    eventsAfter: ReturnType<DatabaseSync['prepare']>;
    eventsAfterLimit: ReturnType<DatabaseSync['prepare']>;
    sequence: ReturnType<DatabaseSync['prepare']>;
  };
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
    this.statements = {
      get: this.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?"),
      // rowid order is insertion order: callers rely on chronological message
      // order for windowing, cursor paging, and tail slices.
      allKind: this.db.prepare("SELECT body FROM entities WHERE kind=? ORDER BY rowid"),
      allKindThread: this.db.prepare("SELECT body FROM entities WHERE kind=? AND thread_id=? ORDER BY rowid"),
      messageCursor: this.db.prepare("SELECT rowid FROM entities WHERE kind='message' AND id=? AND thread_id=?"),
      messageTail: this.db.prepare("SELECT body FROM entities WHERE kind='message' AND thread_id=? ORDER BY rowid DESC LIMIT ?"),
      messageBefore: this.db.prepare("SELECT body FROM entities WHERE kind='message' AND thread_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?"),
      messageCount: this.db.prepare("SELECT count(*) AS count FROM entities WHERE kind='message' AND thread_id=?"),
      messageCountBefore: this.db.prepare("SELECT count(*) AS count FROM entities WHERE kind='message' AND thread_id=? AND rowid<?"),
      put: this.db.prepare("INSERT INTO entities(kind,id,thread_id,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET thread_id=excluded.thread_id,body=excluded.body"),
      remove: this.db.prepare("DELETE FROM entities WHERE kind=? AND id=?"),
      receipt: this.db.prepare("SELECT hash,body FROM receipts WHERE id=?"),
      insertEvent: this.db.prepare("INSERT INTO events(id,type,thread_id,payload,occurred_at) VALUES(?,?,?,?,?)"),
      insertReceipt: this.db.prepare("INSERT INTO receipts(id,hash,body) VALUES(?,?,?)"),
      eventsAfter: this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq"),
      eventsAfterLimit: this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?"),
      sequence: this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events"),
    };
  }
  get<T = unknown>(kind: string, id: string): T | null {
    const row = this.statements.get.get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as T : null;
  }
  all<T = unknown>(kind: string, threadId?: string): T[] {
    const rows = (threadId === undefined ? this.statements.allKind.all(kind) : this.statements.allKindThread.all(kind, threadId)) as { body: string }[];
    return rows.map(row => JSON.parse(row.body) as T);
  }
  put(kind: string, id: string, threadId: string | null, value: unknown): void {
    if (!this.transactionOpen) throw new Error("Projection writes require a command transaction");
    this.statements.put.run(kind, id, threadId, JSON.stringify(value));
  }
  remove(kind: string, id: string): void {
    if (!this.transactionOpen) throw new Error("Projection writes require a command transaction");
    this.statements.remove.run(kind, id);
  }
  receipt(command: HostCommand): CommandReceipt | null {
    const row = this.statements.receipt.get(command.id) as { hash: string; body: string } | undefined;
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
      if (result && typeof (result as Promise<unknown>).then === "function") { void Promise.resolve(result).catch(() => {}); throw new Error("Async work cannot run in a SQLite transaction"); }
      const id = randomUUID(), occurredAt = new Date().toISOString();
      const inserted = this.statements.insertEvent.run(id, type, threadId, JSON.stringify({ result }), occurredAt);
      event = { seq: Number(inserted.lastInsertRowid), id, type, threadId, payload: { result }, occurredAt };
      if(command){const receipt:CommandReceipt={commandId:command.id,eventSeq:event.seq,result};this.statements.insertReceipt.run(command.id,digest(command),JSON.stringify(receipt));}
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    finally { this.transactionOpen = false; }
    this.committedEvents.push(event!);
    this.drainCommittedEvents();
    return {event:event!,result};
  }
  private drainCommittedEvents(): void {
    if (this.drainingEvents) return;
    this.drainingEvents = true;
    try {
      // Reentrant commits wait until every listener has seen the current event.
      while (this.committedEvents.length) {
        const event = this.committedEvents.shift()!;
        for (const listener of this.listeners) { try { listener(event); } catch { /* A subscriber cannot roll back a committed command. */ } }
      }
    } finally { this.drainingEvents = false; }
  }
  internal(type: string, threadId: string | null, apply: () => unknown): unknown {
    return this.commit(type,threadId,apply).result;
  }
  eventsAfter(seq: number, limit?: number): WorkspaceEvent[] {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)) throw new HarnessError('INVALID_INPUT', 'Event page size must be between 1 and 1000');
    const rows = (limit === undefined ? this.statements.eventsAfter.all(seq) : this.statements.eventsAfterLimit.all(seq, limit)) as unknown as { seq: number; id: string; type: string; thread_id: string | null; payload: string; occurred_at: string }[];
    return rows.map(row => ({ seq: row.seq, id: row.id, type: row.type, threadId: row.thread_id, payload: JSON.parse(row.payload), occurredAt: row.occurred_at }));
  }
  get sequence(): number { return Number((this.statements.sequence.get() as { seq: number }).seq); }
  snapshot(): Snapshot {
    const allThreads = this.all<Snapshot["threads"][number]>("thread");
    const archivedRows = this.db.prepare("SELECT id,body FROM entities WHERE kind=?").all("archivedThread") as { id: string; body: string }[];
    const archived = new Set(archivedRows.filter(row => JSON.parse(row.body)).map(row => row.id));
    const visibleRows=this.db.prepare("SELECT body FROM entities WHERE kind=? AND (thread_id IS NULL OR thread_id NOT IN (SELECT value FROM json_each(?))) ORDER BY rowid"),archivedIds=JSON.stringify([...archived]);
    const visible=<T>(kind:string):T[] => (visibleRows.all(kind,archivedIds) as {body:string}[]).map(row=>JSON.parse(row.body) as T);
    const threads = allThreads.filter(thread => !archived.has(thread.id));
    const artifacts = visible<Snapshot["artifacts"][number]>("artifact"), requests = visible<Snapshot["requests"][number]>("request");
    const data = visible<Snapshot["data"][number]>("data"), seen = new Set(data.map(d => d.id + "@" + d.revision));
    const refs = [...artifacts.flatMap(a => Object.values(a.bindings).flatMap(b => b.mode === "snapshot" ? [b.ref] : [])), ...requests.flatMap(r => r.basis)];
    for (const ref of refs) { const key = ref.id + "@" + ref.revision; if (!seen.has(key)) { const item = this.get<Snapshot["data"][number]>("dataVersion", key); if (item) { data.push(item); seen.add(key); } } }
    const skillUsage=new Map((this.db.prepare('SELECT id,body FROM entities WHERE kind=?').all('skillUsage') as {id:string;body:string}[]).map(row=>[row.id,JSON.parse(row.body) as {count:number;lastUsedAt:string}]));
    // Cap the message list per thread: the client renders the tail and pages
    // older messages through /api/threads/:id/messages on demand.
    const allMessages = visible<Snapshot["messages"][number]>("message");
    const grouped = new Map<string, Snapshot["messages"]>();
    for (const message of allMessages) { const list = grouped.get(message.threadId); if (list) list.push(message); else grouped.set(message.threadId, [message]); }
    const keep = new Set<string>(), messagesTruncated: Record<string, number> = {};
    for (const [threadId, list] of grouped) {
      const cut = Math.max(0, list.length - MESSAGE_WINDOW);
      if (cut) messagesTruncated[threadId] = cut;
      for (const message of list.slice(cut)) keep.add(message.id);
    }
    const messages = allMessages.filter(message => keep.has(message.id));
    return {
      seq: this.sequence, threads, archivedThreads: allThreads.filter(thread => archived.has(thread.id)), messages, messagesTruncated, artifacts, userStates: visible("userState"),
      data, requests, accounts: this.all('account'), skills:this.all<import('../contracts/skills.ts').SkillSummary>('skill').map(skill=>{const usage=skillUsage.get(skill.name);return usage?{...skill,useCount:usage.count,lastUsedAt:usage.lastUsedAt}:skill;}),skillProposals:(this.db.prepare("SELECT json_remove(body,'$.operations') AS body FROM entities WHERE kind=? AND json_extract(body,'$.status')='pending'").all('skillProposal') as {body:string}[]).map(row=>JSON.parse(row.body)),learning:this.get('learningStatus','global')??{supported:false,status:'idle',lastReview:null},operations: visible("operation"), resources: visible("resource"), memory: visible('taskMemory'),
      usage: Object.fromEntries(visible<{ id: string; value: unknown }>("usage").map(x => [x.id, x.value])) as Snapshot["usage"],
      settings: this.get("settings", "global") ?? { theme: "dark", modelId: null },
      activeThreadId: threads.find(t => !t.sideParentId && t.runId !== null && (t.status === "working" || t.status === "awaiting_input"))?.id ?? null
    };
  }
  messagesFor(threadId: string, beforeId?: string, limit = 200): { messages: Message[]; truncated: number } {
    const cap = Math.min(500, Math.max(1, Math.ceil(limit)));
    let rows: { body: string }[], count: { count: number };
    if (beforeId === undefined) {
      rows = this.statements.messageTail.all(threadId, cap) as { body: string }[];
      count = this.statements.messageCount.get(threadId) as { count: number };
    } else {
      const cursor = this.statements.messageCursor.get(beforeId, threadId) as { rowid: number } | undefined;
      if (!cursor) throw new HarnessError('INVALID_INPUT', 'Unknown message cursor');
      rows = this.statements.messageBefore.all(threadId, cursor.rowid, cap) as { body: string }[];
      count = this.statements.messageCountBefore.get(threadId, cursor.rowid) as { count: number };
    }
    return { messages: rows.reverse().map(row => JSON.parse(row.body) as Message), truncated: count.count - rows.length };
  }
  subscribe(listener: (event: WorkspaceEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close(): void { this.listeners.clear(); this.committedEvents.length = 0; this.db.close(); }
}
