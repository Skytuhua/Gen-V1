import {afterEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify from 'fastify';
import {trustedDesktopSubframe} from '../apps/desktop/window-policy.ts';
import {registerPluginRoutes} from '../apps/server/plugin-routes.ts';
import type {PluginManifest} from '../packages/plugins/contracts.ts';
import {installPluginPackage,loadInstalledPlugins,removePlugin,type PluginRegistry} from '../packages/plugins/host.ts';

const origin='http://127.0.0.1:4317',widget='http://localhost:4318';
const frame='/plugins/sample-plugin/frame?session=session-123&theme=dark&workspace=overview&view=overview-map';
const manifest:PluginManifest={id:'sample-plugin',name:'Sample',version:'1.0.0',apiVersion:1,compatibleGenVersions:'^0.6.5',frontendEntry:'frontend/index.html',hostEntry:'host/main.mjs',workspaces:[{id:'overview',title:'Overview',entryView:'overview-map'}]};
const apps:ReturnType<typeof Fastify>[]=[];
const registries:PluginRegistry[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));await Promise.all(registries.splice(0).map(registry=>registry.close()));});

async function installedWorkspace(){
  const directory=await mkdtemp(join(tmpdir(),'gen-workspace-navigation-')),source=join(directory,'source'),root=join(directory,'plugins');
  await mkdir(join(source,'frontend'),{recursive:true});await mkdir(join(source,'host'));
  const files={'plugin.json':JSON.stringify(manifest),'frontend/index.html':'<html><head></head><body>Installed workspace</body></html>','host/main.mjs':'export default {activate(){return {operations:{},close:async()=>{}}}};'};
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  for(const [path,bytes]of Object.entries(files))await writeFile(join(source,path),bytes);
  const inventory=JSON.stringify({version:1,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)}))});
  await writeFile(join(source,'plugin-files.json'),inventory);await installPluginPackage(source,root,hash(inventory),'0.6.5');
  const registry=await loadInstalledPlugins(root,'0.6.5');registries.push(registry);
  const app=Fastify();apps.push(app);registerPluginRoutes(app,registry,origin);
  return {app,root};
}

describe('native installed workspace navigation',()=>{
  it.each([
    '/plugins/sample-plugin/frame?session=session-123&theme=dark&workspace=overview&view=overview-map',
    '/plugins/sample-plugin/frame?session=fresh-session&theme=light&workspace=visuals&view=diagram',
    '/plugins/sample-plugin/frame?session=session-123&theme=dark&workspace=project%3Aoverview&view=map%3Av2',
  ])('admits the canonical workspace/view URL without dropping its owner: %s',path=>{
    expect(trustedDesktopSubframe(origin+path,origin,widget)).toBe(true);
  });

  it.each([
    'https://outside.invalid'+frame,
    'http://localhost:4317'+frame,
    'http://127.0.0.1:4318'+frame,
    'http://user@127.0.0.1:4317'+frame,
    origin+frame.replace('sample-plugin','%73ample-plugin'),
    origin+frame.replace('sample-plugin','sample-plugin%2fother'),
    origin+frame.replace('sample-plugin','sample-plugin%252fother'),
    origin+frame.replace('sample-plugin','constructor'),
    origin+frame.replace('/frame?','/frontend/index.html?'),
    origin+frame.replace('/frame?','/frame/?'),
    origin+frame.replace('/frame?','/%66rame?'),
    origin+frame.replace('/frame?','/../sample-plugin/frame?'),
    origin+frame.replace('/frame?','/%2e%2e/sample-plugin/frame?'),
    origin+frame.replace('/frame?','\\frame?'),
    origin+frame.replace('session-123',''),
    origin+frame.replace('session-123','bad%2Fsession'),
    origin+frame.replace('theme=dark','theme=invalid'),
    origin+frame.replace('&workspace=overview',''),
    origin+frame.replace('&view=overview-map',''),
    origin+frame.replace('workspace=overview','workspace='),
    origin+frame.replace('view=overview-map','view=../personal'),
    origin+frame.replace('view=overview-map','view=%2Fpersonal'),
    origin+frame.replace('view=overview-map','view=constructor'),
    origin+frame.replace('view=overview-map','view='+ 'a'.repeat(101)),
    origin+frame+'&session=other',
    origin+frame+'&workspace=other',
    origin+frame+'&view=other',
    origin+frame+'&installId=other',
    origin+frame+'&scopeId=project&surfaceId=plan',
    origin+frame+'&resourceId=order',
    origin+frame+'&url=https://outside.invalid/',
    origin+frame+'#replacement',
    origin+frame.replace('&workspace=overview&view=overview-map','&view=overview-map&workspace=overview'),
  ])('rejects a noncanonical or mixed-owner workspace URL: %s',raw=>{
    expect(trustedDesktopSubframe(raw,origin,widget)).toBe(false);
  });

  it.each(['/../sample-plugin/frame?','/%2e%2e/sample-plugin/frame?','\\frame?'])('rejects a normalized conversation path too: %s',path=>{
    const conversation=frame.replace('&workspace=overview&view=overview-map','');
    expect(trustedDesktopSubframe(origin+conversation.replace('/frame?',path),origin,widget)).toBe(false);
  });

  it('serves a declared workspace only while its owning plug-in remains installed',async()=>{
    const {app,root}=await installedWorkspace();
    expect(trustedDesktopSubframe(origin+frame,origin,widget)).toBe(true);
    const response=await app.inject(frame);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Installed workspace');
    expect(response.headers['content-security-policy']).toContain('sandbox allow-scripts');
    expect(response.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-src 'none'");
    for(const path of [frame.replace('overview-map','wrong-view'),frame.replace('workspace=overview','workspace=other'),frame+'&scopeId=project&surfaceId=plan']){
      expect((await app.inject(path)).statusCode,path).toBe(403);
    }
    expect((await app.inject(frame.replace('sample-plugin','other-plugin'))).statusCode).toBe(404);
    await removePlugin(root,manifest.id);
    const revoked=await app.inject(frame);
    expect(revoked.statusCode).toBe(503);expect(revoked.body).not.toContain('Installed workspace');
  });

  it.each(['version','digest'])('refuses workspace bytes after the active install %s changes',async key=>{
    const {app,root}=await installedWorkspace();
    const index=JSON.parse(await readFile(join(root,'active.json'),'utf8'));
    index.plugins[0][key]=key==='version'?'1.0.1':'0'.repeat(64);
    await writeFile(join(root,'active.json'),JSON.stringify(index));
    const response=await app.inject(frame);
    expect(response.statusCode).toBe(503);expect(response.body).not.toContain('Installed workspace');
  });
});
