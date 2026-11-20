import {expect,it,describe} from 'vitest';
import {validateRender,validateBridgePayload,safeDeclarations,sanitizeStylesheet} from '../packages/widgets/policy';
import {WIDGET_BASE_CSS} from '../packages/widgets/theme';
import {WIDGET_WORKER_PATH,WIDGET_WORKER_CSP} from '../packages/widgets/protocol';
import {WIDGET_SHELL_CSP,widgetShellDocument} from '../packages/widgets/document';

type Spec={id:number;tag:string;attrs:Record<string,string>;children:Spec[];[key:string]:unknown};
const node=(id:number,tag='div',extra:object={}):Spec=>({id,tag,attrs:{},children:[],...extra});
describe('validateRender',()=>{
 const ok={tree:[node(1,'div'),node(2,'#text',{text:'hi'}),node(3,'input',{attrs:{type:'checkbox'},checked:true}),node(4,'select',{selectedIndex:2}),node(5,'p',{attrs:{'aria-label':'x','data-id':'y'}})],css:'p{color:red}'};
 it('admits a bounded trusted tree and rejects malformed envelopes',()=>{
  expect(validateRender(ok)).toBe(true);
  for(const value of [null,4,'tree',{tree:'x',css:''},{tree:[],css:4},{tree:[node(1)],css:'x'.repeat(16385)},{tree:Array.from({length:801},(_,i)=>node(i+1)),css:''}])expect(validateRender(value)).toBe(false);
 });
 it('rejects unsafe node ids, tags, attributes and text-node shape',()=>{
  for(const bad of [node(0),node(-1),node(1.5),node(Number.MAX_SAFE_INTEGER+1),node(1,'script'),node(1,'img'),node(1,'a'),node(1,'#text',{text:1}),node(1,'#text',{attrs:{id:'x'},text:'t'}),node(1,'#text',{children:[node(2)],text:'t'})])expect(validateRender({tree:[bad],css:''})).toBe(false);
  expect(validateRender({tree:[node(1),node(1)],css:''})).toBe(false);
  for(const attrs of [{onclick:'x'},{href:'y'},{stylez:'1'},{'aria-bad name':'x'},{'data-':'x'},{class:4},{title:'x'.repeat(1025)},{type:'image'},{rows:'99999'},{tabindex:'-1001'},{maxlength:'1e3'},Object.fromEntries(Array.from({length:33},(_,i)=>['data-'+i,'v']))])expect(validateRender({tree:[node(1,'div',{attrs})],css:''})).toBe(false);
 });
 it('enforces depth, node count, children and byte budgets',()=>{
  const root=node(1);let cur=root;for(let i=2;i<=26;i++){cur.children=[node(i)];cur=cur.children[0]!;}
  expect(validateRender({tree:[root],css:''})).toBe(false);
  const wide=node(1,'div',{children:Array.from({length:801},(_,i)=>node(i+2))});
  expect(validateRender({tree:[wide],css:''})).toBe(false);
  expect(validateRender({tree:[node(1,'p',{attrs:{title:'x'.repeat(60000)}})],css:'x'.repeat(6000)})).toBe(false);
  expect(validateRender({tree:[node(1,'input',{value:'x'.repeat(16385)})],css:''})).toBe(false);
  expect(validateRender({tree:[node(1,'div',{value:5})],css:''})).toBe(false);
  expect(validateRender({tree:[node(1,'input',{checked:'yes'})],css:''})).toBe(false);
  expect(validateRender({tree:[node(1,'select',{selectedIndex:-2})],css:''})).toBe(false);
  const sparse=node(1,'div',{children:new Array(2)});sparse.children[1]=node(2);
  expect(validateRender({tree:[sparse],css:''})).toBe(false);
 });
});
describe('validateBridgePayload',()=>{
 it('admits plain bounded values',()=>{
  for(const value of [null,true,false,0,-1.5,'x',{a:[1,'two',null]},[{}]])expect(validateBridgePayload(value)).toBe(true);
 });
 it('rejects cycles, foreign prototypes, non-finite numbers and oversized structures',()=>{
  const cyclic:Record<string,unknown>={};cyclic.self=cyclic;
  const shared={x:1};const reused=[shared,shared];
  for(const value of [cyclic,reused,new Date(),NaN,Infinity,new Array(801).fill(0),Object.fromEntries(Array.from({length:129},(_,i)=>['k'+i,0])),'x'.repeat(65537)])expect(validateBridgePayload(value)).toBe(false);
  let deep:Record<string,unknown>={v:1};for(let i=0;i<26;i++)deep={next:deep};
  expect(validateBridgePayload(deep)).toBe(false);
  const sparse=new Array(2);sparse[1]=1;expect(validateBridgePayload(sparse)).toBe(false);
  expect(validateBridgePayload({k:'x'.repeat(65000),k2:'y'.repeat(2000)})).toBe(false);
 });
});
describe('safeDeclarations',()=>{
 it('keeps allowlisted declarations and drops the rest',()=>{
  expect(safeDeclarations('color:red;width:10px')).toBe('color:red;width:10px');
  expect(safeDeclarations('COLOR :red')).toBe('color:red');
  for(const declaration of ['position:fixed','background:url(x)','behavior:url(x)','content:"x"','width:calc(5000px)','width:expression(1)','width:image-set(x)','color:'+('x'.repeat(201))])expect(safeDeclarations(declaration)).toBe('');
 });
 it('allows bounded numeric and function forms only',()=>{
  expect(safeDeclarations('width:calc(100% - 10px)')).toBe('width:calc(100% - 10px)');
  expect(safeDeclarations('color:rgb(1 2 3)')).toBe('color:rgb(1 2 3)');
  expect(safeDeclarations('gap:min(4px, 2%)')).toBe('gap:min(4px, 2%)');
  expect(safeDeclarations('width:4096px')).toBe('width:4096px');
  expect(safeDeclarations('width:4097px')).toBe('');
  const many=Array.from({length:101},()=>'color:red').join(';');
  expect(safeDeclarations(many).split(';').length).toBe(100);
 });
});
describe('sanitizeStylesheet',()=>{
 it('keeps simple selectors with clean declarations',()=>{
  expect(sanitizeStylesheet('p, .a > li { color:red; width:10px }')).toBe('p, .a > li{color:red;width:10px}');
 });
 it('drops at-rules, exotic selectors, urls and everything oversized',()=>{
  expect(sanitizeStylesheet('@import "x"; p{color:red}')).toBe('');
  expect(sanitizeStylesheet('p:hover{color:red}')).toBe('');
  expect(sanitizeStylesheet('p{color:red;background:url(https://x)}')).toBe('p{color:red}');
  expect(sanitizeStylesheet('a[href^="x"]{color:red}')).toBe('');
  expect(sanitizeStylesheet('x'.repeat(16385))).toBe('');
  expect(sanitizeStylesheet('p{position:fixed}')).toBe('');
  const rules=Array.from({length:101},(_,i)=>`.r${i}{color:red}`).join(' ');
  expect(sanitizeStylesheet(rules).split('\n').length).toBe(100);
 });
});
describe('widget shell and worker assets',()=>{
 it('pins the fixed base stylesheet without external references',()=>{
  expect(WIDGET_BASE_CSS).toContain('task-stack');
  expect(WIDGET_BASE_CSS).not.toMatch(/url\(|@import|http:/);
 });
 it('declares the fixed worker path and a locked-down worker CSP',()=>{
  expect(WIDGET_WORKER_PATH).toBe('/widget-runtime/worker.js');
  expect(WIDGET_WORKER_CSP).toContain("default-src 'none'");
  expect(WIDGET_WORKER_CSP).toContain("connect-src 'none'");
 });
 it('embeds the hashed trusted bootstrap and escapes artifact ids',()=>{
  expect(WIDGET_SHELL_CSP).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+' 'unsafe-eval'/);
  expect(WIDGET_SHELL_CSP).toContain('worker-src data:');
  const html=widgetShellDocument('art"><img>');
  expect(html).toContain('data-artifact-id="art&quot;&gt;&lt;img&gt;"');
  expect(html).toContain('id="harness-root"');
  expect(html).not.toContain('</style><img>');
 });
});
