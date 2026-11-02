import * as pdf from 'pdf-lib';
import { signatureStrokes } from '../../../packages/ui-catalog/signature-data';
import { draftInput, isPdfDraft, MAX_PDF_BYTES as MAX_BYTES, MAX_PDF_PAGES as MAX_PAGES, MAX_FIELD_RECTANGLES, type DraftInput, type DraftRequest, type FieldRectangle, type PdfDraft } from './pdf-draft-protocol';

/** Check unique reachable dictionaries and Parent links before pdf-lib's recursive expansion. */
function validatePageTree(document: pdf.PDFDocument) {
  const invalid = () => new Error('Invalid PDF page tree: repeated, cyclic or malformed page references.');
  const root = document.context.lookup(document.catalog.get(pdf.PDFName.of('Pages')));
  const pending = [{ node: root, parent: undefined as pdf.PDFDict | undefined, depth: 0 }];
  const seen = new Set<pdf.PDFDict>(); let leaves = 0;
  while (pending.length) {
    const { node, parent, depth } = pending.pop()!;
    if (!(node instanceof pdf.PDFDict) || seen.has(node) || depth > 64 || seen.size >= 2000) throw invalid();
    seen.add(node);
    const actualParent = document.context.lookup(node.get(pdf.PDFName.of('Parent')));
    if (actualParent !== parent) throw invalid();
    const type = node.get(pdf.PDFName.of('Type'));
    if (type === pdf.PDFName.of('Page')) {
      if (++leaves > MAX_PAGES) throw new Error('Preview supports PDFs with 1 to 200 pages.');
    } else if (type === pdf.PDFName.of('Pages')) {
      const kids = document.context.lookup(node.get(pdf.PDFName.of('Kids')));
      if (!(kids instanceof pdf.PDFArray) || !kids.size() || kids.size() > 2000 || pending.length + kids.size() > 2000) throw invalid();
      for (let index = 0; index < kids.size(); index++) {
        const ref = kids.get(index);
        if (!(ref instanceof pdf.PDFRef)) throw invalid();
        pending.push({ node: document.context.lookup(ref), parent: node, depth: depth + 1 });
      }
    } else throw invalid();
  }
  if (!leaves) throw invalid();
}

/** Derive a disposable preview from original bytes; never mutate the granted source. */
async function deriveDraft({ source, values, signature, box, signaturePng }: DraftInput): Promise<PdfDraft> {
  if (source.byteLength > MAX_BYTES) throw new Error('Preview supports PDFs up to 20 MiB.');
  const document = await pdf.PDFDocument.load(source, { updateMetadata: false });
  if (document.isEncrypted) throw new Error('Encrypted PDFs cannot be previewed. Provide an unencrypted copy.');
  validatePageTree(document);
  const pages = document.getPages(), form = document.getForm();
  if (!pages.length || pages.length > MAX_PAGES) throw new Error('Preview supports PDFs with 1 to 200 pages.');
  if (pages.some(page => !Number.isFinite(page.getWidth()) || !Number.isFinite(page.getHeight()) || page.getWidth() <= 0 || page.getHeight() <= 0 || page.getWidth() > 14400 || page.getHeight() > 14400)) throw new Error('The PDF page dimensions exceed the preview limit.');
  if (form.hasXFA()) throw new Error('XFA forms cannot be previewed. Provide a standard PDF form.');
  const fields = form.getFields();
  if (fields.length > 1000) throw new Error('This PDF has too many fields to preview.');
  const edits = Object.entries(values).filter(([, value]) => value !== undefined);
  if (edits.length > 100) throw new Error('Preview supports at most 100 bound fields.');
  if ((edits.length || signature) && fields.some(field => field instanceof pdf.PDFSignature)) throw new Error('Draft editing of PDFs with digital signature fields is unsupported. Open the original source to inspect it.');
  const rectangles: FieldRectangle[] = [];
  for (const field of fields) for (const widget of field.acroField.getWidgets()) {
    if (rectangles.length >= MAX_FIELD_RECTANGLES || field.getName().length > 300) throw new Error('This PDF has too many or oversized field widgets to preview.');
    const rectangle = widget.getRectangle(), pageRef = widget.P();
    const pageIndex = pages.findIndex(page => pageRef ? page.ref.toString() === pageRef.toString() : page.node.Annots()?.asArray().some(ref => document.context.lookup(ref) === widget.dict));
    if (pageIndex >= 0) rectangles.push({ name: field.getName(), page: pageIndex + 1, rect: [rectangle.x, rectangle.y, rectangle.x + rectangle.width, rectangle.y + rectangle.height] });
  }
  for (const [name, value] of edits) {
    const field = form.getFieldMaybe(name);
    if (!field) throw new Error(`PDF field “${name}” was not found. Update the field binding to match the source PDF.`);
    if (field.isReadOnly()) throw new Error(`PDF field “${name}” is read-only.`);
    try {
      if (field instanceof pdf.PDFTextField && typeof value === 'string' && value.length <= 10000) field.setText(value);
      else if (field instanceof pdf.PDFCheckBox && typeof value === 'boolean') value ? field.check() : field.uncheck();
      else if ((field instanceof pdf.PDFDropdown || field instanceof pdf.PDFOptionList) && (typeof value === 'string' || Array.isArray(value))) {
        const selected = Array.isArray(value) ? value : [value];
        if (selected.length > 100 || selected.some(item => typeof item !== 'string' || !field.getOptions().includes(item))) throw new Error('Choose one of the PDF field’s available options.');
        if (!selected.length) field.clear(); else field.select(selected);
      } else if (field instanceof pdf.PDFRadioGroup && typeof value === 'string') {
        if (!value) field.clear();
        else if (field.getOptions().includes(value)) field.select(value);
        else throw new Error('Choose one of the PDF field’s available options.');
      } else throw new Error('The value does not match this supported PDF field type.');
    } catch (error) { throw new Error(`Cannot preview PDF field “${name}”: ${error instanceof Error ? error.message : 'unsupported value'}`); }
  }
  if (signature) {
    if (!box) throw new Error('A signature placement is required to preview this mark.');
    const validBox = box;
    const page = pages[validBox.page - 1];
    if (!page || page.getRotation().angle !== 0 || validBox.x + validBox.width > page.getWidth() || validBox.y + validBox.height > page.getHeight()) throw new Error('The visual signature must fit within an unrotated PDF page using bottom-left PDF coordinates.');
    const mark = signature;
    if (mark?.kind === 'typed') {
      try {
        const font = await document.embedFont(pdf.StandardFonts.HelveticaOblique);
        const size = Math.min(validBox.height * .75, 22, validBox.width / Math.max(1, font.widthOfTextAtSize(mark.text, 1)));
        page.drawText(mark.text, { x: validBox.x, y: validBox.y + Math.max(1, (validBox.height - size) / 2), size, font, color: pdf.rgb(.1, .1, .2) });
      } catch { throw new Error('The typed signature contains characters unsupported by the PDF’s standard font. Draw the visual signature instead.'); }
    } else if (mark?.kind === 'image') {
      const image = await document.embedPng(signaturePng!);
      page.drawImage(image, { x: validBox.x, y: validBox.y, width: validBox.width, height: validBox.height });
    } else if (mark?.kind === 'drawn') {
      for (const stroke of signatureStrokes(mark)) for (let index = 1; index < stroke.length; index++) {
        const a = stroke[index - 1], b = stroke[index];
        page.drawLine({ start: { x: validBox.x + a.x * validBox.width, y: validBox.y + (1 - a.y) * validBox.height }, end: { x: validBox.x + b.x * validBox.width, y: validBox.y + (1 - b.y) * validBox.height }, thickness: 1.5, color: pdf.rgb(.1, .1, .2) });
      }
    }
  }
  const edited = Boolean(edits.length || signature);
  if (!edited) return { bytes: source.slice(), fields: rectangles, edited: false };
  try { form.updateFieldAppearances(); return { bytes: await document.save(), fields: rectangles, edited }; }
  catch (error) { throw new Error(`The PDF draft could not be rendered with these values: ${error instanceof Error ? error.message : 'unsupported text or appearance'}`); }
}

// This entry is bundled from trusted source by Vite. PDF bytes are data, never executable code.
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<DraftRequest>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
scope.onmessage = ({ data }) => {
  void (async () => {
    const id = data?.id;
    if (typeof id !== 'string' || id.length > 100) return;
    try {
      const input = draftInput(data.source, data.values, data.signature, data.box, data.signaturePng);
      const draft = await deriveDraft(input);
      if (!isPdfDraft(draft)) throw new Error('The PDF draft exceeds the preview output limit.');
      scope.postMessage({ id, draft }, [draft.bytes.buffer]);
    } catch (error) {
      scope.postMessage({ id, error: (error instanceof Error ? error.message : 'The PDF draft could not be prepared.').slice(0, 1000) || 'The PDF draft could not be prepared.' });
    }
  })();
};
