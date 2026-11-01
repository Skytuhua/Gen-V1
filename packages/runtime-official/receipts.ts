import { messageInputIds } from '../runtime-pi/input-envelope.ts';
import type { HistoryReceipt } from './internal.ts';
import type { ManifestState } from './manifest.ts';

/** Recover only the leading host envelope, never a marker embedded in opaque user text. */
export function leadingReceipts(manifest: ManifestState, text: string): HistoryReceipt[] {
  const ids = messageInputIds({ role: 'user', content: text });
  if (!ids.length) return [];
  try {
    const marker = JSON.parse(text.slice('[harness-input:v1] '.length, text.indexOf('\n')));
    if (marker.threadId !== manifest.value.threadId) return [];
    return Object.entries(manifest.value.inputs).flatMap(([uuid, receipt]) => receipt.runId === marker.runId && receipt.epoch === marker.epoch && JSON.stringify(receipt.inputIds) === JSON.stringify(ids) ? [{ uuid, inputIds: [...ids] }] : []);
  } catch { return []; }
}
