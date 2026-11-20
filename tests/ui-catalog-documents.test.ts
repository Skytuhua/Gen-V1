import {expect,it,describe} from 'vitest';
import {DOCUMENT_SCHEMAS,DOCUMENT_EXAMPLES} from '../packages/ui-catalog/documents';
import {IMAGE_COMPARE_SCHEMAS,IMAGE_COMPARE_EXAMPLES,IMAGE_COMPARE_DESCRIPTIONS} from '../packages/ui-catalog/image-compare';
import {MAX_SIGNATURE_POINTS,readVisualSignature,signatureStrokes,validateSignaturePng} from '../packages/ui-catalog/signature-data';

const preview=DOCUMENT_SCHEMAS.DocumentPreview,pad=DOCUMENT_SCHEMAS.SignaturePad;
describe('DocumentPreview schema',()=>{
 const base={resourceId:'granted-pdf'};
 it('admits granted resource props and rejects URLs, traversal and unsafe state keys',()=>{
  expect(preview.parse({...base,resourcePath:'docs/a.pdf',title:'A.pdf',page:2,fit:'width',exportOperationId:'export-1'})).toMatchObject({resourceId:'granted-pdf',page:2});
  for(const resourceId of ['.','..','dir/file','https://x.test','a b','a\tb','res?1','x'.repeat(201),''])expect(preview.safeParse({resourceId}).success).toBe(false);
  for(const resourcePath of ['../up','a/../../b','/abs','\\abs','a:b','a\0b','x'.repeat(1025),''])expect(preview.safeParse({...base,resourcePath}).success).toBe(false);
  for(const stateKey of ['__proto__','prototype','constructor','0bad','a b','x'.repeat(129)])expect(preview.safeParse({...base,activeFieldStateKey:stateKey}).success).toBe(false);
 });
 it('requires signatureStateKey and signatureBox together and bounds field bindings',()=>{
  const box={page:1,x:0,y:0,width:10,height:10};
  expect(preview.safeParse({...base,signatureStateKey:'sig',signatureBox:box}).success).toBe(true);
  expect(preview.safeParse({...base,signatureStateKey:'sig'}).success).toBe(false);
  expect(preview.safeParse({...base,signatureBox:box}).success).toBe(false);
  for(const bad of [{...box,page:0},{...box,page:201},{...box,x:-1},{...box,y:NaN},{...box,width:0},{...box,width:2001},{...box,height:Infinity}])expect(preview.safeParse({...base,signatureStateKey:'sig',signatureBox:bad}).success).toBe(false);
  expect(preview.safeParse({...base,fieldStateKeys:Object.fromEntries(Array.from({length:100},(_,i)=>['F'+i,'f'+i]))}).success).toBe(true);
  expect(preview.safeParse({...base,fieldStateKeys:Object.fromEntries(Array.from({length:101},(_,i)=>['F'+i,'f'+i]))}).success).toBe(false);
  expect(preview.safeParse({...base,fieldStateKeys:{'Name':'__proto__'}}).success).toBe(false);
  expect(preview.safeParse({...base,title:'x'.repeat(301)}).success).toBe(false);
  expect(preview.safeParse({...base,page:0}).success).toBe(false);
  expect(preview.safeParse({...base,extra:true}).success).toBe(false);
 });
 it('admits SignaturePad options and rejects foreign props',()=>{
  expect(pad.parse({stateKey:'sig',nameStateKey:'name',label:'Sign',initialMode:'type'})).toMatchObject({stateKey:'sig'});
  expect(pad.safeParse({stateKey:'sig',initialMode:'draw' as const}).success).toBe(true);
  expect(pad.safeParse({stateKey:'sig',initialMode:'stamp'}).success).toBe(false);
  expect(pad.safeParse({stateKey:'sig',actionId:'sign'}).success).toBe(false);
  expect(pad.safeParse({}).success).toBe(false);
 });
 it('keeps shipped examples valid',()=>{
  expect(preview.safeParse(DOCUMENT_EXAMPLES.DocumentPreview).success).toBe(true);
  expect(pad.safeParse(DOCUMENT_EXAMPLES.SignaturePad).success).toBe(true);
 });
});
describe('ImageCompare schema',()=>{
 const schema=IMAGE_COMPARE_SCHEMAS.ImageCompare;
 it('requires two granted images and a state key, rejecting URLs and foreign props',()=>{
  expect(schema.parse({beforeResourceId:'before',afterResourceId:'after',stateKey:'cmp'})).toMatchObject({stateKey:'cmp'});
  for(const patch of [{beforeResourceId:'https://x.test'},{afterResourceId:'..'},{beforeResourceId:'a b'},{afterResourceId:'a/b'},{stateKey:'constructor'},{stateKey:'9bad'}])expect(schema.safeParse({beforeResourceId:'b',afterResourceId:'a',stateKey:'s',...patch}).success).toBe(false);
  expect(schema.safeParse({beforeResourceId:'b',afterResourceId:'a',stateKey:'s',script:'x'}).success).toBe(false);
  expect(schema.safeParse({beforeResourceId:'b',afterResourceId:'a'}).success).toBe(false);
 });
 it('bounds labels and titles and keeps examples and descriptions consistent',()=>{
  for(const [key,value] of [['beforeLabel',''],['afterLabel','x'.repeat(121)],['title','x'.repeat(301)]] as const)expect(schema.safeParse({beforeResourceId:'b',afterResourceId:'a',stateKey:'s',[key]:value}).success).toBe(false);
  expect(schema.safeParse(IMAGE_COMPARE_EXAMPLES.ImageCompare).success).toBe(true);
  expect(IMAGE_COMPARE_DESCRIPTIONS.ImageCompare.length).toBeGreaterThan(0);
 });
});
describe('readVisualSignature',()=>{
 it('returns null for absent or empty values and rejects non-objects',()=>{
  for(const value of [null,undefined])expect(readVisualSignature(value)).toBeNull();
  for(const value of ['sig',4,true,[]])expect(()=>readVisualSignature(value)).toThrow('invalid');
 });
 it('accepts typed and image marks within bounds',()=>{
  expect(readVisualSignature({kind:'typed',text:' Ada '})).toEqual({kind:'typed',text:' Ada '});
  expect(readVisualSignature({kind:'typed',text:'   '})).toBeNull();
  expect(()=>readVisualSignature({kind:'typed',text:'x'.repeat(201)})).toThrow('invalid');
  expect(readVisualSignature({kind:'image',resourceId:'sig-1'})).toEqual({kind:'image',resourceId:'sig-1'});
  for(const resourceId of ['.','..','a/b','a b','a?b','x'.repeat(201)])expect(()=>readVisualSignature({kind:'image',resourceId})).toThrow('invalid');
 });
 it('accepts drawn points or strokes, never both, and enforces shape and bounds',()=>{
  expect(readVisualSignature({kind:'drawn',points:[{x:0,y:0},{x:1,y:1}]})).toEqual({kind:'drawn',points:[{x:0,y:0},{x:1,y:1}]});
  const strokes=[[{x:0,y:0},{x:.5,y:.5}],[{x:.2,y:.2},{x:1,y:1}]];
  expect(readVisualSignature({kind:'drawn',strokes})).toEqual({kind:'drawn',strokes});
  expect(()=>readVisualSignature({kind:'drawn',points:[{x:0,y:0},{x:1,y:1}],strokes})).toThrow('invalid');
  expect(()=>readVisualSignature({kind:'drawn'})).toThrow('invalid');
  expect(()=>readVisualSignature({kind:'drawn',points:[]})).toThrow('invalid');
  expect(()=>readVisualSignature({kind:'drawn',points:[{x:0,y:0}]})).toThrow('invalid');
  expect(()=>readVisualSignature({kind:'drawn',strokes:Array.from({length:1001},()=>[{x:0,y:0},{x:1,y:1}])})).toThrow('invalid');
  const over=Array.from({length:Math.ceil((MAX_SIGNATURE_POINTS+1)/2)},()=>[{x:0,y:0},{x:1,y:1}]);
  expect(()=>readVisualSignature({kind:'drawn',strokes:over})).toThrow('invalid');
  for(const point of [{x:-0.1,y:0},{x:0,y:1.1},{x:NaN,y:0},{x:Infinity,y:0},{x:0},{x:'0',y:0},null])expect(()=>readVisualSignature({kind:'drawn',points:[{x:0,y:0},point]})).toThrow('normalized');
  expect(()=>readVisualSignature({kind:'pencil'})).toThrow('invalid');
 });
 it('maps signatureStrokes onto either drawn representation',()=>{
  expect(signatureStrokes({kind:'drawn',points:[{x:0,y:0}]})).toEqual([[{x:0,y:0}]]);
  expect(signatureStrokes({kind:'drawn',strokes:[[{x:0,y:0}],[{x:1,y:1}]]})).toEqual([[{x:0,y:0}],[{x:1,y:1}]]);
 });
});
function png(chunks:{type:string;data?:number[]}[],width=1,height=1){
 const chunk=({type,data=[]}:{type:string;data?:number[]})=>{const bytes=[data.length>>>24&255,data.length>>>16&255,data.length>>>8&255,data.length&255,...[...type].map(c=>c.charCodeAt(0)),...data,0,0,0,0];return bytes;};
 const ihdr={type:'IHDR',data:[width>>>24&255,width>>>16&255,width>>>8&255,width&255,height>>>24&255,height>>>16&255,height>>>8&255,height&255,8,6,0,0,0]};
 return new Uint8Array([137,80,78,71,13,10,26,10,...chunk(ihdr),...chunks.flatMap(chunk)]);
}
describe('validateSignaturePng',()=>{
 const valid=png([{type:'IDAT',data:[1]},{type:'IEND'}]);
 it('returns dimensions for a complete bounded PNG',()=>{
  expect(validateSignaturePng(valid)).toEqual({width:1,height:1});
  expect(validateSignaturePng(png([{type:'sRGB'},{type:'IDAT',data:[1]},{type:'IEND'}]))).toEqual({width:1,height:1});
 });
 it('rejects bad magic, size bounds and non-Uint8Array input',()=>{
  for(const bytes of [new Uint8Array(10),valid.slice(0,40),new Uint8Array(513*1024)])expect(()=>validateSignaturePng(bytes)).toThrow('PNG');
  const bad=Uint8Array.from(valid);bad[0]=0;expect(()=>validateSignaturePng(bad)).toThrow('PNG');
  const header=Uint8Array.from(valid);header[12]=88;expect(()=>validateSignaturePng(header)).toThrow('PNG');
  expect(()=>validateSignaturePng('not-bytes' as never)).toThrow('PNG');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'}],0,1))).toThrow('dimensions');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'}],1025,1))).toThrow('dimensions');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'}],1024,513))).toThrow('dimensions');
 });
 it('requires exactly one initial IHDR, nonempty IDAT and a final empty IEND',()=>{
  const ihdr=valid.slice(8,33);
  const dup=new Uint8Array([...valid.slice(0,33),...ihdr,...valid.slice(33)]);
  expect(()=>validateSignaturePng(dup)).toThrow('initial header');
  expect(()=>validateSignaturePng(png([{type:'IEND'}]))).toThrow('ending');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]}]))).toThrow('incomplete');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND',data:[1]}]))).toThrow('ending');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'},{type:'IDAT',data:[1]}]))).toThrow('ending');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'acTL'},{type:'IEND'}]))).toThrow('Animated');
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'fcTL'},{type:'IEND'}]))).toThrow('Animated');
 });
 it('requires known chunks without upload and relaxes size and chunks for uploads',()=>{
  expect(()=>validateSignaturePng(png([{type:'tEXt',data:[1]},{type:'IDAT',data:[1]},{type:'IEND'}]))).toThrow('Normalize');
  expect(validateSignaturePng(png([{type:'tEXt',data:[1]},{type:'IDAT',data:[1]},{type:'IEND'}]),true)).toEqual({width:1,height:1});
  expect(validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'}],4096,900),true)).toEqual({width:4096,height:900});
  expect(()=>validateSignaturePng(png([{type:'IDAT',data:[1]},{type:'IEND'}],4097,1),true)).toThrow('dimensions');
 });
});
