import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {Service} from '../../packages/core/service.ts';
import {HarnessError} from '../../packages/contracts/index.ts';
import {hookSchema,type Hook,type HooksView} from '../../packages/contracts/hooks.ts';
import {hookSettingsFor} from '../../packages/core/hook-settings.ts';
import {HookRunner} from '../../packages/core/hook-runner.ts';

/** Dedicated authenticated write path: hook commands never enter Store.command or plug-in RPC. */
export const HOOK_COVERAGE={covered:['Host tool calls (main and side conversations)','Planning child tool calls','Approved operation dispatch (op:*)'],notCovered:['Tools a model runtime executes natively (Hermes skill_tool/shared_skill_tool)','Trusted plug-in internal sub-effects','Pi built-in tools (bash, read, write, edit)']};
const runners=new WeakMap<Service,HookRunner>();
/** Shared per-service runner so Service integration (T06) and the Test button report the same lastRuns. */
export function hookRunnerFor(service:Service){let runner=runners.get(service);if(!runner){runner=new HookRunner(hookSettingsFor(service.store.dataDir));runners.set(service,runner);}return runner;}
const testInput=z.strictObject({id:hookSchema.shape.id.optional(),hook:hookSchema.omit({id:true}).extend({id:hookSchema.shape.id.optional()}).optional()});

export function registerHookRoutes(app:FastifyInstance,service:Service){
 const settings=hookSettingsFor(service.store.dataDir),runner=hookRunnerFor(service);
 app.get('/api/hooks',async(_request,reply)=>{reply.header('Cache-Control','no-store');const doc=await settings.read();const view:HooksView={revision:doc.revision,enabled:doc.enabled,hooks:doc.hooks.map(hook=>({...hook,lastRun:runner.lastRuns.get(hook.id)??null})),coverage:HOOK_COVERAGE};return view;});
 app.put('/api/hooks',{bodyLimit:64*1024},async(request,reply)=>{reply.header('Cache-Control','no-store');return settings.save(request.body);});
 app.delete('/api/hooks',{bodyLimit:2048},async(request,reply)=>{reply.header('Cache-Control','no-store');return settings.remove(request.body);});
 app.put('/api/hooks/enabled',{bodyLimit:2048},async(request,reply)=>{reply.header('Cache-Control','no-store');return settings.setEnabled(request.body);});
 app.post('/api/hooks/test',{bodyLimit:64*1024},async(request,reply)=>{
  reply.header('Cache-Control','no-store');
  const input=testInput.parse(request.body);
  let hook:Hook|undefined;
  if(input.hook)hook={...input.hook,id:input.hook.id??'hook_test00000000'};
  else if(input.id)hook=(await settings.read()).hooks.find(item=>item.id===input.id);
  if(!hook)throw new HarnessError('NOT_FOUND','The hook is unavailable.');
  const matchKey=hook.event==='PreToolUse'||hook.event==='PostToolUse'?'example_tool':null;
  const sample:Record<string,unknown>={hook_event_name:hook.event,session_id:'hook-test',thread_id:'hook-test',run_id:null,cwd:process.env.HOME??process.env.USERPROFILE??process.cwd(),project_dir:null,gen_version:process.env.GEN_VERSION??'dev',tool_name:matchKey??'example_tool',tool_use_id:'hook-test',tool_input:{sample:true},prompt:'Example prompt for hook testing.',attachments_count:0,final_state:'completed',aborted:false};
  return runner.run(hook,hook.event,matchKey,sample,new AbortController().signal);
 });
}
