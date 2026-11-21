/** Selection capture, guarded splice and bounded undo for prompt-snippet insertion.
 * Pure except where marked; the textarea element and an explicit owner signature
 * are the only authorities — no global queries, no implicit draft writes. */

export interface SnippetCapture {
  readonly signature: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly direction: 'forward' | 'backward' | 'none';
}
export interface SpliceResult { text: string; caret: number }
export interface InsertionReceipt {
  readonly signature: string;
  readonly restore: SnippetCapture;
  readonly result: string;
  readonly caret: number;
}
export type InsertionResult =
  | { ok: true; receipt: InsertionReceipt; mode: 'native' | 'fallback' }
  | { ok: false; error: string };

const integerRange = (text: string, start: number, end: number) =>
  Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= text.length;

/** Record the current selection inside the owned textarea. */
export function captureSelection(element: HTMLTextAreaElement, signature: string): SnippetCapture | null {
  if (!element.isConnected || element.disabled || element.readOnly) return null;
  const { value, selectionStart, selectionEnd, selectionDirection } = element;
  if (!integerRange(value, selectionStart, selectionEnd)) return null;
  return { signature, text: value, start: selectionStart, end: selectionEnd, direction: selectionDirection };
}

/** Re-verify a capture immediately before mutating the DOM — element, owner and text must be unchanged. */
export function captureStale(element: HTMLTextAreaElement, capture: SnippetCapture, signature: string): string | null {
  if (capture.signature !== signature) return 'The draft changed owner. Pick the insertion point again.';
  if (!element.isConnected || element.disabled || element.readOnly) return 'This composer is not editable right now.';
  if (element.value !== capture.text) return 'The draft changed since the snippet was chosen. Pick the insertion point again.';
  if (!integerRange(capture.text, capture.start, capture.end)) return 'The captured range is no longer valid.';
  return null;
}

/** Pure splice: replace [start,end) with body; caret follows the inserted body. */
export function spliceSnippet(text: string, start: number, end: number, body: string): SpliceResult | null {
  if (!integerRange(text, start, end)) return null;
  return { text: text.slice(0, start) + body + text.slice(end), caret: start + body.length };
}

/** Bounded undo receipt: restores the captured text/range only while the element
 * still holds exactly the inserted result — any later edit invalidates it. */
export function undoInsertion(element: HTMLTextAreaElement, receipt: InsertionReceipt, signature: string): { ok: boolean; error?: string } {
  if (receipt.signature !== signature) return { ok: false, error: 'Nothing to undo here.' };
  if (!element.isConnected || element.disabled || element.readOnly) return { ok: false, error: 'This composer is not editable right now.' };
  if (element.value !== receipt.result) return { ok: false, error: 'The draft changed after the insert; undo is no longer available.' };
  element.focus();
  element.value = receipt.restore.text;
  element.setSelectionRange(receipt.restore.start, receipt.restore.end, receipt.restore.direction);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  return { ok: true };
}

function nativeInsert(element: HTMLTextAreaElement, capture: SnippetCapture, body: string, expected: string): boolean {
  const doc = element.ownerDocument;
  if (typeof doc.execCommand !== 'function') return false;
  const active = doc.activeElement;
  element.focus();
  element.setSelectionRange(capture.start, capture.end, capture.direction);
  try { doc.execCommand('insertText', false, body); } catch { /* fall through */ }
  if (element.value === expected) return true;
  if (element.value === capture.text) { // nothing applied — safe to fall back
    if (active instanceof HTMLElement && active !== element) active.focus();
    return false;
  }
  // A native attempt that produced unexpected text must not be spliced over.
  if (element.isConnected) element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
  throw new Error('The editor changed unexpected text; the draft was left as the editor reported it.');
}

/** Insert at the captured range: native insertText when it produces a correct
 * single undo step, otherwise a computed setRangeText splice + input event.
 * Exactly one owner-visible edit on success; the caller applies `receipt.result`. */
export function insertSnippet(element: HTMLTextAreaElement, capture: SnippetCapture, signature: string, body: string): InsertionResult {
  const stale = captureStale(element, capture, signature);
  if (stale) return { ok: false, error: stale };
  const spliced = spliceSnippet(capture.text, capture.start, capture.end, body);
  if (!spliced) return { ok: false, error: 'The captured range is no longer valid.' };
  const receipt: InsertionReceipt = { signature, restore: capture, result: spliced.text, caret: spliced.caret };
  if (nativeInsert(element, capture, body, spliced.text)) return { ok: true, receipt, mode: 'native' };
  element.focus();
  element.setRangeText(body, capture.start, capture.end, 'end');
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: body }));
  return { ok: true, receipt, mode: 'fallback' };
}
