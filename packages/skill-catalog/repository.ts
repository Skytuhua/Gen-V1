import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {HarnessError} from '../contracts/index.ts';
import {skillCatalogQuerySchema,skillReferenceSchema,type SkillAvailability,type SkillCatalogEntry,type SkillCatalogPage,type SkillCatalogQuery,type SkillCatalogScope,type SkillCatalogSource,type SkillReference} from '../contracts/skill-catalog.ts';

export const catalogHash=(value:unknown)=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export interface CatalogFileCustody {path:string;bytes:number;digest:string;identity?:{dev:string;ino:string}}
export interface CatalogCustody {kind:'filesystem'|'harness';root?:string;path?:string;identity?:{dev:string;ino:string};files:CatalogFileCustody[];record?:{name:string;revision:number};binding:string}
export interface CatalogItem {entry:SkillCatalogEntry;custody?:CatalogCustody}
export interface CatalogInventory {sources:SkillCatalogSource[];items:CatalogItem[]}
/** Only the owning host may supply a capability provider; HTTP never accepts roots or provider IDs. */
export interface SkillCatalogCapabilityProvider {scope:SkillCatalogScope;read(context:SkillCatalogQuery):Promise<CatalogInventory>}
export const personalScope={kind:'personal'} as const;
export const unavailable=(reason:Extract<SkillAvailability,{status:'unavailable'}>['reason']):SkillAvailability=>({status:'unavailable',reason});
export function catalogItem(sourceId:string,locatorKey:string,metadata:{name:string;description:string},custody:CatalogCustody,availability:SkillAvailability={status:'available'}):CatalogItem{
 const locator=catalogHash(locatorKey),id=sourceId+':'+locator,digest=catalogHash(custody.files.map(({path,bytes,digest})=>({path,bytes,digest}))),sourceBinding=catalogHash(custody);
 const ref:SkillReference={version:1,scope:personalScope,sourceId,skillId:id,locator,digest,sourceBinding,revision:catalogHash({digest,sourceBinding,metadata,availability})};
 return{entry:{id,sourceId,...metadata,files:custody.files.length,availability,ref:availability.status==='available'?ref:null},custody};
}
export function deniedItem(sourceId:string,key:string,reason:Extract<SkillAvailability,{status:'unavailable'}>['reason']):CatalogItem{
 return{entry:{id:sourceId+':'+catalogHash(key),sourceId,name:key.split('/').at(-1)??key,description:'',files:0,availability:unavailable(reason),ref:null}};
}
const fail=(code:string,message:string):never=>{throw new HarnessError(code,message);};
export class SkillCatalogRepository {
 private readonly secret=randomBytes(32);
 constructor(private readonly providers:readonly SkillCatalogCapabilityProvider[],readonly scope:SkillCatalogScope=personalScope){}
 private async inventory(query:SkillCatalogQuery){
  const all:CatalogInventory={sources:[],items:[]};
  for(const provider of this.providers){if(JSON.stringify(provider.scope)!==JSON.stringify(this.scope))continue;const value=await provider.read(query);all.sources.push(...value.sources);all.items.push(...value.items);}
  if(all.sources.length>512||all.items.length>20000)fail('RESOURCE_LIMIT','The catalog exceeds its inventory limit.');
  if(new Set(all.sources.map(s=>s.id)).size!==all.sources.length||new Set(all.items.map(i=>i.entry.id)).size!==all.items.length)fail('INVALID_SKILL_CATALOG','Catalog identities must be unique.');
  all.sources.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);all.items.sort((a,b)=>a.entry.id<b.entry.id?-1:a.entry.id>b.entry.id?1:0);
  const revision=catalogHash({sources:all.sources,entries:all.items.map(i=>i.entry)});return{...all,revision};
 }
 async list(input:SkillCatalogQuery={}):Promise<SkillCatalogPage>{
  const query=skillCatalogQuerySchema.parse(input),{cursor,...options}=query,limit=query.limit??50,context=catalogHash({scope:this.scope,...options,limit});let offset=0,expected:string|undefined;
  if(cursor){
   const parts=cursor.split('.');if(parts.length!==2)fail('INVALID_CURSOR','Choose a current catalog page.');
   const mac=createHmac('sha256',this.secret).update(parts[0]).digest('base64url'),actual=Buffer.from(parts[1]),wanted=Buffer.from(mac);
   if(actual.length!==wanted.length||!timingSafeEqual(actual,wanted))fail('INVALID_CURSOR','Choose a current catalog page.');
   try{const value=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));if(value.context!==context||!Number.isSafeInteger(value.offset)||value.offset<1||typeof value.revision!=='string')throw Error();offset=value.offset;expected=value.revision;}catch{fail('INVALID_CURSOR','Choose a current catalog page.');}
  }
  const inventory=await this.inventory(query);if(expected&&expected!==inventory.revision)fail('SKILL_CATALOG_CHANGED','The catalog changed. Start again from its first page.');
  const terms=(query.query??'').toLowerCase().trim().split(/\s+/).filter(Boolean),sources=new Map(inventory.sources.map(s=>[s.id,s]));
  const entries=inventory.items.map(i=>i.entry).filter(entry=>terms.every(term=>`${entry.name} ${entry.description} ${sources.get(entry.sourceId)?.label??''}`.toLowerCase().includes(term)));
  if(offset>entries.length)fail('INVALID_CURSOR','Choose a current catalog page.');
  const skills:SkillCatalogEntry[]=[];let bytes=0;
  for(const entry of entries.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(entry));if(bytes+size>192*1024)break;skills.push(entry);bytes+=size;}
  const next=offset+skills.length;let nextCursor:string|null=null;
  if(next<entries.length){if(!skills.length)fail('RESOURCE_LIMIT','A catalog entry exceeds the response limit.');const payload=Buffer.from(JSON.stringify({context,offset:next,revision:inventory.revision})).toString('base64url');nextCursor=payload+'.'+createHmac('sha256',this.secret).update(payload).digest('base64url');}
  return{scope:this.scope,sources:inventory.sources,skills,inventoryRevision:inventory.revision,nextCursor};
 }
 /** Freshness/custody inspection only. SKSEND must independently admit and materialize on Send. */
 async checkReference(input:SkillReference,context:SkillCatalogQuery={}):Promise<CatalogCustody>{
  const ref=skillReferenceSchema.parse(input);if(JSON.stringify(ref.scope)!==JSON.stringify(this.scope))fail('CAPABILITY_DENIED','This catalog scope is unavailable.');
  const inventory=await this.inventory(skillCatalogQuerySchema.parse(context)),item=inventory.items.find(i=>i.entry.id===ref.skillId&&i.entry.sourceId===ref.sourceId);
  if(!item?.entry.ref||!item.custody||JSON.stringify(skillReferenceSchema.parse(item.entry.ref))!==JSON.stringify(ref))fail('SKILL_CATALOG_CHANGED','This skill changed or is unavailable. Select it again.');
  return structuredClone(item!.custody!);
 }
}
