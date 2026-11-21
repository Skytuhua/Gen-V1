import {z} from 'zod';
import {slugFilename} from '../../../packages/core/thread-markdown';
import type {DesktopThreadExportResult} from '../../../packages/desktop-contract/index';
import {ApiError, authenticated, read} from './api';

const MAX_BYTES = 32 * 1024 * 1024;
const FILENAME = /^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$/;
const nativeExportResult = z.strictObject({status: z.enum(['saved', 'cancelled']), admitted: z.literal(true), filename: z.string().max(240), bytes: z.number().int().nonnegative().max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/)});
const revoked = () => new ApiError('CAPABILITY_DENIED', 'The thread changed before the export finished. Export it again from the current thread.');
const invalid = () => new ApiError('INVALID_RESPONSE', 'The thread export could not be verified. Nothing was saved.');

async function readMarkdown(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new ApiError('EXPORT_TOO_LARGE', 'The thread export exceeds its byte bound.');
    return text;
  }
  const reader = body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {await reader.cancel(); throw new ApiError('EXPORT_TOO_LARGE', 'The thread export exceeds its byte bound.');}
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}

/** Saves the host-rendered export: the desktop native dialog when available,
 * otherwise a browser download. `isCurrent` guards ownership across awaits. */
export async function downloadThreadMarkdown(thread: {id: string; title: string}, isCurrent: () => boolean): Promise<DesktopThreadExportResult | {status: 'started'; admitted: false}> {
  const current = () => {if (!isCurrent()) throw revoked();};
  const response = await authenticated(() => {
    current();
    return fetch(`/api/threads/${encodeURIComponent(thread.id)}/export.md`, {credentials: 'same-origin', cache: 'no-store', redirect: 'error'});
  });
  if (!response.ok) await read(response);
  const header = response.headers.get('X-Gen-Export-Filename');
  const filename = header && FILENAME.test(header) ? header : slugFilename(thread.title, new Date().toISOString().slice(0, 10));
  const content = await readMarkdown(response);
  current();
  const bytes = new TextEncoder().encode(content);
  const desktop = window.harnessDesktop;
  if (desktop) {
    if (!desktop.exportThreadMarkdown || !globalThis.crypto?.subtle) throw new ApiError('EXPORT_UNAVAILABLE', 'This desktop version cannot export threads.');
    const hash = await crypto.subtle.digest('SHA-256', bytes), sha256 = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    current();
    const parsed = nativeExportResult.safeParse(await desktop.exportThreadMarkdown({threadId: thread.id, filename, content}));
    if (!parsed.success) throw invalid();
    const receipt = parsed.data;
    current();
    if (receipt.filename !== filename || receipt.bytes !== bytes.length || receipt.sha256 !== sha256) throw invalid();
    return receipt;
  }
  const url = URL.createObjectURL(new Blob([content], {type: 'text/markdown'}));
  try {
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    current(); link.click();
  } finally {setTimeout(() => URL.revokeObjectURL(url), 0);}
  return {status: 'started', admitted: false};
}
