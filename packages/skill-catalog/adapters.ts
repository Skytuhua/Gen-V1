import {lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import type {SkillSummary} from '../contracts/skills.ts';
import type {Thread} from '../contracts/index.ts';
import type {Store} from '../storage/store.ts';
import {readBoundFile,withPathGuard} from '../core/file-access.ts';
import {readManifest,payloadPath} from '../integrations/manifest.ts';
import {readPluginIndex,verifyPluginPackage} from '../plugins/installation.ts';
import {ProjectTools} from '../workspace/tools.ts';
import {catalogFailure,captureSkillPackage,directoryCatalog,unavailableInventory} from './filesystem.ts';
import {catalogHash,catalogItem,deniedItem,personalScope,unavailable,type CatalogCustody,type CatalogInventory,type CatalogItem,type SkillCatalogCapabilityProvider} from './repository.ts';
import {SkillCatalogRepository} from './repository.ts';

export function harnessCatalog(store:Store):SkillCatalogCapabilityProvider{
 return{scope:personalScope,async read(){
  const source={id:'harness:library',kind:'harness' as const,label:'Harness',availability:{status:'available' as const}},items:CatalogItem[]=[];
  for(const summary of store.all<SkillSummary>('skill')){
   const saved=store.get<{skill:SkillSummary&{content:string;files:Record<string,string>};document?:string}>('skillVersion',`${summary.name}@${summary.revision}`);
   if(!saved){items.push(deniedItem(source.id,summary.name,'missing'));continue;}
   const document=saved.document??`---\nname: ${JSON.stringify(saved.skill.name)}\ndescription: ${JSON.stringify(saved.skill.description)}\n---\n\n${saved.skill.content}`;
   const files=[{path:'SKILL.md',bytes:Buffer.byteLength(document),digest:catalogHash(document)},...Object.entries(saved.skill.files).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),digest:catalogHash(bytes)}))];
   const custody:CatalogCustody={kind:'harness',record:{name:summary.name,revision:summary.revision},binding:catalogHash({dataDir:store.dataDir,projection:store.get('hermesSkill',summary.name)}),files};
   items.push(catalogItem(source.id,summary.name,{name:summary.name,description:summary.description},custody,summary.enabled&&summary.state!=='archived'&&!summary.migrationError?{status:'available'}:unavailable('disabled')));
  }
  return{sources:[source],items};
 }};
}

export function bundledCatalog(root:string):SkillCatalogCapabilityProvider{
 return{scope:personalScope,async read(){
  const sources:CatalogInventory['sources']=[],items:CatalogItem[]=[];
  try{
   const manifestPath=join(root,'third-party','integrations','manifest.json');
   await withPathGuard([{path:manifestPath,leaf:true,readOnly:true}],new AbortController().signal,async()=>{
    const bytes=await readBoundFile(manifestPath,4*1024*1024),manifest=await readManifest(root);
    for(const integration of manifest.integrations){if(!integration.skills.length)continue;
     const id='bundled:'+integration.id;sources.push({id,kind:'bundled',label:integration.name,availability:{status:'available'}});
     for(const skill of integration.skills){
      try{
       const absolute=payloadPath(root,skill.path);if(!skill.path.endsWith('/SKILL.md'))throw Error();
       const folder=dirname(absolute),prefix=skill.path.slice(0,-8),expected=integration.files.filter(file=>file.path.startsWith(prefix));
       const item=await captureSkillPackage(id,skill.path,folder,catalogHash({manifest:catalogHash(bytes),pin:integration.upstream.pin,version:integration.version}));
       if(item.custody&&(expected.length!==item.custody.files.length||item.custody.files.some(file=>!expected.some(saved=>saved.path===prefix+file.path&&saved.bytes===file.bytes&&saved.sha256===file.digest))))items.push(deniedItem(id,skill.path,'changed'));
       else items.push(item);
      }catch(error){items.push(deniedItem(id,skill.path,catalogFailure(error)));}
     }
    }
   });
   return{sources,items};
  }catch(error){return unavailableInventory('bundled:registry','bundled','Bundled',catalogFailure(error));}
 }};
}

export function projectCatalog(store:Store):SkillCatalogCapabilityProvider{
 const projects=new ProjectTools(store);
 return{scope:personalScope,async read(context){
  let projectId=context.projectId;
  if(context.threadId){const thread=store.get<Thread>('thread',context.threadId);if(!thread||thread.kind==='delegate'||projectId&&thread.projectId!==projectId)return unavailableInventory('project:connection','project','Project','denied');projectId=thread.projectId;}
  if(!projectId)return unavailableInventory('project:connection','project','Project','disconnected');
  try{
   const before=await projects.binding(projectId,context.threadId),stamp=()=>catalogHash({project:store.get('workspaceProject',projectId!),root:store.get('workspaceProjectRoot',projectId!),thread:context.threadId?store.get<Thread>('thread',context.threadId):null,binding:before.workspace?store.get('workspaceBinding',before.workspace.id):null});
   const captured=stamp(),result:CatalogInventory={sources:[],items:[]};
   // Fixed skill roots only; never walk the whole project or accept a browser path.
   for(const suffix of ['.agents/skills','.codex/skills','.claude/skills']){
    const adapter=directoryCatalog({id:'project:'+catalogHash({projectId,workspaceId:before.workspace?.id??null,root:suffix}),kind:'project',label:before.project.name,root:join(before.path,...suffix.split('/')),binding:captured});
    const inventory=await adapter.read(context);result.sources.push(...inventory.sources);result.items.push(...inventory.items);
   }
   const after=await projects.binding(projectId,context.threadId);if(before.path!==after.path||captured!==stamp())return unavailableInventory('project:connection','project','Project','changed');return result;
  }catch(error){return unavailableInventory('project:connection','project','Project',catalogFailure(error));}
 }};
}

export function installedAppCatalog(options:{root?:string}):SkillCatalogCapabilityProvider{
 return{scope:personalScope,async read(){
  if(!options.root)return unavailableInventory('app:registry','app','Installed apps','unsupported');
  const root=resolve(options.root),result:CatalogInventory={sources:[{id:'app:registry',kind:'app',label:'Installed apps',availability:{status:'available'}}],items:[]};
  try{
   await lstat(join(root,'active.json'));
   // The existing installation index, never a cache directory, grants package membership.
   const index=await readPluginIndex(root);if(!index.length)return result;
   await withPathGuard([{path:join(root,'active.json'),leaf:true,readOnly:true}],new AbortController().signal,async()=>{
    if(catalogHash(index)!==catalogHash(await readPluginIndex(root)))throw Error();
    for(const record of index){
     const folder=join(root,record.id,record.version);
     await withPathGuard([{path:folder,leaf:false,tree:true,readOnly:true}],new AbortController().signal,async()=>{
      const verified=await verifyPluginPackage(folder,record.digest);if(verified.manifest.id!==record.id||verified.manifest.version!==record.version)throw Error();
      const skills=verified.manifest.skills??[];if(!skills.length)return;
      const id='app:'+record.id;result.sources.push({id,kind:'app',label:verified.manifest.name,availability:{status:'available'}});
      for(const skill of skills){
       const prefix=skill.entry.slice(0,-8),inventory=[...verified.files.keys()].filter(path=>path.startsWith(prefix));
       if(inventory.length!==skill.files.length||inventory.some(path=>!skill.files.includes(path))){result.items.push(deniedItem(id,skill.id,'invalid'));continue;}
       const item=await captureSkillPackage(id,skill.id,join(folder,...prefix.split('/').filter(Boolean)),catalogHash({record,root}));
       if(item.custody?.files.some(file=>catalogHash(verified.files.get(prefix+file.path))!==file.digest))result.items.push(deniedItem(id,skill.id,'changed'));else result.items.push(item);
      }
     });
    }
    if(catalogHash(index)!==catalogHash(await readPluginIndex(root)))throw Error();
   });
   return result;
  }catch(error){return unavailableInventory('app:registry','app','Installed apps',catalogFailure(error));}
 }};
}

export interface PersonalCatalogOptions {personalRoots?:{id:string;label:string;root:string}[];bundleRoot?:string;pluginRoot?:string}
export function createPersonalSkillCatalog(store:Store,options:PersonalCatalogOptions={}):SkillCatalogRepository{
 const roots=options.personalRoots??[{id:'personal:agents',label:'Personal · Agents',root:join(homedir(),'.agents','skills')},{id:'personal:codex',label:'Personal · Codex',root:join(homedir(),'.codex','skills')},{id:'personal:claude',label:'Personal · Claude',root:join(homedir(),'.claude','skills')}];
 const bundleRoot=options.bundleRoot??fileURLToPath(new URL('../../',import.meta.url));
 // The composition owner supplies the actual installation registry; a conventional cache path is not a connection.
 return new SkillCatalogRepository([harnessCatalog(store),bundledCatalog(bundleRoot),...roots.map(root=>directoryCatalog({...root,kind:'personal'})),projectCatalog(store),installedAppCatalog({root:options.pluginRoot})]);
}
