import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef} from 'pdf-lib';
import {HarnessError} from '../contracts/index.ts';
import {PDF_LIMITS} from './pdf-protocol.ts';

/** Validate identity and parent links before pdf-lib recursively expands page/field trees. */
export function validatePdfStructure(document:PDFDocument):void{
 const invalid=(tree:string)=>new HarnessError('INVALID_PDF_STRUCTURE',`Invalid PDF ${tree} tree: repeated, cyclic or malformed references.`);
 const pages=document.context.lookup(document.catalog.get(PDFName.of('Pages')));
 const pending:{node:unknown;parent:PDFDict|undefined;depth:number}[]=[{node:pages,parent:undefined,depth:0}],seen=new Set<PDFDict>();let leaves=0;
 while(pending.length){
  const {node,parent,depth}=pending.pop()!;
  if(!(node instanceof PDFDict)||seen.has(node)||depth>PDF_LIMITS.treeDepth||seen.size>=PDF_LIMITS.treeNodes)throw invalid('page');
  seen.add(node);if(document.context.lookup(node.get(PDFName.of('Parent')))!==parent)throw invalid('page');
  const type=node.get(PDFName.of('Type'));
  if(type===PDFName.of('Page')){if(++leaves>PDF_LIMITS.pages)throw new HarnessError('PDF_LIMIT','PDF processing supports 1 to 200 pages.');}
  else if(type===PDFName.of('Pages')){
   const kids=document.context.lookup(node.get(PDFName.of('Kids')));
   if(!(kids instanceof PDFArray)||!kids.size()||kids.size()>PDF_LIMITS.treeNodes||pending.length+kids.size()>PDF_LIMITS.treeNodes)throw invalid('page');
   for(let index=0;index<kids.size();index++){const ref=kids.get(index);if(!(ref instanceof PDFRef))throw invalid('page');pending.push({node:document.context.lookup(ref),parent:node,depth:depth+1});}
  }else throw invalid('page');
 }
 if(!leaves)throw invalid('page');
 const form=document.context.lookup(document.catalog.get(PDFName.of('AcroForm')));if(form===undefined)return;
 if(!(form instanceof PDFDict))throw invalid('form');
 if(form.has(PDFName.of('XFA')))throw new HarnessError('UNSUPPORTED_PDF','XFA forms unsupported');
 const roots=document.context.lookup(form.get(PDFName.of('Fields')));if(roots===undefined)return;if(!(roots instanceof PDFArray)||roots.size()>PDF_LIMITS.fields)throw invalid('form');
 const fields:{node:unknown;parent:PDFDict|undefined;depth:number}[]=roots.asArray().map(ref=>({node:document.context.lookup(ref),parent:undefined,depth:0})),visited=new Set<PDFDict>();
 while(fields.length){
  const {node,parent,depth}=fields.pop()!;if(!(node instanceof PDFDict)||visited.has(node)||depth>PDF_LIMITS.treeDepth||visited.size>=PDF_LIMITS.treeNodes)throw invalid('form');visited.add(node);
  const actual=document.context.lookup(node.get(PDFName.of('Parent')));if(actual!==parent)throw invalid('form');
  const children=document.context.lookup(node.get(PDFName.of('Kids')));if(children===undefined)continue;
  if(!(children instanceof PDFArray)||children.size()>PDF_LIMITS.treeNodes||fields.length+children.size()>PDF_LIMITS.treeNodes)throw invalid('form');
  for(const child of children.asArray())fields.push({node:document.context.lookup(child),parent:node,depth:depth+1});
 }
}
