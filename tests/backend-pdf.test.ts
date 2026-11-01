import {describe,it,expect} from 'vitest';
import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {performance} from 'node:perf_hooks';
import {inspectPdf,renderPdf} from '../packages/capabilities/pdf.ts';
import {toolSchemas} from '../packages/capabilities/schemas.ts';

function hostileTree(levels=18,cycle=false){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>'];
 for(let index=0;index<levels;index++){const id=index+2,child=cycle&&index===levels-1?2:id+1;objects.push(`<< /Type /Pages /Kids [${child} 0 R ${child} 0 R] /Count 1${index?` /Parent ${id-1} 0 R`:''} >>`);}
 objects.push(`<< /Type /Page /Parent ${levels+1} 0 R /MediaBox [0 0 612 792] >>`);
 let source='%PDF-1.7\n';const offsets=[0];objects.forEach((value,index)=>{offsets.push(source.length);source+=`${index+1} 0 obj\n${value}\nendobj\n`;});const xref=source.length;
 source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 return new TextEncoder().encode(source);
}
async function fixture(){const doc=await PDFDocument.create(),page=doc.addPage([300,300]),font=await doc.embedFont(StandardFonts.Helvetica);page.drawText('Source agreement',{x:20,y:270,font,size:12});const name=doc.getForm().createTextField('Name');name.setText('Original');name.addToPage(page,{x:20,y:200,width:200,height:30});return doc.save();}
async function expensiveText(){const doc=await PDFDocument.create(),page=doc.addPage([200,200]);page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream('['.repeat(2*1024*1024))));return doc.save();}
const args=toolSchemas.pdf_prepare.parse({resourceId:'source',exportResourceId:'destination',outputPath:'signed.pdf',fields:{Name:'Ada'},signatures:[{kind:'drawn',page:1,x:20,y:20,width:100,height:40,strokes:[[{x:0,y:0},{x:.2,y:.4}],[{x:.7,y:.4},{x:1,y:.1}]]}]});

describe('bounded backend PDF processing',()=>{
 it('rejects repeated page references without blocking the host timer',async()=>{const started=performance.now(),timer=new Promise<number>(accept=>setTimeout(()=>accept(performance.now()-started),25));const outcome=await inspectPdf(hostileTree()).then(result=>`Incorrectly accepted ${result.pageCount} pages`,error=>error instanceof Error?error.message:String(error));expect(outcome).toMatch(/page tree|repeated/i);expect(await timer).toBeLessThan(500);});
 it('rejects cyclic page references before recursive expansion',async()=>{await expect(inspectPdf(hostileTree(3,true))).rejects.toThrow(/page tree|cyclic/i);});
 it('bounds source bytes and page count',async()=>{await expect(inspectPdf(new Uint8Array(32*1024*1024+1))).rejects.toThrow(/32 MiB|size/i);const doc=await PDFDocument.create();for(let index=0;index<201;index++)doc.addPage([20,20]);await expect(inspectPdf(await doc.save())).rejects.toThrow(/200 pages/i);});
 it('preserves source bytes, supported fields, literal text and multi-stroke export',async()=>{const source=await fixture(),before=source.slice(),inspection=await inspectPdf(source);expect(inspection.pageCount).toBe(1);expect(inspection.pages[0].text).toContain('Source agreement');expect(inspection.fields.find(field=>field.name==='Name')?.value).toBe('Original');const rendered=await renderPdf(source,args),result=await PDFDocument.load(rendered);expect(result.getForm().getTextField('Name').getText()).toBe('Ada');expect(source).toEqual(before);expect(result.getPageCount()).toBe(1);});
 it('honors an already revoked context before processing',async()=>{const controller=new AbortController();controller.abort();await expect(inspectPdf(await fixture(),controller.signal)).rejects.toMatchObject({code:'CANCELLED'});});
 it('aborts active processing and retains responsive host timers',async()=>{const source=await expensiveText(),controller=new AbortController(),started=performance.now(),timer=new Promise<number>(accept=>setTimeout(()=>accept(performance.now()-started),25));const pending=inspectPdf(source,controller.signal);setTimeout(()=>controller.abort(),1000);await expect(pending).rejects.toMatchObject({code:'CANCELLED'});expect(performance.now()-started).toBeLessThan(5000);expect(await timer).toBeLessThan(500);},8000);
 it('terminates a genuinely over-budget text parser at the fixed deadline',async()=>{const source=await expensiveText(),started=performance.now();await expect(inspectPdf(source)).rejects.toMatchObject({code:'PDF_TIMEOUT'});expect(performance.now()-started).toBeLessThan(18000);},20000);
 it('keeps rendering field failures actionable',async()=>{await expect(renderPdf(await fixture(),{...args,fields:{Name:true}})).rejects.toMatchObject({code:'UNSUPPORTED_PDF_FIELD'});});
});
