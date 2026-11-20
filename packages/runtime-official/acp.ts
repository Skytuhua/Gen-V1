import type { ChildProcess } from 'node:child_process';
import { HarnessError } from '../contracts/index.ts';

interface AcpMessage {
  jsonrpc?: string; id?: number; method?: string;
  params?: unknown; result?: unknown;
  error?: { code?: number; message?: unknown };
}
function isAcpMessage(value: unknown): value is AcpMessage {
  return typeof value === 'object' && value !== null;
}

/** Pinned Gemini CLI 0.66 uses ACP v1 newline-delimited JSON-RPC, not LSP framing. */
export class AcpConnection {
  private next = 1;
  private buffer = '';
  private closed = false;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly process: ChildProcess, private readonly update: (method: string, params: unknown) => void,private readonly maxFrameBytes=4*1024*1024) {
    const failed = () => this.close(new HarnessError('OFFICIAL_PROCESS_IO_FAILED', 'The native Gemini connection closed unexpectedly. Reconnect the provider and refresh models.'));
    process.on('error', failed);
    for (const stream of [process.stdin, process.stdout, process.stderr]) stream?.on('error', failed);
    process.stdout?.setEncoding('utf8');
    process.stdout?.on('data', chunk => {
      if (this.closed) return;
      const input = this.buffer + chunk;
      this.buffer = '';
      const tooLarge = () => this.close(new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official ACP frame exceeded the bounded transport limit.'));
      let offset = 0, newline: number;
      while (!this.closed && (newline = input.indexOf('\n', offset)) !== -1) {
        const line = input.slice(offset, newline);
        offset = newline + 1;
        // Match the write-side byte limit, including the frame delimiter.
        if (Buffer.byteLength(line) + 1 > this.maxFrameBytes) { tooLarge(); return; }
        if (!line.trim()) continue;
        try { this.accept(JSON.parse(line)); }
        catch { this.close(new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official ACP emitted an invalid JSON-RPC frame.')); }
      }
      if (this.closed) return;
      const tail = input.slice(offset);
      if (Buffer.byteLength(tail) > this.maxFrameBytes) { tooLarge(); return; }
      this.buffer = tail;
    });
    process.once('exit', () => this.close(new HarnessError('OFFICIAL_PROCESS_EXITED', 'Official Gemini CLI exited. Persisted history will determine input delivery.')));
  }
  private send(value: unknown): void {
    if (this.closed || !this.process.stdin?.writable) throw new HarnessError('OFFICIAL_PROCESS_EXITED', 'Official ACP input is closed.');
    // A successful write is transport only. It is never a durable input receipt.
    const frame=JSON.stringify(value)+'\n';if(Buffer.byteLength(frame)>this.maxFrameBytes)throw new HarnessError('OFFICIAL_PROTOCOL_INVALID','Official ACP frame exceeded the bounded transport limit.');
    this.process.stdin.write(frame);
  }
  private accept(message: unknown): void {
    if (this.closed) return;
    if (!isAcpMessage(message) || message.jsonrpc !== '2.0') throw new Error('Invalid ACP message.');
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        if (message.method === 'session/request_permission') this.send({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } });
        else this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Only host MCP tools are available. Client filesystem and terminal requests are unsupported.' } });
      } else this.update(message.method, message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(message.id);
    if (message.error) pending.reject(new HarnessError('OFFICIAL_ACP_ERROR', typeof message.error.message === 'string' ? message.error.message : 'Official ACP request failed.'));
    else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new HarnessError('OFFICIAL_PROTOCOL_INVALID', 'Official ACP response has no result.'));
  }
  request<T = unknown>(method: string, params: unknown, timeout = 30_000): Promise<T> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new HarnessError('OFFICIAL_PROTOCOL_TIMEOUT', `Official ACP ${method} did not acknowledge within the bounded request timeout.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  notify(method: string, params: unknown): void { this.send({ jsonrpc: '2.0', method, params }); }
  close(error: Error = new HarnessError('OFFICIAL_RUN_ABORTED', 'Official ACP connection closed.')): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}
