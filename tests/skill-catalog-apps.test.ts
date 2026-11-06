import {afterEach,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,realpath,lstat,rm,link} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {SkillCatalogRepository} from '../packages/skill-catalog/repository.ts';
import {installedAppCatalog} from '../packages/skill-catalog/adapters.ts';
import {pluginManifestSchema} from '../packages/plugins/contracts.ts';
const hash=(bytes:string)=>createHash('sha256').update(bytes).digest('hex');
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const base=await realpath(tmpdir()),root=await mkdtemp(join(base,'gen-skcat-apps-')),registry=join(root,'registry'),folder=join(registry,'example','1.0.0');
 const manifest={id:'example',name:'Example app',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.0',frontendEntry:'frontend/index.html',hostEntry:'host/index.mjs',skills:[{id:'procedure',scope:'personal',entry:'skills/procedure/SKILL.md',files:['skills/procedure/SKILL.md','skills/procedure/support.bin']}]};
 const files:Record<string,string>={'plugin.json':JSON.stringify(manifest),'frontend/index.html':'<html></html>','host/index.mjs':"throw Error('HOST MUST NEVER ACTIVATE');",'skills/procedure/SKILL.md':'---\nname: App procedure\ndescription: Installed metadata\n---\nPRIVATE-BODY','skills/procedure/support.bin':'binary-support'};
 for(const [path,bytes]of Object.entries(files)){await mkdir(dirname(join(folder,path)),{recursive:true});await writeFile(join(folder,path),bytes);}
 const inventory=JSON.stringify({version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))});await writeFile(join(folder,'plugin-files.json'),inventory);await writeFile(join(registry,'active.json'),JSON.stringify({version:1,plugins:[{id:'example',version:'1.0.0',digest:hash(inventory)}]}));
 cleanups.push(async()=>{if(await realpath(root)!==resolve(root)||!root.startsWith(base+sep)||(await lstat(root)).isSymbolicLink())throw Error('Unsafe app fixture cleanup');await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return{root,registry,folder,manifest,repo:new SkillCatalogRepository([installedAppCatalog({root:registry})])};
}
it('discovers only declared installed metadata with verified package custody and never activates the host',async()=>{
 const f=await fixture(),page=await f.repo.list();expect(page.skills).toHaveLength(1);expect(page.skills[0]).toMatchObject({sourceId:'app:example',name:'App procedure',files:2,availability:{status:'available'}});expect(JSON.stringify(page)).not.toMatch(/PRIVATE-BODY|HOST MUST|gen-skcat-apps/);
 expect((await f.repo.checkReference(page.skills[0].ref!)).files).toHaveLength(2);
});
it('invalidates installed references after content tampering, registry revocation, or untracked additions',async()=>{
 const f=await fixture(),first=(await f.repo.list()).skills[0];await writeFile(join(f.folder,'skills/procedure/support.bin'),'changed');
 expect((await f.repo.list()).skills).toEqual([]);await expect(f.repo.checkReference(first.ref!)).rejects.toMatchObject({code:'SKILL_CATALOG_CHANGED'});
 await writeFile(join(f.registry,'active.json'),JSON.stringify({version:1,plugins:[]}));expect((await f.repo.list()).skills).toEqual([]);
});
it('rejects package and registry hardlinks instead of accepting an installation based on file location',async()=>{
 const f=await fixture();await link(join(f.registry,'active.json'),join(f.root,'index-copy'));expect((await f.repo.list()).sources[0].availability.status).toBe('unavailable');
});
it('admits only declarative Personal manifest paths and rejects incomplete, duplicate or escaping file declarations',async()=>{
 const f=await fixture();expect(pluginManifestSchema.safeParse(f.manifest).success).toBe(true);
 for(const skill of [{...f.manifest.skills[0],scope:'company'},{...f.manifest.skills[0],entry:'../SKILL.md'},{...f.manifest.skills[0],files:['skills/procedure/support.bin']},{...f.manifest.skills[0],files:['skills/procedure/SKILL.md','skills/procedure/SKILL.md']},{...f.manifest.skills[0],files:['skills/procedure/SKILL.md','host/index.mjs']}])expect(pluginManifestSchema.safeParse({...f.manifest,skills:[skill]}).success).toBe(false);
});
