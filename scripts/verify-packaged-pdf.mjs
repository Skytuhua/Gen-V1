import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const host=resolve(process.argv[2]);
const require=createRequire(pathToFileURL(join(host,'package.json')));
const {PDFDocument,PDFName}=require('pdf-lib');
const {inspectPdf,renderPdf}=await import(pathToFileURL(join(host,'packages/capabilities/pdf.ts')).href);
const document=await PDFDocument.create();const page=document.addPage([300,300]);
const field=document.getForm().createTextField('Name');field.setText('Original');field.addToPage(page,{x:20,y:200,width:240,height:30});
const source=await document.save(),original=source.slice();
assert.equal((await inspectPdf(source)).pageCount,1);
const rendered=await renderPdf(source,{resourceId:'source',exportResourceId:'export',outputPath:'review.pdf',fields:{Name:'Reviewed in packaged Node'}});
assert.equal((await PDFDocument.load(rendered)).getForm().getTextField('Name').getText(),'Reviewed in packaged Node');
assert.deepEqual(source,original);
const controller=new AbortController();controller.abort();await assert.rejects(inspectPdf(source,controller.signal),{code:'CANCELLED'});
// PDF bytes remain data: reject a duplicate reference before recursive expansion.
const hostile=await PDFDocument.create();const duplicate=hostile.addPage([200,200]);
const tree=hostile.context.lookup(hostile.catalog.get(PDFName.of('Pages')));tree.set(PDFName.of('Kids'),hostile.context.obj([duplicate.ref,duplicate.ref]));
const bytes=await hostile.save(),started=performance.now();const timer=new Promise(accept=>setTimeout(()=>accept(performance.now()-started),25));
await assert.rejects(inspectPdf(bytes),error=>/page|tree|repeated/i.test(error.message));
assert.ok(await timer<500,'The packaged PDF worker must leave host timers responsive');
console.log(JSON.stringify({node:process.versions.node,packagedHost:host,checks:5,passed:true,inference:false}));
