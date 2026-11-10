export type OwnerDiscussionSSEFrame =
  | Readonly<{kind: 'comment'; comment: 'connected' | 'keepalive'; rawFrame: Uint8Array}>
  | Readonly<{kind: 'changes'; id: string; data: Uint8Array; rawFrame: Uint8Array}>
  | Readonly<{kind: 'control'; data: Uint8Array; rawFrame: Uint8Array}>;

const maximumFrameBytes = 65536;
const cursorAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The pinned SSE grammar only. Existing validators own canonical JSON and cursor authority. */
export class OwnerDiscussionSSEParser {
  #pending = new Uint8Array(maximumFrameBytes);
  #length = 0;
  #closed = false;
  #decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
  #encoder = new TextEncoder();

  get bufferedBytes(): number {return this.#length;}

  *push(chunk: Uint8Array): Generator<OwnerDiscussionSSEFrame> {
    if (this.#closed) throw new Error('Owner discussion SSE parser is closed');
    for (const byte of chunk) {
      if (this.#closed) throw new Error('Owner discussion SSE parser is closed');
      if (byte === 13 || this.#length === maximumFrameBytes) this.#fail();
      this.#pending[this.#length++] = byte;
      if (byte === 10 && this.#length >= 2 && this.#pending[this.#length - 2] === 10) {
        let frame: OwnerDiscussionSSEFrame;
        try {frame = this.#frame();} catch {this.#fail();}
        this.#length = 0;
        yield frame;
      }
    }
  }

  /** EOF does not complete a frame and cannot advance an id. A new connection needs a new parser. */
  finish(): void {this.#length = 0; this.#closed = true;}

  #fail(): never {
    this.finish();
    throw new Error('Invalid owner discussion SSE frame');
  }

  #frame(): OwnerDiscussionSSEFrame {
    const raw = this.#pending.subarray(0, this.#length), value = this.#decoder.decode(raw);
    if (value === ': connected\n\n' || value === ': keepalive\n\n') {
      return {kind: 'comment', comment: value === ': connected\n\n' ? 'connected' : 'keepalive', rawFrame: raw.slice()};
    }
    const lines = value.slice(0, -2).split('\n');
    if (lines.length === 2 && lines[0] === 'event: control' && lines[1].startsWith('data: ')) {
      return {kind: 'control', data: this.#encoder.encode(lines[1].slice(6)), rawFrame: raw.slice()};
    }
    if (lines.length !== 3 || !lines[0].startsWith('id: ') || lines[1] !== 'event: changes' || !lines[2].startsWith('data: ')) this.#fail();
    const id = lines[0].slice(4), remainder = id.length % 4, last = cursorAlphabet.indexOf(id.at(-1)!);
    // Check syntax and unused trailing bits; opaque cursor claims are never interpreted.
    if (id.length < 1 || id.length > 4096 || /[^A-Za-z0-9_-]/.test(id) || remainder === 1 ||
      (remainder === 2 && last % 16 !== 0) || (remainder === 3 && last % 4 !== 0)) this.#fail();
    return {kind: 'changes', id, data: this.#encoder.encode(lines[2].slice(6)), rawFrame: raw.slice()};
  }
}
