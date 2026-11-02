import {z} from 'zod';

const key=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
const id=z.string().min(1).max(200).regex(/^[^\s\u0000-\u001f]+$/).refine(value=>!['__proto__','constructor','prototype'].includes(value));
const title=z.string().min(1).max(300),detail=z.string().max(2000).optional(),code=z.string().max(40000);
const source=z.string().max(2000).optional();
export const softwareCheckStatus=z.enum(['not-run','running','passed','failed','skipped','blocked','unknown']);
const props={dataBinding:key,stateKey:key,actionId:key.optional(),actionLabel:z.string().min(1).max(200).optional()};
export const SOFTWARE_SCHEMAS={Diagnostics:z.strictObject(props),ChangeSet:z.strictObject(props),ApiExplorer:z.strictObject(props),Pipeline:z.strictObject(props)};
export const SOFTWARE_EXAMPLES={
  Diagnostics:{dataBinding:'testEvidence',stateKey:'selectedDiagnostic',actionId:'investigate',actionLabel:'Investigate failure'},
  ChangeSet:{dataBinding:'changes',stateKey:'selectedFile',actionId:'reviewChange',actionLabel:'Review selected file'},
  ApiExplorer:{dataBinding:'apiContract',stateKey:'selectedEndpoint'},
  Pipeline:{dataBinding:'checks',stateKey:'selectedStage'},
};
const unique=(items:{id:string}[])=>new Set(items.map(item=>item.id)).size===items.length;
export const SOFTWARE_DATA_SCHEMAS={
  Diagnostics:z.strictObject({title:title.optional(),source,items:z.array(z.strictObject({id,title,status:softwareCheckStatus,file:z.string().max(1000).optional(),line:z.number().int().min(1).max(1000000).optional(),column:z.number().int().min(1).max(100000).optional(),message:z.string().max(8000).optional(),code:code.optional(),expected:code.optional(),actual:code.optional(),durationMs:z.number().finite().min(0).max(86400000).optional()})).max(100).refine(unique,'Diagnostic identities must be unique')}),
  ChangeSet:z.strictObject({title:title.optional(),source,files:z.array(z.strictObject({id,path:z.string().min(1).max(1000),status:z.enum(['added','modified','deleted','renamed','unchanged']),previousPath:z.string().max(1000).optional(),additions:z.number().int().min(0).max(1000000).optional(),deletions:z.number().int().min(0).max(1000000).optional(),patch:code,note:detail})).max(100).refine(unique,'File identities must be unique')}),
  ApiExplorer:z.strictObject({title:title.optional(),source,endpoints:z.array(z.strictObject({id,method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']),path:z.string().min(1).max(1000).regex(/^\//),summary:z.string().max(1000).optional(),parameters:z.array(z.strictObject({name:title,location:z.enum(['path','query','header','body']),type:z.string().min(1).max(200),required:z.boolean().optional(),description:detail})).max(40).optional(),request:code.optional(),responses:z.array(z.strictObject({status:z.number().int().min(100).max(599),body:code,description:detail})).max(8).optional()})).max(80).refine(unique,'Endpoint identities must be unique')}),
  Pipeline:z.strictObject({title:title.optional(),source,stages:z.array(z.strictObject({id,name:title,status:softwareCheckStatus,command:z.string().max(2000).optional(),durationMs:z.number().finite().min(0).max(86400000).optional(),dependsOn:z.array(id).max(20).optional(),log:code.optional(),detail})).max(40).refine(unique,'Stage identities must be unique')}).superRefine((data,context)=>{const ids=new Set(data.stages.map(stage=>stage.id));if(data.stages.some(stage=>stage.dependsOn?.some(dependency=>dependency===stage.id||!ids.has(dependency))))context.addIssue({code:'custom',message:'Stage dependencies must reference another listed stage'});}),
};
export type SoftwareComponentName=keyof typeof SOFTWARE_SCHEMAS;
export type SoftwareProps=z.infer<typeof SOFTWARE_SCHEMAS.Diagnostics>;
export type DiagnosticData=z.infer<typeof SOFTWARE_DATA_SCHEMAS.Diagnostics>;
export type ChangeSetData=z.infer<typeof SOFTWARE_DATA_SCHEMAS.ChangeSet>;
export type ApiData=z.infer<typeof SOFTWARE_DATA_SCHEMAS.ApiExplorer>;
export type PipelineData=z.infer<typeof SOFTWARE_DATA_SCHEMAS.Pipeline>;
export const SOFTWARE_DESCRIPTIONS={
  Diagnostics:'A source-bound test/diagnostic inspector. Bind {items:[{id,title,status,file?,line?,column?,message?,code?,expected?,actual?,durationMs?}],source?}; status is not-run|running|passed|failed|skipped|blocked|unknown. Up to100 unique items. Local selection preserves a stable diagnostic ID and reveals its actual error, source line and expected/actual values. Optional actionId routes the selected diagnostic through the existing durable broker; use native approval for test execution. No result is inferred from a click.',
  ChangeSet:'A source-bound multi-file change review. Bind {files:[{id,path,status,patch,additions?,deletions?,previousPath?,note?}],source?}; status is added|modified|deleted|renamed|unchanged and patch is the supplied unified diff. Up to100 files,40k characters per patch. Local file selection retains identity while updates arrive. Optional actionId submits the selected file for agent review or opens an exact prepared operation; this component does not write or stage files.',
  ApiExplorer:'A source-bound API contract explorer, not an HTTP client. Bind {endpoints:[{id,method,path,summary?,parameters?:[{name,location,type,required?,description?}],request?,responses?:[{status,body,description?}]}],source?}. Up to80 endpoints. Local selection reveals parameters and request/response examples from the contract. Optional actionId asks the agent to review that endpoint through the existing broker. Network requests require a separately configured capability and are never sent here.',
  Pipeline:'A source-bound build/release check inspector. Bind {stages:[{id,name,status,command?,durationMs?,dependsOn?,log?,detail?}],source?}, with status not-run|running|passed|failed|skipped|blocked|unknown. Up to40 unique stages; dependencies reference listed stage IDs. Select a stage locally to inspect its command and log. Optional actionId returns the selected stage through the existing broker. Only actual supplied evidence changes status; absent build/release executors stay unavailable.',
};
export const SOFTWARE_DISCOVERY={
  id:'software-development',title:'Software development',execution:'No new executor, shell recipe, network client or permission is added. Existing named test and file-change operations still require exact native approval.',
  workflows:[
    {id:'debugging-tests',title:'Debugging and test failures',components:['Diagnostics','ChangeSet','Code','Status','Disclosure'],tools:['repository_files','repository_read','repository_diff','repository_test_prepare','file_replace_prepare'],guidance:'Start with actual failures and source evidence. Preserve the selected failure while diagnosis, a proposed patch and approved verification update the same artifact. Put long logs behind inspection. A completed operation or launched process is not a passing test: derive passed/failed from actual exit codes and assertion output, and retain unknown when evidence is missing.'},
    {id:'architecture-api',title:'Architecture and API exploration',components:['RelationshipGraph','ApiExplorer','Tree','Code','Disclosure'],tools:['repository_files','repository_read','knowledge_publish'],guidance:'Derive modules, dependencies and contracts from granted files. Use a graph and endpoint inspector when they help exploration; keep source explanations inspectable. API examples are contract examples, not executed requests.'},
    {id:'build-release',title:'Build, release and dependency work',components:['Pipeline','ChangeSet','RelationshipGraph','Table','Disclosure'],tools:['repository_read','repository_status','repository_diff','repository_log','knowledge_publish'],guidance:'Inspect supplied CI logs, manifests and lockfiles. Distinguish not-run, blocked, failed and passed stages. Connect dependency/impact views to evidence. Offer exact native approval only for supported operations; build, install, deployment and external release execution require configured executors and must remain visibly unavailable otherwise.'},
  ],
};
