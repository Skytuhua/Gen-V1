import { z } from 'zod';
import { ApiError, authenticated, read } from './api';
import { dismissToast, toast } from '../../../packages/ui-shell/Toast';

const FILENAME = /^[a-z0-9-]{1,60}-\d{4}-\d{2}-\d{2}\.md$/;
const nativeResult = z.object({
  status: z.enum(['saved', 'cancelled']),
  filename: z.string().regex(FILENAME),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const messageOf = (cause: unknown) => cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : String(cause);
const displayTitle = (title: string) => title.length > 80 ? title.slice(0, 79) + '\u2026' : title;

/** Same slug rule as the host renderer; only used when the filename header is missing. */
const slugFilename = (title: string, date: string) => {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${slug || 'thread'}-${date}.md`;
};

export interface ThreadExportOutcome { status: 'saved' | 'cancelled'; filename: string }

export interface ExportableThread { id: string; title: string }

const sha256Hex = async (content: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Fetches the rendered Markdown document and saves it: native save dialog on
 * the desktop build (receipt filename/bytes/sha256 verified), a browser
 * download elsewhere. `isCurrent` guards every step so an owner that navigated
 * mid-export resolves as 'cancelled' instead of saving a stale document.
 */
export async function exportThreadMarkdown(thread: ExportableThread, isCurrent: () => boolean = () => true): Promise<ThreadExportOutcome> {
  const response = await authenticated(() => fetch(`/api/threads/${encodeURIComponent(thread.id)}/export.md`, { credentials: 'same-origin', cache: 'no-store' }));
  if (!response.ok) await read(response);
  if (!isCurrent()) return { status: 'cancelled', filename: '' };
  const content = await response.text();
  const header = response.headers.get('X-Gen-Export-Filename');
  const filename = header && FILENAME.test(header) ? header : slugFilename(thread.title, new Date().toISOString().slice(0, 10));
  const bytes = new TextEncoder().encode(content).byteLength;
  const desktop = window.harnessDesktop;
  if (desktop) {
    if (typeof desktop.exportThreadMarkdown !== 'function') {
      throw new ApiError('UNSUPPORTED_DESKTOP', 'This desktop version cannot export threads.');
    }
    const sha256 = await sha256Hex(content);
    const receipt = nativeResult.safeParse(await desktop.exportThreadMarkdown({ threadId: thread.id, filename, content })).data;
    if (!isCurrent()) return { status: 'cancelled', filename };
    if (!receipt || receipt.filename !== filename || receipt.bytes !== bytes || receipt.sha256 !== sha256) {
      throw new ApiError('EXPORT_RECEIPT_MISMATCH', 'The save result did not match the export.');
    }
    return { status: receipt.status, filename };
  }
  if (!isCurrent()) return { status: 'cancelled', filename };
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally { URL.revokeObjectURL(url); }
  return { status: 'saved', filename };
}

/** Shared menu feedback for both entry points: one pending toast past 800 ms,
 * then exactly one outcome toast (design spec d1). */
export async function runExportWithFeedback(thread: ExportableThread, isCurrent?: () => boolean) {
  const title = displayTitle(thread.title);
  let pendingId = 0;
  const timer = setTimeout(() => { pendingId = toast(`Exporting \u201C${title}\u201D\u2026`, { tone: 'info' }); }, 800);
  const finish = () => { clearTimeout(timer); if (pendingId) { dismissToast(pendingId); pendingId = 0; } };
  try {
    const result = await exportThreadMarkdown(thread, isCurrent);
    finish();
    if (result.status === 'cancelled') toast('Export cancelled', { tone: 'info' });
    else toast(`Exported \u201C${title}\u201D`, { tone: 'success', action: { label: 'Export again', onClick: () => void runExportWithFeedback(thread, isCurrent) } });
  } catch (cause) {
    finish();
    toast(`Export failed: ${messageOf(cause)}`, { tone: 'error', durationMs: 9000 });
  }
}
