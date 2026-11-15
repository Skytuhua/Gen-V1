import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { HarnessError } from "../contracts/index.ts";
import {
  CODE_INTELLIGENCE_LIMITS,
  diagnosticObservationV1Schema,
  renamePlanV1Schema,
  renameRecoveryResultSchema,
  type CodeDiagnostic,
  type CodePosition,
  type CodeRange,
  type DiagnosticObservationV1,
  type RangeEncoding,
  type RenamePlanV1,
  type RenameRecoveryEntry,
  type RenameRecoveryResult,
  type TextEdit,
} from "../contracts/code-intelligence.ts";
import { readBoundFile, withPathGuard } from "./file-access.ts";
import { inside, canonical } from "./security.ts";
import { hostFlagEnabled, type RegisteredHostFlag } from "./host-flags.ts";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// ---------------------------------------------------------------------------
// Explicit host-adapter protocol. Nothing here assumes a method on the Hermes
// engine: the host owns one adapter boundary and every language server (real
// stdio LSP or a test double) sits behind it.
// ---------------------------------------------------------------------------

export interface LspDocument {
  /** Absolute canonical path inside the granted workspace root. */
  path: string;
  /** file:// URI the server sees. */
  uri: string;
  languageId: string;
  /** Monotonically increasing document version owned by the host. */
  version: number;
  /** sha256 of the exact bytes sent to the server. */
  digest: string;
  text: string;
}

export interface LspDiagnostic {
  range: CodeRange;
  severity?: number;
  code?: string | number;
  message: string;
  source?: string;
}

export interface LspLocation {
  uri: string;
  range: CodeRange;
}

export interface LspTextEdit extends TextEdit {}

/** WorkspaceEdit restricted to text edits. Resource operations
 * (create/rename/delete file, notebook edits) are rejected upstream. */
export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: unknown[];
}

export type NavigationKind = "definition" | "references" | "implementation" | "hover";

export interface LanguageServerAdapter {
  /** Server name+version digest reported in every observation. */
  readonly serverIdentity: string;
  /** Negotiated position encoding for every range it returns. */
  readonly encoding: RangeEncoding;
  openDocument(document: LspDocument, signal: AbortSignal): Promise<void>;
  changeDocument(document: LspDocument, signal: AbortSignal): Promise<void>;
  closeDocument(path: string, signal: AbortSignal): Promise<void>;
  pullDiagnostics(document: LspDocument, signal: AbortSignal): Promise<LspDiagnostic[]>;
  navigate(kind: NavigationKind, document: LspDocument, position: CodePosition, signal: AbortSignal): Promise<unknown>;
  rename(document: LspDocument, position: CodePosition, newName: string, signal: AbortSignal): Promise<LspWorkspaceEdit>;
  dispose(): Promise<void>;
}

/** Executable/config descriptor the pool digests into the server key. The
 * host supplies it from an operator-approved registry; nothing is downloaded. */
export interface LanguageServerDescriptor {
  language: string;
  executable: string;
  argv: string[];
  /** sha256 of executable bytes + configuration text. */
  configDigest: string;
}

export interface LanguageServerFactory {
  (descriptor: LanguageServerDescriptor, root: string): LanguageServerAdapter;
}

// ---------------------------------------------------------------------------
// Position encoding: convert between a server's negotiated encoding and the
// host's canonical UTF-16 code-unit model. Byte offsets never equal UTF-16.
// ---------------------------------------------------------------------------

/** Length of `line` measured in `encoding` units. */
export function encodedLength(line: string, encoding: RangeEncoding): number {
  if (encoding === "UTF16") return line.length;
  let units = 0;
  for (const point of line) units += encoding === "UTF8" ? Buffer.byteLength(point, "utf8") : 1;
  return units;
}

/** Convert an `encoding`-unit character offset on `line` to UTF-16 units. */
export function toUtf16Offset(line: string, character: number, encoding: RangeEncoding): number {
  if (encoding === "UTF16") return Math.min(character, line.length);
  let units = 0;
  for (const point of line) {
    const size = encoding === "UTF8" ? Buffer.byteLength(point, "utf8") : 1;
    if (units + size > character) break;
    units += size;
  }
  // The returned value is a code-point count here; UTF-16 units follow.
  let utf16 = 0, seen = 0;
  for (const point of line) {
    if (seen >= units) break;
    utf16 += point.length;
    seen += encoding === "UTF8" ? Buffer.byteLength(point, "utf8") : 1;
  }
  return utf16;
}

/** Convert a UTF-16 code-unit offset on `line` to `encoding` units. */
export function fromUtf16Offset(line: string, utf16: number, encoding: RangeEncoding): number {
  if (encoding === "UTF16") return Math.min(utf16, line.length);
  let units = 0, consumed = 0;
  for (const point of line) {
    if (consumed + point.length > utf16) break;
    consumed += point.length;
    units += encoding === "UTF8" ? Buffer.byteLength(point, "utf8") : 1;
  }
  return units;
}

/** Segments keep their line terminator so untouched regions preserve CRLF/LF. */
function splitLines(text: string): string[] {
  const segments = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  return segments[segments.length - 1] === "" ? segments.slice(0, -1) : segments;
}
const stripEol = (segment: string) => segment.replace(/\r\n|\r|\n$/, "");

/** Apply a text edit (positions in `encoding` units) to `content`. */
export function applyTextEdit(content: string, range: CodeRange, newText: string, encoding: RangeEncoding): string {
  const lines = splitLines(content);
  if (range.start.line >= lines.length || range.end.line >= lines.length)
    throw new HarnessError("INVALID_INPUT", "The edit range exceeds the document.");
  const startLine = lines[range.start.line]!, endLine = lines[range.end.line]!;
  const start = toUtf16Offset(stripEol(startLine), range.start.character, encoding);
  const end = toUtf16Offset(stripEol(endLine), range.end.character, encoding);
  const before = lines.slice(0, range.start.line).join("") + startLine.slice(0, start);
  const after = endLine.slice(end) + lines.slice(range.end.line + 1).join("");
  return before + newText + after;
}

/** Apply ordered edits back-to-front so earlier ranges stay valid. */
export function applyTextEdits(content: string, edits: readonly TextEdit[], encoding: RangeEncoding): string {
  const ordered = [...edits].sort((a, b) =>
    b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character);
  let out = content;
  for (const edit of ordered) out = applyTextEdit(out, edit.range, edit.newText, encoding);
  return out;
}

// ---------------------------------------------------------------------------
// Stdio LSP adapter: real JSON-RPC over a spawned server process.
// ---------------------------------------------------------------------------

const LSP_TIMEOUT_MS = 5000;

/** One real language server over stdio, speaking JSON-RPC 2.0 with
 * Content-Length framing. The protocol is explicit: initialize/initialized,
 * didOpen/didChange (full sync) + textDocument/diagnostic pull, the bounded
 * navigation methods, rename, then shutdown+exit. */
export class StdioLspAdapter implements LanguageServerAdapter {
  readonly serverIdentity: string;
  encoding: RangeEncoding = "UTF16";
  private readonly child: ChildProcess;
  private seq = 0;
  private readonly pending = new Map<number, { accept: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = Buffer.alloc(0);
  private ready: Promise<void>;
  private documents = new Map<string, { version: number }>();
  private exited = false;

  constructor(descriptor: LanguageServerDescriptor, private readonly root: string) {
    this.child = spawn(descriptor.executable, descriptor.argv, { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.serverIdentity = sha([descriptor.executable, ...descriptor.argv].join("\0")).slice(0, 16);
    this.child.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.once("error", () => this.failAll(new HarnessError("UNAVAILABLE", "The language server could not start.")));
    this.child.once("exit", () => { this.exited = true; this.failAll(new HarnessError("UNAVAILABLE", "The language server exited.")); });
    this.ready = this.initialize();
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const header = this.buffer.indexOf("\r\n\r\n");
      if (header < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, header).toString("utf8"));
      if (!match) { this.buffer = this.buffer.subarray(header + 4); continue; }
      const length = Number(match[1]);
      if (this.buffer.length < header + 4 + length) return;
      const body = this.buffer.subarray(header + 4, header + 4 + length);
      this.buffer = this.buffer.subarray(header + 4 + length);
      let message: Record<string, unknown>;
      try { message = JSON.parse(body.toString("utf8")); } catch { continue; }
      const id = message.id;
      if (typeof id === "number") {
        const pending = this.pending.get(id);
        if (pending) {
          this.pending.delete(id); clearTimeout(pending.timer);
          if (message.error) pending.reject(new HarnessError("UNAVAILABLE", "The language server request failed.", message.error));
          else pending.accept(message.result);
        }
      }
    }
  }

  private send(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (this.exited) return Promise.reject(new HarnessError("UNAVAILABLE", "The language server exited."));
    const id = ++this.seq;
    const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }), "utf8");
    this.child.stdin!.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin!.write(payload);
    return new Promise((accept, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new HarnessError("UNAVAILABLE", "The language server timed out.")); }, LSP_TIMEOUT_MS);
      this.pending.set(id, { accept, reject, timer });
      const onAbort = () => { this.pending.delete(id); clearTimeout(timer); reject(new HarnessError("CANCELLED", "The request was cancelled.")); };
      if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private notify(method: string, params: unknown) {
    if (this.exited) return;
    const payload = Buffer.from(JSON.stringify({ jsonrpc: "2.0", method, params }), "utf8");
    try {
      this.child.stdin!.write(`Content-Length: ${payload.length}\r\n\r\n`);
      this.child.stdin!.write(payload);
    } catch { /* stdin closed mid-teardown */ }
  }

  private async initialize(): Promise<void> {
    const result = await this.send("initialize", {
      processId: null,
      rootUri: pathToFileURL(this.root).href,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: true, didClose: true },
          diagnostic: { dynamicRegistration: false },
          definition: {}, references: {}, implementation: {}, hover: {}, rename: {},
        },
        general: { positionEncodings: ["utf-8", "utf-16", "utf-32"] },
      },
      workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: this.root.split(sep).at(-1) ?? "workspace" }],
    }, new AbortController().signal).catch(error => { throw error; });
    this.notify("initialized", {});
    const negotiated = (result as { capabilities?: { positionEncoding?: string } } | null)?.capabilities?.positionEncoding;
    this.encoding = negotiated === "utf-8" ? "UTF8" : negotiated === "utf-32" ? "UTF32" : "UTF16";
  }

  private async ready_(): Promise<void> { await this.ready; if (this.exited) throw new HarnessError("UNAVAILABLE", "The language server exited."); }

  async openDocument(document: LspDocument, _signal: AbortSignal): Promise<void> {
    await this.ready_();
    if (!this.documents.has(document.uri)) {
      this.documents.set(document.uri, { version: document.version });
      this.notify("textDocument/didOpen", { textDocument: { uri: document.uri, languageId: document.languageId, version: document.version, text: document.text } });
    } else await this.changeDocument(document, _signal);
  }

  async changeDocument(document: LspDocument, _signal: AbortSignal): Promise<void> {
    await this.ready_();
    this.documents.set(document.uri, { version: document.version });
    this.notify("textDocument/didChange", {
      textDocument: { uri: document.uri, version: document.version },
      contentChanges: [{ text: document.text }],
    });
  }

  async closeDocument(path: string, _signal: AbortSignal): Promise<void> {
    const uri = pathToFileURL(path).href;
    this.documents.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  async pullDiagnostics(document: LspDocument, signal: AbortSignal): Promise<LspDiagnostic[]> {
    await this.ready_();
    const result = await this.send("textDocument/diagnostic", { textDocument: { uri: document.uri } }, signal);
    const items = (result as { items?: LspDiagnostic[] } | null)?.items;
    return Array.isArray(items) ? items.slice(0, CODE_INTELLIGENCE_LIMITS.diagnostics) : [];
  }

  async navigate(kind: NavigationKind, document: LspDocument, position: CodePosition, signal: AbortSignal): Promise<unknown> {
    await this.ready_();
    const params = { textDocument: { uri: document.uri }, position };
    const method = kind === "hover" ? "textDocument/hover" : `textDocument/${kind}`;
    return this.send(method, params, signal);
  }

  async rename(document: LspDocument, position: CodePosition, newName: string, signal: AbortSignal): Promise<LspWorkspaceEdit> {
    await this.ready_();
    const result = await this.send("textDocument/rename", { textDocument: { uri: document.uri }, position, newName }, signal);
    return (result ?? {}) as LspWorkspaceEdit;
  }

  async dispose(): Promise<void> {
    try {
      if (!this.exited) {
        await this.send("shutdown", null, new AbortController().signal).catch(() => {});
        this.notify("exit", {});
      }
    } finally {
      if (!this.exited) this.child.kill();
    }
  }
}

// ---------------------------------------------------------------------------
// Pool: physical workspace + language + executable/config digest + profile.
// Entries invalidate on owner/root/config change and idle out after 5 minutes.
// ---------------------------------------------------------------------------

interface PoolEntry {
  key: string;
  adapter: LanguageServerAdapter;
  documents: Map<string, LspDocument>;
  lastUsed: number;
}

export class LanguageServerPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly pending = new Map<string, Promise<PoolEntry>>();
  private readonly reaper: ReturnType<typeof setInterval>;
  constructor(
    private readonly factory: LanguageServerFactory,
    private readonly now: () => number = () => Date.now(),
    private readonly idleMs: number = CODE_INTELLIGENCE_LIMITS.idleServerShutdownMs,
  ) {
    this.reaper = setInterval(() => { void this.reap(); }, Math.min(idleMs, 60_000));
    this.reaper.unref?.();
  }

  private poolKey(root: string, descriptor: LanguageServerDescriptor, profileDigest: string): string {
    return sha([root, descriptor.language, descriptor.configDigest, profileDigest].join("\0"));
  }

  async acquire(root: string, descriptor: LanguageServerDescriptor, profileDigest: string): Promise<PoolEntry> {
    const key = this.poolKey(root, descriptor, profileDigest);
    const existing = this.entries.get(key);
    if (existing) { existing.lastUsed = this.now(); return existing; }
    let pending = this.pending.get(key);
    if (!pending) {
      pending = (async () => {
        const adapter = this.factory(descriptor, root);
        const entry: PoolEntry = { key, adapter, documents: new Map(), lastUsed: this.now() };
        return entry;
      })();
      this.pending.set(key, pending);
      try { await pending; } finally { this.pending.delete(key); }
    }
    const entry = await pending;
    this.entries.set(key, entry);
    entry.lastUsed = this.now();
    return entry;
  }

  /** Owner/root/config change: invalidate a workspace's servers. */
  async invalidate(predicate: (key: string, entry: PoolEntry) => boolean): Promise<number> {
    let dropped = 0;
    for (const [key, entry] of [...this.entries]) {
      if (predicate(key, entry)) {
        this.entries.delete(key); dropped++;
        await entry.adapter.dispose().catch(() => {});
      }
    }
    return dropped;
  }

  private async reap(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    await this.invalidate((_key, entry) => entry.lastUsed <= cutoff);
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); await entry.adapter.dispose().catch(() => {}); }
  }

  async dispose(): Promise<void> {
    clearInterval(this.reaper);
    for (const [key] of [...this.entries]) await this.release(key);
  }

  get size(): number { return this.entries.size; }
  documentCount(key: string): number { return this.entries.get(key)?.documents.size ?? 0; }
}

// ---------------------------------------------------------------------------
// Diagnostics: bound to exact document versions/digests. A diagnostic
// observation is never task completion.
// ---------------------------------------------------------------------------

export interface ObserveInput {
  workspaceIdentity: string;
  root: string;
  language: string;
  descriptor: LanguageServerDescriptor;
  profileDigest: string;
  path: string;
  beforeDigest: string | null;
  afterDigest: string;
  text: string;
  editInvocationId: string | null;
  /** 'inline' allows a 250ms budget; 'delayed' permits up to 5 seconds. */
  wait: "inline" | "delayed";
  signal: AbortSignal;
}

const SEVERITIES: Record<number, CodeDiagnostic["severity"]> = { 1: "error", 2: "warning", 3: "information", 4: "hint" };

export class CodeIntelligence {
  readonly pool: LanguageServerPool;
  private readonly baselines = new Map<string, { digest: string; version: number; diagnostics: CodeDiagnostic[] }>();
  private readonly debounced = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve: () => void }>();
  constructor(factory: LanguageServerFactory, private readonly clock: () => number = () => Date.now()) {
    this.pool = new LanguageServerPool(factory, clock);
  }

  /** Debounce eligible writes for 100 ms per document. */
  private debounce(key: string, ms = CODE_INTELLIGENCE_LIMITS.debounceMs): Promise<void> {
    const pending = this.debounced.get(key);
    if (pending) { clearTimeout(pending.timer); pending.resolve(); this.debounced.delete(key); }
    return new Promise<void>(resolve => {
      const timer = setTimeout(() => { this.debounced.delete(key); resolve(); }, ms);
      this.debounced.set(key, { timer, resolve });
    });
  }

  private async syncDocument(entry: PoolEntry, input: ObserveInput): Promise<LspDocument> {
    const uri = pathToFileURL(input.path).href;
    const existing = entry.documents.get(uri);
    const version = (existing?.version ?? 0) + 1;
    const document: LspDocument = { path: input.path, uri, languageId: input.language, version, digest: input.afterDigest, text: input.text };
    if (existing) await entry.adapter.changeDocument(document, input.signal);
    else await entry.adapter.openDocument(document, input.signal);
    entry.documents.set(uri, document);
    return document;
  }

  /** Inline diagnostics get a 250 ms budget; delayed observation gets 5 s. A
   * timeout returns UNAVAILABLE without undoing a successful edit. */
  async observe(input: ObserveInput): Promise<DiagnosticObservationV1> {
    const budget = input.wait === "inline" ? CODE_INTELLIGENCE_LIMITS.inlineDiagnosticMs : CODE_INTELLIGENCE_LIMITS.delayedDiagnosticMs;
    const started = this.clock();
    try {
      await this.debounce(input.path);
      const remaining = budget - (this.clock() - started);
      if (remaining <= 0) return this.unavailable(input);
      const entry = await this.pool.acquire(input.root, input.descriptor, input.profileDigest);
      const document = await this.withDeadline(this.syncDocument(entry, input), remaining, input.signal);
      const raw = await this.withDeadline(entry.adapter.pullDiagnostics(document, input.signal), budget - (this.clock() - started), input.signal);
      const diagnostics = raw.slice(0, CODE_INTELLIGENCE_LIMITS.diagnostics).map(item => this.normalize(item, input.path));
      const baseline = this.baselines.get(input.path);
      const baselineStatus = baseline && input.beforeDigest !== null && baseline.digest === input.beforeDigest ? "AVAILABLE" : "UNAVAILABLE";
      this.baselines.set(input.path, { digest: input.afterDigest, version: document.version, diagnostics });
      return diagnosticObservationV1Schema.parse({
        version: 1, workspaceIdentity: input.workspaceIdentity, language: input.language,
        serverIdentity: entry.adapter.serverIdentity, editInvocationId: input.editInvocationId,
        documentVersion: document.version, beforeDigest: input.beforeDigest, afterDigest: input.afterDigest,
        rangeEncoding: entry.adapter.encoding, baselineStatus, diagnostics,
        state: "CURRENT", observedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof HarnessError && error.code === "UNAVAILABLE") return this.unavailable(input);
      throw error;
    }
  }

  private normalize(item: LspDiagnostic, path: string): CodeDiagnostic {
    return {
      path,
      range: item.range,
      severity: SEVERITIES[item.severity ?? 1] ?? "error",
      ...(item.code !== undefined ? { code: String(item.code).slice(0, 256) } : {}),
      message: String(item.message ?? "").slice(0, 16384),
      ...(item.source ? { source: String(item.source).slice(0, 256) } : {}),
    };
  }

  private unavailable(input: ObserveInput): DiagnosticObservationV1 {
    return diagnosticObservationV1Schema.parse({
      version: 1, workspaceIdentity: input.workspaceIdentity, language: input.language,
      serverIdentity: "unavailable", editInvocationId: input.editInvocationId,
      documentVersion: 0, beforeDigest: input.beforeDigest, afterDigest: input.afterDigest,
      rangeEncoding: "UTF16", baselineStatus: "UNAVAILABLE", diagnostics: [],
      state: "UNAVAILABLE", observedAt: new Date().toISOString(),
    });
  }

  /** Mark an observation stale when the document moved on after it. */
  async markStale(input: ObserveInput, observation: DiagnosticObservationV1): Promise<DiagnosticObservationV1> {
    const current = this.baselines.get(input.path);
    if (current && current.digest !== observation.afterDigest)
      return { ...observation, state: "STALE" };
    return observation;
  }

  /** Introduced or worsened diagnostics: only when the before/after comparison
   * is valid. An unavailable earlier baseline yields the whole result as
   * baseline-unavailable — never calls every existing error new. */
  diffDiagnostics(before: DiagnosticObservationV1 | null, after: DiagnosticObservationV1): { introduced: CodeDiagnostic[]; existing: CodeDiagnostic[]; baselineStatus: "AVAILABLE" | "UNAVAILABLE" } {
    if (!before || after.baselineStatus === "UNAVAILABLE" || before.state !== "CURRENT" || before.afterDigest !== after.beforeDigest)
      return { introduced: [], existing: [...after.diagnostics], baselineStatus: "UNAVAILABLE" };
    const seen = new Set(before.diagnostics.map(d => JSON.stringify([d.path, d.range, d.severity, d.message])));
    const introduced = after.diagnostics.filter(d => !seen.has(JSON.stringify([d.path, d.range, d.severity, d.message])));
    const existing = after.diagnostics.filter(d => seen.has(JSON.stringify([d.path, d.range, d.severity, d.message])));
    return { introduced, existing, baselineStatus: "AVAILABLE" };
  }

  private async withDeadline<T>(work: Promise<T>, budgetMs: number, _signal: AbortSignal): Promise<T> {
    if (budgetMs <= 0) throw new HarnessError("UNAVAILABLE", "The diagnostic observation exceeded its budget.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_a, reject) => { timer = setTimeout(() => reject(new HarnessError("UNAVAILABLE", "The diagnostic observation exceeded its budget.")), budgetMs); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  // -------------------------------------------------------------------------
  // Bounded navigation: read-only; URIs restricted to granted roots; at most
  // 100 returned locations with an explicit truncation marker.
  // -------------------------------------------------------------------------

  async navigate(input: {
    root: string; path: string; language: string; descriptor: LanguageServerDescriptor; profileDigest: string;
    kind: NavigationKind; position: CodePosition; grantedRoots: readonly string[]; signal: AbortSignal;
    text: string; afterDigest: string;
  }): Promise<{ locations: { path: string; range: CodeRange }[]; truncated: boolean; hover?: string }> {
    const entry = await this.pool.acquire(input.root, input.descriptor, input.profileDigest);
    const document = await this.syncDocument(entry, {
      workspaceIdentity: "", root: input.root, language: input.language, descriptor: input.descriptor,
      profileDigest: input.profileDigest, path: input.path, beforeDigest: null, afterDigest: input.afterDigest,
      text: input.text, editInvocationId: null, wait: "inline", signal: input.signal,
    });
    const position: CodePosition = {
      line: input.position.line,
      character: fromUtf16Offset(splitLines(input.text)[input.position.line] ?? "", input.position.character, entry.adapter.encoding),
    };
    const raw = await entry.adapter.navigate(input.kind, document, position, input.signal);
    if (input.kind === "hover") {
      const contents = (raw as { contents?: unknown } | null)?.contents;
      const text = typeof contents === "string" ? contents
        : contents && typeof contents === "object" && "value" in (contents as Record<string, unknown>) ? String((contents as { value: unknown }).value)
        : "";
      return { locations: [], truncated: false, hover: text.slice(0, 16384) };
    }
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const locations: { path: string; range: CodeRange }[] = [];
    let truncated = false;
    for (const item of items) {
      const uri = (item as LspLocation).uri, range = (item as LspLocation).range;
      if (!uri || !range) continue;
      let path: string;
      try { path = await canonical(fileURLToPath(uri)); }
      catch { continue; }
      // File URIs outside every current granted root are refused.
      if (!input.grantedRoots.some(root => inside(root, path))) continue;
      if (locations.length >= CODE_INTELLIGENCE_LIMITS.navigationResults) { truncated = true; break; }
      locations.push({ path, range });
    }
    if (items.length > CODE_INTELLIGENCE_LIMITS.navigationResults) truncated = true;
    return { locations, truncated };
  }

  // -------------------------------------------------------------------------
  // Rename: preview, exact approval, then guarded apply under the workspace
  // mutation lock. A multi-file filesystem operation is not a database
  // transaction — recovery reconciles each path.
  // -------------------------------------------------------------------------

  private readonly mutationLocks = new Map<string, Promise<unknown>>();
  private underLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const tail = this.mutationLocks.get(key) ?? Promise.resolve();
    const next = tail.then(action, action);
    const stored = next.then(
      () => { if (this.mutationLocks.get(key) === stored) this.mutationLocks.delete(key); },
      () => { if (this.mutationLocks.get(key) === stored) this.mutationLocks.delete(key); },
    );
    this.mutationLocks.set(key, stored);
    return next;
  }

  /** Build a rename plan from a server WorkspaceEdit. Only text edits to
   * existing files inside the granted root survive; create/delete/move/
   * resource operations and ungranted roots reject the whole plan. */
  async planRename(input: {
    root: string; descriptor: LanguageServerDescriptor; profileDigest: string;
    path: string; language: string; position: CodePosition; newName: string;
    grantedRoots: readonly string[]; workspaceIdentity: string; approvalId: string;
    signal: AbortSignal; text: string; afterDigest: string;
  }): Promise<RenamePlanV1> {
    const entry = await this.pool.acquire(input.root, input.descriptor, input.profileDigest);
    const document = await this.syncDocument(entry, {
      workspaceIdentity: input.workspaceIdentity, root: input.root, language: input.language,
      descriptor: input.descriptor, profileDigest: input.profileDigest, path: input.path,
      beforeDigest: null, afterDigest: input.afterDigest, text: input.text,
      editInvocationId: null, wait: "inline", signal: input.signal,
    });
    // Positions inside the rename exchange use the negotiated adapter encoding;
    // plan ranges are canonicalized to UTF16 for storage and apply.
    const encoding = entry.adapter.encoding;
    const lineAt = (text: string, line: number) => stripEol(splitLines(text)[line] ?? "");
    const serverPosition = { line: input.position.line, character: fromUtf16Offset(lineAt(input.text, input.position.line), input.position.character, encoding) };
    const edit = await entry.adapter.rename(document, serverPosition, input.newName, input.signal);
    // Resource operations (create/delete/move/rename-file) are not supported.
    if (Array.isArray(edit.documentChanges) && edit.documentChanges.some(change => {
      const kinds = (change as { kind?: string }).kind;
      return kinds === "create" || kinds === "rename" || kinds === "delete";
    })) throw new HarnessError("CAPABILITY_DENIED", "The rename requires file resource operations, which this plan does not support.");
    const edits: { path: string; edits: TextEdit[] }[] = [];
    const collect = (uri: string, list: LspTextEdit[]) => {
      let path: string;
      try { path = resolve(fileURLToPath(uri)); } catch { throw new HarnessError("CAPABILITY_DENIED", "The rename targets an unreadable file URI."); }
      if (!input.grantedRoots.some(root => inside(root, path)))
        throw new HarnessError("CAPABILITY_DENIED", "The rename targets a file outside the granted roots.");
      edits.push({ path, edits: list });
    };
    if (edit.changes) for (const [uri, list] of Object.entries(edit.changes)) collect(uri, list);
    if (Array.isArray(edit.documentChanges)) {
      for (const change of edit.documentChanges) {
        const doc = (change as { textDocument?: { uri?: string }; edits?: LspTextEdit[] });
        if (!doc.textDocument?.uri || !Array.isArray(doc.edits))
          throw new HarnessError("CAPABILITY_DENIED", "The rename returned an unsupported change shape.");
        collect(doc.textDocument.uri, doc.edits);
      }
    }
    if (edits.length > CODE_INTELLIGENCE_LIMITS.renameFiles) throw new HarnessError("RESOURCE_LIMIT", "The rename exceeds the file bound.");
    const expectedBeforeDigests: { path: string; digest: string }[] = [];
    const sourceVersions: RenamePlanV1["sourceVersions"] = [];
    for (const target of edits) {
      const bytes = await readBoundFile(target.path, 32 * 1024 * 1024).catch(() => { throw new HarnessError("CAPABILITY_DENIED", "The rename targets a missing or unreadable file."); });
      const text = bytes.toString("utf8");
      if (target.path === resolve(input.path) && sha(bytes) !== input.afterDigest)
        throw new HarnessError("PRECONDITION_FAILED", "The document on disk differs from the synced text; sync the document before renaming.");
      // Convert server ranges (adapter encoding) into canonical UTF16 ranges.
      const convert = (position: CodePosition): CodePosition => ({
        line: position.line, character: toUtf16Offset(lineAt(text, position.line), position.character, encoding),
      });
      target.edits = target.edits.map(item => ({ range: { start: convert(item.range.start), end: convert(item.range.end) }, newText: item.newText }));
      expectedBeforeDigests.push({ path: target.path, digest: sha(bytes) });
      const doc = entry.documents.get(pathToFileURL(target.path).href);
      sourceVersions.push({ path: target.path, documentVersion: doc?.version ?? 0, digest: sha(bytes) });
    }
    return renamePlanV1Schema.parse({
      version: 1, planId: randomUUID(), workspaceIdentity: input.workspaceIdentity,
      serverVersion: entry.adapter.serverIdentity, sourceVersions, textEdits: edits,
      expectedBeforeDigests, exactApprovalId: input.approvalId,
    });
  }

  /** Guarded apply: validate every target/preimage while holding the workspace
   * mutation lock; write the durable recovery journal and backups before the
   * first change. */
  async applyRename(input: {
    plan: RenamePlanV1; approvalId: string; journalRoot: string;
    grantedRoots: readonly string[]; signal: AbortSignal;
  }): Promise<RenameRecoveryResult> {
    const plan = renamePlanV1Schema.parse(input.plan);
    if (plan.exactApprovalId !== input.approvalId)
      throw new HarnessError("CAPABILITY_DENIED", "The rename approval does not match this plan.");
    return this.underLock(plan.workspaceIdentity, async () => {
      // Grants are re-validated at apply: a revoked root between plan and
      // apply must produce no write.
      for (const target of plan.textEdits)
        if (!input.grantedRoots.some(root => inside(root, target.path)))
          throw new HarnessError("CAPABILITY_DENIED", "A rename target is outside the granted roots.");
      // Validate every target's preimage before the first change.
      const preimages = new Map<string, Buffer>();
      for (const expected of plan.expectedBeforeDigests) {
        const bytes = await readBoundFile(expected.path, 32 * 1024 * 1024).catch(() => { throw new HarnessError("PRECONDITION_FAILED", "A rename target is missing."); });
        if (sha(bytes) !== expected.digest)
          throw new HarnessError("PRECONDITION_FAILED", "A rename target changed before apply.");
        preimages.set(expected.path, bytes);
      }
      // Durable journal + backups BEFORE the first change.
      const journalDir = join(input.journalRoot, "code-intelligence", "rename", plan.planId);
      await mkdir(journalDir, { recursive: true });
      const journal: { planId: string; entries: { path: string; preimage: string; postimage: string | null; backup: string; disposition: RenameRecoveryEntry["disposition"] }[]; resolved: boolean } = {
        planId: plan.planId, entries: [], resolved: false,
      };
      const flush = () => writeFile(join(journalDir, "journal.json"), JSON.stringify(journal));
      for (const target of plan.textEdits) {
        const preimage = preimages.get(target.path)!;
        const backup = join(journalDir, "backup-" + sha(target.path).slice(0, 16));
        await writeFile(backup, preimage);
        journal.entries.push({ path: target.path, preimage: sha(preimage), postimage: null, backup, disposition: "Unchanged" });
      }
      await flush();
      const entries: RenameRecoveryEntry[] = [];
      try {
        for (const [index, target] of plan.textEdits.entries()) {
          const record = journal.entries[index]!;
          const current = await readBoundFile(target.path, 32 * 1024 * 1024).catch(() => null);
          if (!current || sha(current) !== record.preimage) {
            record.disposition = "Conflict";
            entries.push({ path: target.path, disposition: "Conflict", detail: "The file changed before its rename edits were applied." });
            await flush();
            continue;
          }
          const postimage = applyTextEdits(current.toString("utf8"), target.edits, "UTF16");
          // The postimage is durable BEFORE the write: a crash after writeFile
          // still leaves a complete recovery record for this path.
          record.postimage = sha(Buffer.from(postimage, "utf8"));
          await flush();
          const target_ = join(target.path);
          await withPathGuard([{ path: dirname(target_), leaf: false }], input.signal, async () => {
            await writeFile(target_, postimage);
          });
          record.disposition = "Applied";
          entries.push({ path: target.path, disposition: "Applied" });
          await flush();
        }
      } catch (error) {
        journal.resolved = false; await flush();
        return this.reconcile(plan, journal, "PARTIAL_RECOVERY_REQUIRED", entries);
      }
      journal.resolved = true; await flush();
      // A rename that left any target conflicted is not a success.
      const partial = journal.entries.some(record => record.disposition === "Conflict");
      return renameRecoveryResultSchema.parse({ planId: plan.planId, state: partial ? "PARTIAL_RECOVERY_REQUIRED" : "APPLIED", entries });
    });
  }

  /** Post-crash reconcile: each path independently. Restores a path only when
   * its current bytes match the bundle's written postimage; an external edit
   * stops recovery with PARTIAL_RECOVERY_REQUIRED — never a silent overwrite. */
  async recoverRename(input: { journalRoot: string; planId: string; grantedRoots: readonly string[]; signal: AbortSignal }): Promise<RenameRecoveryResult> {
    const journalDir = join(input.journalRoot, "code-intelligence", "rename", input.planId);
    const journal = JSON.parse(await readFile(join(journalDir, "journal.json"), "utf8")) as {
      planId: string; resolved: boolean;
      entries: { path: string; preimage: string; postimage: string | null; backup: string; disposition: RenameRecoveryEntry["disposition"] }[];
    };
    // Recovery never writes outside the current project's granted roots.
    for (const record of journal.entries)
      if (!input.grantedRoots.some(root => inside(root, record.path)))
        throw new HarnessError("CAPABILITY_DENIED", "The recovery journal targets a file outside the granted roots.");
    // A resolved journal recorded a completed apply; reconciliation reports it.
    if (journal.resolved)
      return renameRecoveryResultSchema.parse({
        planId: journal.planId,
        state: journal.entries.some(record => record.disposition === "Conflict") ? "PARTIAL_RECOVERY_REQUIRED" : "APPLIED",
        entries: journal.entries.map(record => ({ path: record.path, disposition: record.disposition })),
      });
    const entries: RenameRecoveryEntry[] = [];
    let conflict = false;
    for (const record of journal.entries) {
      const current = await readBoundFile(record.path, 32 * 1024 * 1024).catch(() => null);
      const currentDigest = current ? sha(current) : null;
      if (record.postimage !== null && currentDigest === record.postimage) {
        // Restore only when current bytes still match the written postimage.
        const backup = await readBoundFile(record.backup, 32 * 1024 * 1024).catch(() => null);
        if (!backup || sha(backup) !== record.preimage) {
          conflict = true;
          entries.push({ path: record.path, disposition: "Conflict", detail: "The backup is unavailable." });
          continue;
        }
        await withPathGuard([{ path: dirname(record.path), leaf: false }], input.signal, async () => {
          await writeFile(record.path, backup);
        });
        entries.push({ path: record.path, disposition: "Restored" });
      } else if (currentDigest === record.preimage) {
        entries.push({ path: record.path, disposition: "Unchanged" });
      } else if (currentDigest === null) {
        conflict = true;
        entries.push({ path: record.path, disposition: "Conflict", detail: "The file is missing." });
      } else {
        // An external editor changed it — stop, do not overwrite that edit.
        conflict = true;
        entries.push({ path: record.path, disposition: "Conflict", detail: "The file changed outside the rename; manual recovery is required." });
      }
    }
    return renameRecoveryResultSchema.parse({
      planId: journal.planId,
      state: conflict ? "PARTIAL_RECOVERY_REQUIRED" : entries.some(e => e.disposition === "Restored") ? "RECOVERED" : "APPLIED",
      entries,
    });
  }

  private reconcile(plan: RenamePlanV1, journal: { entries: { path: string; preimage: string; postimage: string | null; backup: string; disposition: RenameRecoveryEntry["disposition"] }[] }, state: "PARTIAL_RECOVERY_REQUIRED", entries: RenameRecoveryEntry[]): RenameRecoveryResult {
    return renameRecoveryResultSchema.parse({
      planId: plan.planId,
      state,
      entries: journal.entries.map((record, index) => entries[index] ?? { path: record.path, disposition: record.disposition === "Applied" ? "Applied" : "Unchanged" }),
    });
  }

  async dispose(): Promise<void> { await this.pool.dispose(); }
}

// ---------------------------------------------------------------------------
// Flag gates. Only the host-owned registry keys exist; default false.
// ---------------------------------------------------------------------------

export function requireCodeIntelligenceFlag(flag: Extract<RegisteredHostFlag, `coding.${string}`>, env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (!hostFlagEnabled(flag, env))
    throw new HarnessError("CAPABILITY_DENIED", `The ${flag} capability is disabled on this host.`);
}
