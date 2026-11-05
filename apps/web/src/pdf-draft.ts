import type { DocumentPreviewProps } from '../../../packages/ui-catalog/documents';
import type { VisualSignature } from '../../../packages/ui-catalog/signature-data';
import { draftInput, isPdfDraft, type PdfDraft } from './pdf-draft-protocol';

/** Each draft owns a fixed local module worker, its deadline, and its terminal cleanup. */
export async function createPdfDraft(source: Uint8Array, values: Record<string, unknown> = {}, signature: VisualSignature | null = null, box?: DocumentPreviewProps['signatureBox'], signal?: AbortSignal, signaturePng?: Uint8Array): Promise<PdfDraft> {
  signal?.throwIfAborted();
  const input = draftInput(source, values, signature, box, signaturePng);
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const worker = new Worker(new URL('./pdf-draft.worker.ts', import.meta.url), { type: 'module', name: `pdf-draft-${id}` });
    let finished = false;
    const finish = (error?: unknown, draft?: PdfDraft) => {
      if (finished) return; finished = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate();
      if (error !== undefined) reject(error); else resolve(draft!);
    };
    const abort = () => finish(signal?.reason ?? new DOMException('PDF draft aborted.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('PDF draft processing exceeded the preview time limit. Try again or open the source.')), 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); finish(new Error('The PDF draft worker could not process this document.')); };
    worker.onmessageerror = () => finish(new Error('Invalid PDF draft worker response.'));
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!data || typeof data !== 'object' || !('id' in data) || data.id !== id) { finish(new Error('Invalid PDF draft worker response.')); return; }
      if ('error' in data && typeof data.error === 'string' && data.error.length > 0 && data.error.length <= 1000) finish(new Error(data.error));
      else if ('draft' in data && isPdfDraft(data.draft)) finish(undefined, data.draft);
      else finish(new Error('Invalid PDF draft worker response.'));
    };
    try {
      signal?.throwIfAborted();
      // Slice the view, not its backing allocation; keep original source bytes attached and immutable.
      const bytes = source.slice(); worker.postMessage({ ...input, source: bytes, id }, [bytes.buffer]);
    } catch (error) { finish(error); }
  });
}
