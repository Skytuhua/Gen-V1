/** The evaluator accepts data only; upstream file/package loader syntax is not data. */
export function inlineJson(value:unknown):unknown {
 let entries=0;
 const copy=(item:unknown,depth:number):unknown=>{
  if(++entries>10000||depth>20)throw Error('Evaluation inline JSON exceeds its bound');
  if(item===null||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;
  if(typeof item==='string'){
   if(Buffer.byteLength(item)>128*1024||/^\s*(?:file:|package:)/i.test(item))throw Error('Evaluation requires inline JSON without external loaders');
   return item;
  }
  if(Array.isArray(item))return item.map(value=>copy(value,depth+1));
  if(item&&typeof item==='object'&&Object.getPrototypeOf(item)===Object.prototype)return Object.fromEntries(Object.entries(item).map(([key,value])=>[key,copy(value,depth+1)]));
  throw Error('Evaluation requires inline JSON values');
 };
 const result=copy(value,0);if(Buffer.byteLength(JSON.stringify(result))>1024*1024)throw Error('Evaluation inline JSON exceeds its bound');return result;
}
