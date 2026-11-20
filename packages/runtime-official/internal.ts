import type { ChildProcess } from 'node:child_process';
import type { ModelInfo } from '../contracts/index.ts';
import type { ManifestState } from './manifest.ts';
import type { HostMcp } from './mcp.ts';
import type {ModelPurpose} from '../runtime/model-only.ts';

export interface WireInput { uuid: string; text: string; inputIds: string[] }
export interface DriverContext {
  dataDir: string; taskDir: string; manifest: ManifestState; mcp: HostMcp; memory?: string; thinkingLevel?:string|null;modelOnly?:boolean;purpose?:ModelPurpose;
  current(): boolean;
  event(type: string, value?: Record<string, unknown>): void;
  observed(uuid: string): Promise<string[]>;
  inputIds(uuids: string[]): string[];
  own(process: ChildProcess): void;
  ready(driver: OfficialDriver): void;
}
export interface OfficialDriver {
  models: ModelInfo[];
  geminiConfig?:{settingsPath:string;promptPath:string};
  submit(input: WireInput): Promise<void>;
  compact(): Promise<void>;
  close(): Promise<void>;
}
export interface HistoryReceipt { uuid: string; inputIds: string[] }
export function textContent(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) ? value.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('') : '';
}
export const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export async function bounded<T>(promise: Promise<T>, milliseconds: number, message: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    // Observe an already-started operation without letting its result win.
    void promise.catch(() => {});
    throw signal.reason;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }), new Promise<never>((_, reject) => {abort=()=>reject(signal!.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});})]);
  }
  finally { clearTimeout(timer); if(abort)signal?.removeEventListener('abort',abort); }
}
export function asyncQueue<T>() {
  const values: T[] = []; let wake: (() => void) | undefined; let closed = false;
  return {
    push(value: T) { if (closed) throw new Error('Official input stream is closed.'); values.push(value); wake?.(); },
    close() { closed = true; values.length = 0; wake?.(); },
    async *[Symbol.asyncIterator]() { while (!closed) { if (!values.length) await new Promise<void>(resolve => { wake = resolve; }); wake = undefined; while (!closed && values.length) yield values.shift()!; } },
  };
}
