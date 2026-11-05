/** Explicit maintainer preparation only. Runtime code never downloads or installs. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type IntegrationDefinition,type IntegrationFile,type IntegrationManifest,payloadPath,sha256} from '../packages/integrations/manifest.ts';

const sources=[
 {id:'humanizer',name:'Humanizer',version:'3.1.0',repo:'blader/humanizer',pin:'225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8',license:['MIT']},
 {id:'emil',name:'Emil',version:'a81dbca',repo:'emilkowalski/skills',pin:'a81dbca07f2217b7103e510c0f13f8d5b017afc9',license:['MIT']},
 {id:'impeccable',name:'Impeccable',version:'4.8.0 / engine 0.1.18',repo:'pbakaus/impeccable',pin:'414603bf14c7a344edb466bb1f85690c77ce8b7d',license:['Apache-2.0']},
 {id:'graphify',name:'Graphify',version:'0.9.100',repo:'Graphify-Labs/graphify',pin:'f5155badddaa3286c78a51653791131e9e2e4d29',license:['Apache-2.0','MIT']},
 {id:'superpowers',name:'Superpowers',version:'7.0.1',repo:'obra/superpowers',pin:'2ce8aa15d05bd57213e6f746f953aafb7ded7a8b',license:['MIT']},
 {id:'ponytail',name:'Ponytail',version:'5.3.3',repo:'DietrichGebert/ponytail',pin:'7801d061243d7b753bad0e0b3c057cd250b11755',license:['MIT']},
] as const;
type TreeFile={path:string;type:string;size?:number;sha:string};
const headers={'User-Agent':'Gen-V1-bundled-integrations','Accept':'application/vnd.github+json'};
async function fetchBytes(url:string){const response=await fetch(url,{headers:url.startsWith('https://api.github.com/')?headers:{'User-Agent':headers['User-Agent']},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Upstream payload unavailable: '+response.status+' '+url);const data=Buffer.from(await response.arrayBuffer());if(data.length>64*1024*1024)throw Error('Upstream asset exceeds bounded size');return data;}
function selected(id:string,path:string){
 if(/^(LICENSE(?:-MIT)?|NOTICE|README\.md)$/.test(path))return true;
 if(id==='humanizer')return path==='SKILL.md'||path.startsWith('scripts/')||path.startsWith('agents/');
 if(id==='emil'||id==='ponytail'||id==='superpowers')return path.startsWith('skills/')||(id==='ponytail'&&['__init__.py','plugin.yaml'].includes(path))||(id==='superpowers'&&path.startsWith('.hermes-plugin/'));
 if(id==='impeccable')return path.startsWith('.hermes/skills/impeccable/');
 if(id==='graphify')return path==='graphify/skill-claw.md'||path.startsWith('graphify/skills/claw/references/');
 return false;
}
function destination(id:string,path:string){
 const base='third-party/integrations/'+id+'/';
 if(id==='humanizer'&&path==='SKILL.md')return base+'skills/humanizer/SKILL.md';
 if(id==='humanizer'&&(path.startsWith('scripts/')||path.startsWith('agents/')))return base+'skills/humanizer/'+path;
 if(id==='impeccable'&&path.startsWith('.hermes/skills/'))return base+path.slice('.hermes/'.length);
 if(id==='graphify'&&path==='graphify/skill-claw.md')return base+'skills/graphify/SKILL.md';
 if(id==='graphify'&&path.startsWith('graphify/skills/claw/'))return base+'skills/graphify/'+path.slice('graphify/skills/claw/'.length);
 return base+path;
}
function frontmatter(text:string,key:string){const front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]??'';return new RegExp('^'+key+':\\s*(.+)$','m').exec(front)?.[1]?.replace(/^['"]|['"]$/g,'')??'';}
export async function vendorIntegrations(root:string){
 root=resolve(root);let total=0;const definitions:IntegrationDefinition[]=[];
 const save=async(path:string,data:Buffer,source:string,gitBlob?:string,expected?:string):Promise<IntegrationFile>=>{
  total+=data.length;if(total>256*1024*1024)throw Error('Curated integration source exceeds 256MiB budget');const hash=sha256(data);
  if(expected&&hash!==expected)throw Error('Pinned upstream asset checksum mismatch');
  if(gitBlob&&createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')!==gitBlob)throw Error('Upstream Git blob checksum mismatch');
  const target=payloadPath(root,path);await mkdir(dirname(target),{recursive:true});
  try{const existing=await readFile(target);if(!existing.equals(data))throw Error('Refusing to replace existing differing integration asset: '+path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;await writeFile(target,data,{flag:'wx'});}
  return {path,bytes:data.length,sha256:hash,source,...(gitBlob?{gitBlob}: {})};
 };
 for(const source of sources){
  const tree=JSON.parse((await fetchBytes(`https://api.github.com/repos/${source.repo}/git/trees/${source.pin}?recursive=1`)).toString()) as {truncated:boolean;tree:TreeFile[]};if(tree.truncated)throw Error('Upstream tree was truncated');
  const item:IntegrationDefinition={id:source.id,name:source.name,version:source.version,license:[...source.license],upstream:{repository:'https://github.com/'+source.repo,pin:source.pin},files:[],skills:[],capabilities:{skills:[],mcp:source.id==='graphify',hooks:source.id==='impeccable'?['transform_tool_result','pre_verify']:['superpowers','ponytail'].includes(source.id)?['pre_llm_call']:[],commands:[]}};
  const files=tree.tree.filter(file=>file.type==='blob'&&selected(source.id,file.path));
  // Four concurrent bounded raw-blob requests; no archives, histories or duplicate trees.
  for(let offset=0;offset<files.length;offset+=4){const batch=await Promise.all(files.slice(offset,offset+4).map(async file=>{const url=`https://raw.githubusercontent.com/${source.repo}/${source.pin}/${file.path}`;const data=await fetchBytes(url);return save(destination(source.id,file.path),data,url,file.sha);}));item.files.push(...batch);}
  if(source.id==='impeccable'){
   const pin='e89e3ada3e875a89ac2c5d33d11e65ebef6fe285';item.additionalSources=[{repository:'https://github.com/pbakaus/impeccable',pin}];
   for(const name of ['__init__.py','plugin.yaml']){const url=`https://raw.githubusercontent.com/pbakaus/impeccable/${pin}/.hermes/plugins/impeccable-design-hook/${name}`;item.files.push(await save(`third-party/integrations/impeccable/hook/${name}`,await fetchBytes(url),url));}
   const url='https://github.com/pbakaus/impeccable/releases/download/engine-v0.1.18/impeccable-windows-x64.exe';item.files.push(await save('third-party/integrations/impeccable/engine/impeccable.exe',await fetchBytes(url),url,undefined,'8f61e96b0c97001546a824d79b44f46b423b560f3eb1a0cc44a8695a1b395d9f'));
  }
  for(const file of item.files.filter(file=>file.path.endsWith('/SKILL.md'))){const body=(await readFile(payloadPath(root,file.path))).toString();const name=frontmatter(body,'name')||file.path.split('/').at(-2)!;item.skills.push({name,path:file.path,description:frontmatter(body,'description')});}
  item.capabilities.skills=item.skills.map(skill=>source.id+':'+skill.name);item.capabilities.commands=item.skills.map(skill=>skill.name);if(source.id==='graphify')item.runtime={kind:'python',entry:'graphify-mcp',args:[],version:'0.9.100'};
  definitions.push(item);
 }
 const nodePackages=[{id:'promptfoo',name:'Promptfoo',pkg:'promptfoo',version:'0.125.1',repo:'promptfoo/promptfoo',entry:'dist/src/entrypoint.js',args:['mcp','--transport','stdio'],license:['MIT']},{id:'biome',name:'Biome',pkg:'@biomejs/biome',version:'2.6.4',repo:'biomejs/biome',entry:'bin/biome',args:[],license:['MIT','Apache-2.0']},{id:'context7',name:'Context7',pkg:'@upstash/context7-mcp',version:'4.4.4',repo:'upstash/context7',entry:'dist/index.js',args:['--transport','stdio'],license:['MIT']}] as const;
 for(const source of nodePackages){const metadata=JSON.parse((await fetchBytes('https://registry.npmjs.org/'+source.pkg.replace('/','%2f')+'/'+source.version)).toString()) as {dist:{integrity:string;tarball:string};gitHead?:string};
  const record=Buffer.from(JSON.stringify({name:source.pkg,version:source.version,...metadata.dist},null,2)+'\n');const custody=await save(`third-party/integrations/${source.id}/NPM_DISTRIBUTION.json`,record,'https://registry.npmjs.org/'+source.pkg+'/'+source.version);
  const licenseUrl=`https://raw.githubusercontent.com/${source.repo}/${source.id==='context7'?'7836c583918374fbecffacf866afb7594b919466':metadata.gitHead??(source.id==='biome'?'cli/v2.6.4':'0.125.1')}/LICENSE${source.id==='biome'?'-MIT':''}`;
  const license=await save(`third-party/integrations/${source.id}/LICENSE`,await fetchBytes(licenseUrl),licenseUrl);
  definitions.push({id:source.id,name:source.name,version:source.version,license:[...source.license],upstream:{repository:'https://github.com/'+source.repo,pin:source.id==='context7'?'7836c583918374fbecffacf866afb7594b919466':metadata.gitHead??source.version},files:[custody,license],skills:[],capabilities:{skills:[],mcp:source.id!=='biome',hooks:[],commands:source.id==='biome'?['check','format','lint','ci']:source.id==='promptfoo'?['evaluate']:[]},runtime:{kind:'node',entry:`node_modules/${source.pkg}/${source.entry}`,args:[...source.args],package:source.pkg,version:source.version}});
 }
 const pin='4572a67fe0e72a6837e2d7bb0fda875bc41482e5',licenseUrl=`https://raw.githubusercontent.com/github/spec-kit/${pin}/LICENSE`;
 definitions.push({id:'spec-kit',name:'Spec Kit',version:'1.2.5',license:['MIT'],upstream:{repository:'https://github.com/github/spec-kit',pin},files:[await save('third-party/integrations/spec-kit/LICENSE',await fetchBytes(licenseUrl),licenseUrl)],skills:[],capabilities:{skills:[],mcp:true,hooks:[],commands:['init','workflow']},runtime:{kind:'python',entry:'specify',args:['mcp'],version:'1.2.5'}});
 definitions.sort((a,b)=>a.id.localeCompare(b.id));const manifest:IntegrationManifest={version:1,createdAt:new Date().toISOString(),integrations:definitions,bytes:total};
 await mkdir(resolve(root,'third-party/integrations'),{recursive:true});await writeFile(resolve(root,'third-party/integrations/manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const manifest=await vendorIntegrations(resolve('.'));console.log(JSON.stringify({integrations:manifest.integrations.length,files:manifest.integrations.reduce((sum,item)=>sum+item.files.length,0),bytes:manifest.bytes}));}
