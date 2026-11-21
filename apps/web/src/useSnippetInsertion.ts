import { useCallback, useEffect, useRef, useState } from 'react';
import { captureSelection, insertSnippet, undoInsertion, type InsertionReceipt, type InsertionResult, type SnippetCapture } from './snippet-insertion.ts';

export interface SnippetInsertionOwner {
  /** The textarea the feature is bound to. */
  input: React.RefObject<HTMLTextAreaElement | null>;
  /** Owner fence: thread/draft signature + epoch. A change clears capture and receipt. */
  signature: string;
  /** Current editable predicate (held/detached/pending/closing/composing gates live with the owner). */
  editable: () => boolean;
  /** Owner acceptance channel — the only draft write; called once per accepted edit. */
  onEdit: (text: string) => void;
}

/** Maintains the remembered caret/selection for the owned textarea (D03) and runs
 * the guarded insert/undo transactions. All state clears when the owner changes. */
export function useSnippetInsertion(owner: SnippetInsertionOwner) {
  const [capture, setCapture] = useState<SnippetCapture | null>(null);
  const [receipt, setReceipt] = useState<InsertionReceipt | null>(null);
  const signature = useRef(owner.signature);

  const clear = useCallback(() => { setCapture(null); setReceipt(null); }, []);
  useEffect(() => {
    if (signature.current !== owner.signature) { signature.current = owner.signature; clear(); }
  }, [owner.signature, clear]);

  // Track the user's selection while focus is inside the textarea; events from
  // other controls leave the last valid capture intact (never zero-offset guesses).
  useEffect(() => {
    const element = owner.input.current;
    if (!element) return;
    const update = () => {
      if (signature.current !== owner.signature) return;
      const next = captureSelection(element, owner.signature);
      if (next) setCapture(next);
    };
    for (const name of ['select', 'keyup', 'pointerup', 'input']) element.addEventListener(name, update);
    return () => { for (const name of ['select', 'keyup', 'pointerup', 'input']) element.removeEventListener(name, update); };
  }, [owner.input, owner.signature]);

  const insert = useCallback((body: string): InsertionResult => {
    const element = owner.input.current;
    if (!element || !capture || !owner.editable()) return { ok: false, error: 'Pick an insertion point in the draft first.' };
    const result = insertSnippet(element, capture, signature.current, body);
    if (result.ok) {
      owner.onEdit(result.receipt.result);
      setReceipt(result.receipt);
      setCapture({ signature: signature.current, text: result.receipt.result, start: result.receipt.caret, end: result.receipt.caret, direction: 'none' });
    }
    return result;
  }, [capture, owner]);

  const undo = useCallback((): { ok: boolean; error?: string } => {
    const element = owner.input.current;
    if (!element || !receipt || receipt.signature !== signature.current) return { ok: false, error: 'Nothing to undo here.' };
    const undone = undoInsertion(element, receipt, signature.current);
    if (undone.ok) {
      owner.onEdit(receipt.restore.text);
      setReceipt(null);
      setCapture(receipt.restore);
    }
    return undone;
  }, [receipt, owner]);

  return { capture, receipt, insert, undo, clear };
}
