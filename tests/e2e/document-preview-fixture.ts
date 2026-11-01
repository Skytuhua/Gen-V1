import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

export const SIGNING_FIELD_STATE_KEYS = { Name: 'name', Title: 'title', Email: 'email', SignedDate: 'signedDate' };
export const SIGNING_SIGNATURE_BOX = { page: 1, x: 76, y: 214, width: 300, height: 60 };

/** Explicit synthetic PDF, never a customer document or model-generation claim. */
export async function createSigningPdfFixture(options: { pages?: number; activeContent?: boolean; readOnlyName?: boolean } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.create(), page = document.addPage([612, 792]);
  document.setTitle('Synthetic contractor services agreement');
  const font = await document.embedFont(StandardFonts.Helvetica), bold = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Contractor Services Agreement', { x: 76, y: 716, size: 19, font: bold, color: rgb(.1, .1, .12) });
  page.drawText('SYNTHETIC TEST DOCUMENT', { x: 76, y: 690, size: 9, font, color: rgb(.4, .4, .43) });
  page.drawText('The parties may review and complete the fields below.', { x: 76, y: 636, size: 11, font });
  page.drawText('All names and terms in this fixture are illustrative.', { x: 76, y: 617, size: 11, font });
  const form = document.getForm();
  for (const [name, y, value] of [['Name', 458, 'John Doe'], ['Title', 416, 'Founder'], ['Email', 374, ''], ['SignedDate', 332, 'October 24, 2026']] as const) {
    const field = form.createTextField(name);
    field.setText(value); field.addToPage(page, { x: 76, y, width: 440, height: 31, font, borderWidth: 0, textColor: rgb(.08, .08, .1) }); field.setFontSize(14);
    page.drawLine({ start: { x: 76, y: y - 2 }, end: { x: 516, y: y - 2 }, thickness: .5, color: rgb(.65, .65, .68) });
    if (name === 'Name' && options.readOnlyName) field.enableReadOnly();
  }
  page.drawText('Visual signature', { x: 76, y: 284, size: 10, font });
  page.drawLine({ start: { x: 76, y: 214 }, end: { x: 376, y: 214 }, thickness: .5, color: rgb(.65, .65, .68) });
  const delivery = form.createDropdown('Delivery'); delivery.addOptions(['Work', 'Personal']); delivery.select('Work'); delivery.addToPage(page, { x: 76, y: 150, width: 180, height: 25, font });
  const accepted = form.createCheckBox('Accepted'); accepted.addToPage(page, { x: 76, y: 108, width: 14, height: 14 }); page.drawText('Reviewed fixture fields', { x: 99, y: 111, size: 10, font });
  for (let index = 1; index < (options.pages ?? 2); index++) document.addPage([612, 792]).drawText(`Synthetic schedule ${index}`, { x: 76, y: 716, size: 18, font: bold });
  if (options.activeContent) {
    document.catalog.set(PDFName.of('OpenAction'), document.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of("globalThis.__pdfExecuted = true; fetch('https://pdf-action.invalid/executed')") }));
    page.node.addAnnot(document.context.register(document.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [76, 600, 400, 625], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://pdf-action.invalid/link') } })));
  }
  form.updateFieldAppearances(font);
  return document.save();
}
