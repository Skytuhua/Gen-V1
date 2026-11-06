import {lstat,opendir,realpath} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {HarnessError} from '../contracts/index.ts';
import type {SkillCatalogSource,SkillSourceKind} from '../contracts/skill-catalog.ts';
import {readBoundFile,withPathGuard} from '../core/file-access.ts';
import {inside} from '../core/security.ts';
import {catalogHash,catalogItem,deniedItem,personalScope,unavailable,type CatalogCustody,type CatalogFileCustody,type CatalogInventory,type CatalogItem,type SkillCatalogCapabilityProvider} from './repository.ts';

export const CATALOG_LIMITS={entries:8192,skills:2048,depth:12,files:512,fileBytes:4*1024*1024,packageBytes:16*1024*1024,rootBytes:64*1024*1024,metadataBytes:256*1024} as const;
type Limits={ [K in keyof typeof CATALOG_LIMITS]:number };
const invalid=()=>new HarnessError('INVALID_SKILL_CATALOG','Skill metadata is unavailable.');
const limit=()=>new HarnessError('RESOURCE_LIMIT','Skill discovery exceeds its bounded inventory.');
function scalar(value:string):string{
 const text=value.trim();if(!text||/^[!&*\[\]{}>|]/.test(text))throw invalid();
 if(text.startsWith('"')){try{const parsed:unknown=JSON.parse(text);if(typeof parsed!=='string')throw invalid();return parsed;}catch{throw invalid();}}
 if(text.startsWith("'")){if(!text.endsWith("'"))throw invalid();return text.slice(1,-1).replaceAll("''","'");}
 return text.replace(/\s+#.*$/,'');
}
/** Deliberately parse only display fields, never YAML tags, templates, hooks or instructions. */
export function parseSkillMetadata(document:string):{name:string;description:string}{
 const lines=document.replace(/^\uFEFF/,'').split(/\r?\n/);if(lines[0]!=='---')throw invalid();
 const end=lines.findIndex((line,index)=>index>0&&/^---\s*$/.test(line));if(end<0)throw invalid();
 const values=new Map<string,string>();
 for(let i=1;i<end;i++){
  const match=/^(name|description):\s*(.*)$/.exec(lines[i]);if(!match)continue;
  const [,key,raw]=match;if(values.has(key))throw invalid();let value=raw;
  if(/^[|>][+-]?$/.test(raw.trim())||!raw.trim()){
   const chunks:string[]=[];while(i+1<end&&(/^[ \t]+\S/.test(lines[i+1])||!lines[i+1].trim()))chunks.push(lines[++i].trim());
   if(raw.trim()&&!chunks.length)throw invalid();value=chunks.join(' ');
  }else {
   if((raw.startsWith('"')||raw.startsWith("'"))&&!raw.endsWith(raw[0])){
    const chunks=[raw];while(i+1<end&&(/^[ \t]+/.test(lines[i+1])||!lines[i+1].trim()))chunks.push(lines[++i].trim());value=chunks.join(' ');
   }
   value=scalar(value);
  }
  value=value.replace(/\s+/g,' ').trim();if(!value||/[\u0000-\u001f\u007f-\u009f]/.test(value)||value.length>(key==='name'?200:4096))throw invalid();values.set(key,value);
 }
 const name=values.get('name'),description=values.get('description');if(!name||!description)throw invalid();return{name,description};
}
export function catalogFailure(error:unknown):'limit'|'denied'|'invalid'|'disconnected'{
 if((error as NodeJS.ErrnoException).code==='ENOENT')return'disconnected';
 if(error instanceof HarnessError)return error.code==='RESOURCE_LIMIT'?'limit':error.code==='INVALID_SKILL_CATALOG'?'invalid':error.code==='PROJECT_NOT_CONNECTED'?'disconnected':'denied';
 return'denied';
}
interface FileStat {path:string;absolute:string;bytes:number;dev:string;ino:string}
const identity=async(path:string)=>{const info=await lstat(path,{bigint:true});if(info.isSymbolicLink()||!info.isDirectory())throw invalid();return{dev:String(info.dev),ino:String(info.ino)};};
async function ordinaryRoot(path:string){
 const root=resolve(path);if(process.platform==='win32'&&!/^[a-z]:[\\/]/i.test(root))throw invalid();
 if(await realpath(root)!==root)throw new HarnessError('CAPABILITY_DENIED','Redirected skill roots are unsupported.');
 return{root,identity:await identity(root)};
}
async function packageFiles(root:string,limits:Limits):Promise<FileStat[]>{
 const files:FileStat[]=[];let entries=0,bytes=0;
 async function walk(folder:string,depth:number):Promise<void>{
  if(depth>limits.depth)throw limit();const directory=await opendir(folder);
  for await(const item of directory){if(++entries>limits.entries)throw limit();const absolute=join(folder,item.name),info=await lstat(absolute,{bigint:true});
   if(info.isSymbolicLink()||(!info.isDirectory()&&!info.isFile())||info.isFile()&&info.nlink!==1n)throw new HarnessError('CAPABILITY_DENIED','Linked skill files are unsupported.');
   if(info.isDirectory())await walk(absolute,depth+1);
   else {const size=Number(info.size);bytes+=size;if(files.length>=limits.files||size>limits.fileBytes||bytes>limits.packageBytes)throw limit();files.push({path:relative(root,absolute).split(sep).join('/'),absolute,bytes:size,dev:String(info.dev),ino:String(info.ino)});}
  }
 }
 await walk(root,0);return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
interface CaptureBudget {bytes:number;files:number}
export async function captureSkillPackage(sourceId:string,key:string,path:string,binding:string,limits:Limits={...CATALOG_LIMITS},beforeCapture?:()=>Promise<void>,budget?:CaptureBudget):Promise<CatalogItem>{
 const consume=(bytes:number)=>{if(budget){budget.bytes-=bytes;budget.files--;if(budget.bytes<0||budget.files<0)throw limit();}};
 try{
  const original=await ordinaryRoot(path),before=await packageFiles(path,limits);if(!before.some(file=>file.path==='SKILL.md'))throw invalid();
  await beforeCapture?.();
  return await withPathGuard([{path:original.root,leaf:true,...original.identity},{path:original.root,leaf:false,tree:true,readOnly:true}],new AbortController().signal,async()=>{
   const after=await packageFiles(path,limits);if(catalogHash(before)!==catalogHash(after))throw new HarnessError('CAPABILITY_DENIED','The skill package changed during discovery.');
   const custody:CatalogFileCustody[]=[];let document='';
   for(const file of after){consume(file.bytes);const bytes=await readBoundFile(file.absolute,file.path==='SKILL.md'?Math.min(limits.metadataBytes,limits.fileBytes):limits.fileBytes,{dev:file.dev,ino:file.ino,size:file.bytes});if(bytes.length!==file.bytes)throw invalid();custody.push({path:file.path,bytes:bytes.length,digest:catalogHash(bytes),identity:{dev:file.dev,ino:file.ino}});if(file.path==='SKILL.md')document=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
   const result:CatalogCustody={kind:'filesystem',root:original.root,path:original.root,identity:original.identity,binding,files:custody};return catalogItem(sourceId,key,parseSkillMetadata(document),result);
  });
 }catch(error){
  const item=deniedItem(sourceId,key,catalogFailure(error));
  if(item.entry.availability.status==='unavailable'&&item.entry.availability.reason==='limit'){
   try{const entry=join(path,'SKILL.md');await withPathGuard([{path:entry,leaf:true,readOnly:true}],new AbortController().signal,async()=>{const info=await lstat(entry);if(info.size>limits.metadataBytes)throw limit();consume(info.size);Object.assign(item.entry,parseSkillMetadata(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundFile(entry,limits.metadataBytes))));});}catch{/* An unavailable package never receives a reference. */}
  }
  return item;
 }
}
export interface DirectoryCatalogOptions {id:string;kind:SkillSourceKind;label:string;root:string;binding?:string;limits?:Partial<Limits>;beforeCapture?:()=>Promise<void>}
export function directoryCatalog(options:DirectoryCatalogOptions):SkillCatalogCapabilityProvider{
 return{scope:personalScope,async read(){
  const source:SkillCatalogSource={id:options.id,kind:options.kind,label:options.label,availability:{status:'available'}},items:CatalogItem[]=[],limits={...CATALOG_LIMITS,...options.limits},budget={bytes:limits.rootBytes,files:limits.entries};let visited=0;
  try{
   const original=await ordinaryRoot(options.root);
   await withPathGuard([{path:original.root,leaf:true,...original.identity}],new AbortController().signal,async()=>{
    async function walk(folder:string,depth:number):Promise<void>{
     if(depth>limits.depth)throw limit();const directory=await opendir(folder),children:{name:string;directory:boolean;linked:boolean}[]=[];
     for await(const entry of directory){if(++visited>limits.entries)throw limit();children.push({name:entry.name,directory:entry.isDirectory(),linked:entry.isSymbolicLink()});}
     children.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
     const key=relative(original.root,folder).split(sep).join('/')||'.';
     if(children.some(entry=>entry.name==='SKILL.md')){
      if(items.length>=limits.skills)throw limit();const captured=await captureSkillPackage(options.id,key,folder,catalogHash({root:original.root,identity:original.identity,binding:options.binding??options.id}),limits,options.beforeCapture,budget);if(budget.bytes<0||budget.files<0)throw limit();items.push(captured);
     }
     for(const child of children){const path=join(folder,child.name);if(!inside(original.root,path))throw invalid();
      if(child.linked)items.push(deniedItem(options.id,relative(original.root,path).split(sep).join('/'),'denied'));
      else if(child.directory&&!['.git','node_modules','.venv','__pycache__'].includes(child.name)){
       try{const pinned=await ordinaryRoot(path);await withPathGuard([{path,leaf:true,...pinned.identity}],new AbortController().signal,()=>walk(path,depth+1));}
       catch(error){if(error instanceof HarnessError&&error.code==='RESOURCE_LIMIT')throw error;items.push(deniedItem(options.id,relative(original.root,path).split(sep).join('/'),catalogFailure(error)));}
      }
     }
    }
    await walk(original.root,0);
   });
  }catch(error){source.availability=unavailable(catalogFailure(error));return{sources:[source],items:[]};}
  return{sources:[source],items};
 }};
}
export function unavailableInventory(id:string,kind:SkillSourceKind,label:string,reason:Parameters<typeof unavailable>[0]):CatalogInventory{return{sources:[{id,kind,label,availability:unavailable(reason)}],items:[]};}
