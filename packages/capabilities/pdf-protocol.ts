import type {PdfArgs} from './schemas.ts';

export const PDF_LIMITS=Object.freeze({inputBytes:32*1024*1024,outputBytes:32*1024*1024,inspectionBytes:2*1024*1024,pages:200,fields:500,treeNodes:2000,treeDepth:64,deadlineMs:15000,decodedStreamBytes:16*1024*1024});
export const PDF_LIMITATIONS=[
 'No OCR; scanned pages have no extracted text.',
 'Text extraction is best effort for simple literal/hex text operators; custom font maps, ligatures, nested XObjects and layout reading order are unsupported.',
 'Visual typed/drawn signatures are marks only; no certificate/digital signatures or signature validation.',
 'Encrypted PDFs, XFA forms and editing PDFs containing digital signature fields are unsupported. No email or remote delivery.',
 'PDF processing is limited to 32 MiB sources, 200 pages, 500 form fields and 15 seconds; extracted inspection data is limited to 2 MiB.',
];
export interface PdfInspection {
 pageCount:number;
 pages:{page:number;width:number;height:number;rotation:number;text:string;textError?:string}[];
 fields:{name:string;type:string;readOnly:boolean;value?:string|string[]|boolean|null;options?:string[];supported?:boolean}[];
 limitations:string[];
}
export type PdfJob={kind:'inspect';bytes:Uint8Array}|{kind:'render';bytes:Uint8Array;args:PdfArgs;pngs:[string,Uint8Array][]};
