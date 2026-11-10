import type {FastifyInstance} from 'fastify';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Service} from '../../packages/core/service.ts';
import {HarnessError} from '../../packages/contracts/index.ts';
import {integrationIdSchema} from '../../packages/contracts/integrations.ts';
import {workspaceHost,githubFor} from './workspace-host.ts';

const identifier=z.string().regex(/^[a-zA-Z0-9:_.-]{1,200}$/),record=z.record(z.string(),z.unknown());
const envelope=z.strictObject({id:identifier,type:z.string().min(1).max(100),payload:record,threadId:identifier.optional()});
const querySchema=z.strictObject({threadId:identifier.optional(),path:z.string().max(1024).optional()});
const pullQuerySchema=querySchema.extend({linked:z.literal('1').optional()});
interface LinkedPullRequest{projectId:string;threadId?:string;repo:string;item:{number:number;[key:string]:unknown};linkedAt?:string}
/** Registered beneath the existing host/origin/cookie/CSRF hooks. */
export function registerWorkspaceRoutes(app:FastifyInstance,service:Service){
 const host=workspaceHost(service),{projects,terminals}=host,github=githubFor(host);projects.workspace.migrateProjects();
 app.addHook('onClose',async()=>{await terminals.dispose();await projects.dispose();});
 app.get('/api/workspace',async()=>projects.workspace.read());
 app.post('/api/workspace/commands',async request=>{const input=envelope.parse(request.body);return input.type==='workspace.project.connect'?projects.connect(input):projects.workspace.command(input);});
 app.get('/api/projects/:projectId/context',async request=>{const{projectId}=z.object({projectId:identifier}).parse(request.params),{threadId}=querySchema.parse(request.query);return projects.context(projectId,threadId);});
 app.get('/api/projects/:projectId/git',async request=>{const{projectId}=z.object({projectId:identifier}).parse(request.params),{threadId}=querySchema.parse(request.query);return projects.gitStatus(projectId,threadId);});
 app.get('/api/projects/:projectId/files',async request=>{const{projectId}=z.object({projectId:identifier}).parse(request.params),{threadId,path}=querySchema.parse(request.query);return projects.files(projectId,threadId,path);});
 app.get('/api/projects/:projectId/file',async request=>{const{projectId}=z.object({projectId:identifier}).parse(request.params),{threadId,path}=querySchema.parse(request.query);return projects.file(projectId,threadId,z.string().min(1).parse(path));});
 app.get('/api/projects/:projectId/pull-requests',async request=>{
  const{projectId}=z.object({projectId:identifier}).parse(request.params),{threadId,linked}=pullQuerySchema.parse(request.query);if(!linked)return github.list(projectId,threadId);
  await projects.binding(projectId,threadId);const{repo}=await github.repo(projectId,threadId);
  const saved=service.store.all<LinkedPullRequest>('linkedPullRequest').filter(value=>value.projectId===projectId&&(value.threadId??null)===(threadId??null)&&value.repo===repo).sort((a,b)=>(a.linkedAt??'').localeCompare(b.linkedAt??''));
  return{repo,items:[...new Map(saved.map(value=>[value.item.number,value.item])).values()]};
 });
 app.get('/api/projects/:projectId/pull-requests/:number',async request=>{const{projectId,number}=z.object({projectId:identifier,number:z.coerce.number().int().positive()}).parse(request.params),{threadId}=querySchema.parse(request.query);return github.details(projectId,threadId,number);});
 app.post('/api/projects/:projectId/actions',async request=>{
  const{projectId}=z.object({projectId:identifier}).parse(request.params),input=envelope.parse(request.body),existing=service.store.receipt({...input,type:'project.'+input.type,payload:{...input.payload,projectId}});if(existing)return existing;
  const command={...input,type:'project.'+input.type,payload:{...input.payload,projectId}},p=input.payload,binding=await projects.binding(projectId,input.threadId);
  if(input.type==='refresh')return projects.context(projectId,input.threadId);
  if(input.type==='github-login')return github.login(projectId,input.threadId);
  if(input.type==='github-login-status')return github.auth.poll(z.string().uuid().parse(p.flowId));
  if(input.type==='create-pr')return github.create(projectId,input.threadId,p);
  if(input.type==='review-pr')return github.review(projectId,input.threadId,p);
  if(input.type==='link-pr'){const pullNumber=z.number().int().positive().parse(p.number),details=await github.details(projectId,input.threadId,pullNumber),key=JSON.stringify([projectId,input.threadId??null,details.repo,pullNumber]);return service.store.command(command,()=>{service.store.put('linkedPullRequest',key,input.threadId??null,{projectId,threadId:input.threadId,...details,linkedAt:new Date().toISOString()});return details;});}
  if(input.type==='add-script'){const script={id:randomUUID(),projectId,name:z.string().trim().min(1).max(100).parse(p.name),command:z.string().trim().min(1).max(8000).parse(p.command)};return service.store.command(command,()=>{service.store.put('projectScript',script.id,null,script);return script;});}
  if(input.type==='run-script'){const script=service.store.get<{projectId:string;command:string}>('projectScript',identifier.parse(p.scriptId));if(!script||script.projectId!==projectId)throw new HarnessError('NOT_FOUND','Project script is unavailable.');return terminals.open({projectId,threadId:input.threadId,command:script.command});}
  if(['stage','unstage','commit','branch'].includes(input.type)){
   const intent=service.store.get('workspaceAction',input.id);if(intent)throw new HarnessError('ACTION_UNCERTAIN','This action already started. Refresh Git status before trying a new action.');
   service.store.internal('project.action.started',input.threadId??null,()=>service.store.put('workspaceAction',input.id,input.threadId??null,{command,status:'started'}));
   const current=await projects.gitStatus(projectId,input.threadId);if(p.expectedHead!==undefined&&p.expectedHead!==current.head)throw new HarnessError('REVISION_CHANGED','The reviewed commit changed.');
   const result=await projects.gitAction(projectId,input.threadId,{type:input.type,revision:z.string().length(64).parse(p.revision),...(p.paths?{paths:z.array(z.string()).parse(p.paths)}:{}),...(p.message?{message:z.string().parse(p.message)}:{}),...(p.name?{name:z.string().parse(p.name)}:{})});return service.store.command(command,()=>{service.store.put('workspaceAction',input.id,input.threadId??null,{status:'succeeded'});return result;});
  }
  if(input.type==='open-editor'){const{spawn}=await import('node:child_process');if(process.platform!=='win32')throw new HarnessError('UNAVAILABLE','This editor launcher is available on Windows.');await new Promise<void>((accept,reject)=>{const child=spawn((process.env.SystemRoot??'C:/Windows')+'/explorer.exe',[binding.path],{windowsHide:true,stdio:'ignore'});child.once('spawn',()=>{child.unref();accept();});child.once('error',reject);});return{opened:true};}
  throw new HarnessError('INVALID_INPUT','Unknown project action.');
 });
 app.post('/api/terminals',async request=>terminals.open(z.strictObject({projectId:identifier,threadId:identifier.optional(),terminalId:identifier.optional(),cols:z.number().int().optional(),rows:z.number().int().optional()}).parse(request.body)));
 app.get('/api/terminals/:terminalId',async request=>{const{terminalId}=z.object({terminalId:identifier}).parse(request.params),p=z.strictObject({projectId:identifier,threadId:identifier.optional(),cursor:z.coerce.number().int().nonnegative().optional()}).parse(request.query);return terminals.read(terminalId,p.projectId,p.threadId,p.cursor);});
 app.post('/api/terminals/:terminalId/commands',async request=>{const{terminalId}=z.object({terminalId:identifier}).parse(request.params),p=z.strictObject({projectId:identifier,threadId:identifier.optional(),type:z.enum(['input','resize','stop']),data:z.string().optional(),cols:z.number().optional(),rows:z.number().optional()}).parse(request.body);return terminals.command(terminalId,p.projectId,p.threadId,p);});
 app.get('/api/integrations',async()=>({integrations:host.integrations?await host.integrations.inventory():[]}));
 app.post('/api/integrations/:integrationId/commands',async request=>{
  const{integrationId}=z.object({integrationId:integrationIdSchema}).parse(request.params),input=envelope.parse(request.body),p=input.payload,manager=host.integrations;
  if(!manager)throw new HarnessError('INTEGRATION_UNAVAILABLE','This host does not have bundled integrations configured.');
  const scope={authority:{kind:'local' as const},...(input.threadId?{threadId:input.threadId}:{}),...(typeof p.projectId==='string'?{projectId:p.projectId}:{})};
  if(input.type==='enable')return manager.enable(integrationId,scope);if(input.type==='disable')return manager.disable(integrationId,scope);if(input.type==='health')return manager.health(integrationId,scope);
  if(input.type==='configure'){if(integrationId==='context7'&&p.apiKey!==undefined){await host.context7Key?.(z.string().trim().max(4096).parse(p.apiKey));return manager.status(integrationId,scope);}return manager.configure(integrationId,p,scope);}
  return manager.command(integrationId,input.type,p,scope);
 });
}
