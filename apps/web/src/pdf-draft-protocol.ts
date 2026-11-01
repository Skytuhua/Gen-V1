import type { DocumentPreviewProps } from '../../../packages/ui-catalog/documents';
import { readVisualSignature, validateSignaturePng, type VisualSignature } from '../../../packages/ui-catalog/signature-data';

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;
export const MAX_FIELD_RECTANGLES = 4000;
export type FieldRectangle = { name: string; page: number; rect: [number, number, number, number] };
export type PdfDraft = { bytes: Uint8Array; fields: FieldRectangle[]; edited: boolean };
export type DraftInput = { source: Uint8Array; values: Record<string, string | boolean | string[]>; signature: VisualSignature | null; box?: DocumentPreviewProps['signatureBox']; signaturePng?: Uint8Array };
export type DraftRequest = DraftInput & { id: string };

/** Project only bounded PDF data into the structured clone; never pass host state or credentials. */
export function draftInput(source: Uint8Array, values: Record<string, unknown>, signature: VisualSignature | null, box?: DocumentPreviewProps['signatureBox'], signaturePng?: Uint8Array): DraftInput {
  if (!(source instanceof Uint8Array) || !source.byteLength || source.byteLength > MAX_PDF_BYTES) throw new Error('Preview supports PDFs up to 20 MiB.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid PDF field values.');
  const edits: DraftInput['values'] = Object.create(null);
  let count = 0, characters = 0;
  for (const name in values) {
    if (!Object.hasOwn(values, name)) continue;
    if (++count > 100) throw new Error('Preview supports at most 100 bound fields.');
    if (!name.length || name.length > 300) throw new Error('Invalid PDF field name.');
    const value = values[name]; if (value === undefined) continue;
    const strings = typeof value === 'string' ? [value] : Array.isArray(value) && value.length <= 100 ? value : null;
    if (typeof value !== 'boolean' && (!strings || strings.some(item => typeof item !== 'string' || item.length > 10000))) throw new Error(`Cannot preview PDF field “${name}”: unsupported or oversized value.`);
    characters += name.length + (strings?.reduce((size, item: string) => size + item.length, 0) ?? 0);
    if (characters > 1_000_000) throw new Error('The PDF field values exceed the preview limit.');
    edits[name] = typeof value === 'boolean' || typeof value === 'string' ? value : [...strings!];
  }
  const mark = readVisualSignature(signature);
  if (mark?.kind === 'image') {
    if (!signaturePng) throw new Error('The signature PNG resource is not available. Upload it again.');
    validateSignaturePng(signaturePng);
  } else if (signaturePng !== undefined) throw new Error('Unexpected signature PNG data.');
  let placement: DraftInput['box'];
  if (box !== undefined) {
    if (!box || ![box.page, box.x, box.y, box.width, box.height].every(value => typeof value === 'number' && Number.isFinite(value)) || !Number.isInteger(box.page) || box.page < 1 || box.page > MAX_PDF_PAGES || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.width > 2000 || box.height > 2000) throw new Error('Invalid PDF signature placement.');
    placement = { page: box.page, x: box.x, y: box.y, width: box.width, height: box.height };
  }
  return { source, values: edits, signature: mark, box: placement, ...(signaturePng ? { signaturePng: signaturePng.slice() } : {}) };
}

export function isPdfDraft(value: unknown): value is PdfDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as PdfDraft;
  return draft.bytes instanceof Uint8Array && draft.bytes.byteLength > 0 && draft.bytes.byteLength <= MAX_PDF_BYTES && draft.bytes.buffer.byteLength <= MAX_PDF_BYTES && typeof draft.edited === 'boolean' && Array.isArray(draft.fields) && draft.fields.length <= MAX_FIELD_RECTANGLES && draft.fields.every(field => field && typeof field.name === 'string' && field.name.length > 0 && field.name.length <= 300 && Number.isInteger(field.page) && field.page >= 1 && field.page <= MAX_PDF_PAGES && Array.isArray(field.rect) && field.rect.length === 4 && field.rect.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && Math.abs(coordinate) <= 14400));
}
