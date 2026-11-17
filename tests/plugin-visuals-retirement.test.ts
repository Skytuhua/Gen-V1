import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {installPluginPackage,loadInstalledPlugins,removePlugin} from '../packages/plugins/host.ts';

// T05/R12: retiring the Visuals contribution deactivates the installed plugin without
// deleting its package or private data, and an unrelated plugin still mounts.
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const visualsManifest=JSON.parse(await readFile('plugins/personal-visuals/plugin.json','utf8')) as Record<string,unknown>;
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function packageFixture(id:string,manifest:Record<string,unknown>){
 const directory=await mkdtemp(join(tmpdir(),'gen-plugin-retire-')),source=join(directory,'source'),root=join(directory,'plugins');
 await mkdir(source);await mkdir(join(source,'frontend'));await mkdir(join(source,'host'));
 const files:Record<string,string>={
  'plugin.json':JSON.stringify(manifest),
  'frontend/index.html':`<p>${id} records</p>`,
  'host/main.mjs':`export default {async activate(context){return {operations:{echo:async(input)=>({input}),write:async()=>{const {writeFile}=await import('node:fs/promises');await writeFile(context.dataDir+'/saved.txt','preserved-${id}');return null;}},close:async()=>{}};}};`,
 };
 for(const [path,bytes]of Object.entries(files))await writeFile(join(source,path),bytes);
 const inventory={version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))};
 const raw=JSON.stringify(inventory);await writeFile(join(source,'plugin-files.json'),raw);
 cleanups.push(async()=>{await rm(directory,{recursive:true,force:true,maxRetries:5});});
 return {source,root,digest:hash(raw)};
}
it('removing personal-visuals retains its package and private data while another plugin still mounts (T05/R12)',async()=>{
 const visuals=await packageFixture('personal-visuals',visualsManifest);
 const otherManifest={id:'example-company',name:'Example company',version:'1.0.0',apiVersion:1,compatibleGenVersions:'>=0.6.5 <0.7.0',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs'};
 const other=await packageFixture('example-company',otherManifest);
 // One shared installation root, as on the real host.
 const installedVisuals=await installPluginPackage(visuals.source,visuals.root,visuals.digest,'0.6.5');
 const installedOther=await installPluginPackage(other.source,visuals.root,other.digest,'0.6.5');
 const registry=await loadInstalledPlugins(visuals.root,'0.6.5');
 cleanups.push(async()=>{await registry.close();});
 expect(registry.list().map(entry=>entry.id).sort()).toEqual(['example-company','personal-visuals']);
 expect(registry.list().find(entry=>entry.id==='personal-visuals')?.workspaces).toEqual(visualsManifest.workspaces);
 await registry.dispatch('personal-visuals','write',null,new AbortController().signal);
 await removePlugin(visuals.root,'personal-visuals');
 expect(await readFile(join(visuals.root,'data','personal-visuals','saved.txt'),'utf8')).toBe('preserved-personal-visuals');
 expect(await readFile(join(installedVisuals.directory,'plugin.json'),'utf8')).toBe(JSON.stringify(visualsManifest));
 await expect(registry.dispatch('personal-visuals','echo',{},new AbortController().signal)).rejects.toThrow(/unavailable/i);
 const fresh=await loadInstalledPlugins(visuals.root,'0.6.5');
 cleanups.push(async()=>{await fresh.close();});
 expect(fresh.list().map(entry=>entry.id)).toEqual(['example-company']);
 expect(await fresh.dispatch('example-company','echo',{scope:'project'},new AbortController().signal)).toEqual({input:{scope:'project'}});
 expect(await readFile(join(installedOther.directory,'plugin.json'),'utf8')).toBe(JSON.stringify(otherManifest));
});
