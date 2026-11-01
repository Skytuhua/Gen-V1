import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFSignature, PDFArray, PDFRawStream, decodePDFRawStream, PDFName, StandardFonts, rgb } from "pdf-lib";
import { HarnessError } from "../contracts/index.ts";
import type { PdfArgs } from "./schemas.ts";
import {toolSchemas} from './schemas.ts';
import { signatureStrokes, validateSignaturePng } from "../ui-catalog/signature-data.ts";
import {parentPort,workerData} from 'node:worker_threads';
import {PDF_LIMITS,PDF_LIMITATIONS,type PdfInspection,type PdfJob} from './pdf-protocol.ts';
import {validatePdfStructure} from './pdf-structure.ts';
function pdfText(bytes: Uint8Array): string {
  if(bytes.byteLength>PDF_LIMITS.decodedStreamBytes)throw new HarnessError('PDF_LIMIT','A decoded PDF content stream exceeds the 16 MiB processing limit.');
  const source = Buffer.from(bytes).toString("latin1"), parts: string[] = [];
  const token = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9a-fA-F\s]+>/g;
  for (const operator of source.matchAll(/(\((?:\\[\s\S]|[^\\()])*\)|<[0-9a-fA-F\s]+>|\[[\s\S]*?\])\s*(?:Tj|TJ|'|")/g)) {
    for (const match of operator[1].matchAll(token)) {
      const value = match[0];
      if (value[0] === "<") parts.push(Buffer.from(value.slice(1, -1).replace(/\s/g, ""), "hex").toString("latin1"));
      else parts.push(value.slice(1, -1).replace(/\\([0-7]{1,3}|[\s\S])/g, (_, escaped: string) => /^[0-7]+$/.test(escaped) ? String.fromCharCode(parseInt(escaped, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[escaped] ?? escaped)));
    }
  }
  return parts.join(" ");
}
async function load(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  if (document.isEncrypted) throw new HarnessError("UNSUPPORTED_PDF", "Encrypted PDF unsupported");
  validatePdfStructure(document);
  if (document.getForm().hasXFA()) throw new HarnessError("UNSUPPORTED_PDF", "XFA forms unsupported");
  return document;
}
async function inspectPdf(bytes: Uint8Array):Promise<PdfInspection> {
  const document = await load(bytes);
  const pages = document.getPages().map((page, index) => {
    const content = page.node.get(PDFName.of("Contents"));
    const resolved = content ? document.context.lookup(content) : undefined;
    if(resolved instanceof PDFArray&&resolved.size()>PDF_LIMITS.treeNodes)throw new HarnessError('PDF_LIMIT','The PDF has too many page content streams.');
    const streams = resolved instanceof PDFArray ? resolved.asArray().map(ref => document.context.lookup(ref)) : [resolved];
    let text = "", textError: string | undefined;
    try { text = streams.filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream).map(stream => pdfText(decodePDFRawStream(stream).decode())).join("\n"); }
    catch (error) { if(error instanceof HarnessError)throw error;textError = (error instanceof Error ? error.message : String(error)).slice(0,1000); }
    return { page: index + 1, width: page.getWidth(), height: page.getHeight(), rotation: page.getRotation().angle, text, ...(textError ? { textError } : {}) };
  });
  const formFields=document.getForm().getFields();if(formFields.length>PDF_LIMITS.fields)throw new HarnessError('PDF_LIMIT','PDF processing supports at most 500 form fields.');
  const fields = formFields.map(field => {
    const base = { name: field.getName(), type: field.constructor.name, readOnly: field.isReadOnly() };
    if (field instanceof PDFTextField) return { ...base, value: field.getText() ?? "" };
    if (field instanceof PDFCheckBox) return { ...base, value: field.isChecked() };
    if (field instanceof PDFDropdown || field instanceof PDFOptionList) return { ...base, value: field.getSelected(), options: field.getOptions() };
    if (field instanceof PDFRadioGroup) return { ...base, value: field.getSelected() ?? null, options: field.getOptions() };
    return { ...base, supported: false };
  });
  return { pageCount: pages.length, pages, fields, limitations: PDF_LIMITATIONS };
}
async function renderPdf(bytes: Uint8Array, args: PdfArgs, resolvedPngs: ReadonlyMap<string, Uint8Array> = new Map()): Promise<Uint8Array> {
  const document = await load(bytes), form = document.getForm();
  const formFields=form.getFields();if(formFields.length>PDF_LIMITS.fields)throw new HarnessError('PDF_LIMIT','PDF processing supports at most 500 form fields.');
  if (formFields.some(field => field instanceof PDFSignature)) throw new HarnessError("UNSUPPORTED_PDF", "Editing PDFs with digital signature fields is unsupported");
  for (const [name, value] of Object.entries(args.fields ?? {})) {
    const field = form.getField(name);
    if (field.isReadOnly()) throw new HarnessError("UNSUPPORTED_PDF_FIELD", `Read-only field ${name}`);
    if (field instanceof PDFTextField && typeof value === "string") field.setText(value);
    else if (field instanceof PDFCheckBox && typeof value === "boolean") value ? field.check() : field.uncheck();
    else if ((field instanceof PDFDropdown || field instanceof PDFOptionList) && (typeof value === "string" || Array.isArray(value))) {
      const selected = Array.isArray(value) ? value : [value];
      if (selected.some(item => !field.getOptions().includes(item))) throw new HarnessError("INVALID_PDF_FIELD", `Unknown option for ${name}`);
      field.select(selected);
    } else if (field instanceof PDFRadioGroup && typeof value === "string" && field.getOptions().includes(value)) field.select(value);
    else throw new HarnessError("UNSUPPORTED_PDF_FIELD", `Unsupported field/value ${name} (${field.constructor.name})`);
  }
  const font = await document.embedFont(StandardFonts.HelveticaOblique);
  for (const signature of args.signatures ?? []) {
    const page = document.getPage(signature.page - 1);
    if (page.getRotation().angle !== 0 || signature.x + signature.width > page.getWidth() || signature.y + signature.height > page.getHeight()) throw new HarnessError("INVALID_SIGNATURE_PLACEMENT", "Signature must fit within an unrotated page");
    if (signature.kind === "typed") {
      const size = Math.min(signature.height * 0.75, 22, signature.width / Math.max(1, font.widthOfTextAtSize(signature.text, 1)));
      page.drawText(signature.text, { x: signature.x, y: signature.y + Math.max(1, (signature.height - size) / 2), size, font, color: rgb(0.1, 0.1, 0.2) });
    } else if (signature.kind === "image") {
      const bytes = resolvedPngs.get(signature.resourceId);
      if (!bytes) throw new HarnessError("SIGNATURE_RESOURCE_UNAVAILABLE", "The signature PNG resource must be resolved and available to this thread");
      validateSignaturePng(bytes);
      const image = await document.embedPng(bytes);
      page.drawImage(image, { x: signature.x, y: signature.y, width: signature.width, height: signature.height });
    } else {
      for (const stroke of signatureStrokes(signature)) for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1], b = stroke[i];
        page.drawLine({ start: { x: signature.x + a.x * signature.width, y: signature.y + (1 - a.y) * signature.height }, end: { x: signature.x + b.x * signature.width, y: signature.y + (1 - b.y) * signature.height }, thickness: 1.5, color: rgb(0.1, 0.1, 0.2) });
      }
    }
  }
  form.updateFieldAppearances();
  return document.save();
}

// This fixed local module processes PDF data only. All parsing, decoding and
// serialization stays off the host event loop and is owned by its deadline.
void (async()=>{
 if(!parentPort)throw new Error('PDF worker requires its owned message channel');
 try{
  const job=workerData as PdfJob;
  if(!job||!['inspect','render'].includes(job.kind)||!(job.bytes instanceof Uint8Array)||!job.bytes.byteLength||job.bytes.byteLength>PDF_LIMITS.inputBytes)throw new HarnessError('PDF_LIMIT','PDF sources must be nonempty and at most 32 MiB.');
  if(job.kind==='inspect'){
   const result=await inspectPdf(job.bytes);
   if(Buffer.byteLength(JSON.stringify(result))>PDF_LIMITS.inspectionBytes)throw new HarnessError('PDF_LIMIT','Extracted PDF inspection data exceeds 2 MiB. Use a smaller document.');
   parentPort.postMessage({kind:'inspection',result});
  }else{
   const args=toolSchemas.pdf_prepare.parse(job.args);
   if(Object.keys(args.fields??{}).length>100)throw new HarnessError('PDF_LIMIT','PDF export supports at most 100 field edits.');
   const result=await renderPdf(job.bytes,args,new Map(job.pngs));
   if(result.byteLength>PDF_LIMITS.outputBytes)throw new HarnessError('PDF_LIMIT','Rendered PDF exceeds the 32 MiB output limit.');
   const owned=Uint8Array.from(result);parentPort.postMessage({kind:'rendered',result:owned},[owned.buffer]);
  }
 }catch(error){parentPort.postMessage({kind:'error',code:error instanceof HarnessError?error.code:'PDF_ERROR',error:(error instanceof Error?error.message:'PDF processing failed').slice(0,1000)});}
})();
