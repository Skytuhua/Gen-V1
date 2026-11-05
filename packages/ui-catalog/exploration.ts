import {z} from 'zod';

const forbidden=new Set(['__proto__','prototype','constructor']);
const key=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value=>!forbidden.has(value));
const id=z.string().min(1).max(160).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_:.-]*$/).refine(value=>!forbidden.has(value));
const resourceId=z.string().min(1).max(200).refine(value=>!/[\u0000-\u0020/\\?#:]/.test(value)&&!['.','..'].includes(value),'Use a granted resource ID');
const title=z.string().trim().min(1).max(200),source=z.string().max(4000).optional();
const action={actionId:key.optional(),actionLabel:z.string().trim().min(1).max(200).optional()};
export const EXPLORATION_SCHEMAS={
 ImageAnnotator:z.strictObject({resourceId,alt:z.string().min(1).max(500),stateKey:key,title:title.optional(),...action}),
 SchedulePicker:z.strictObject({dataBinding:key,stateKey:key,...action}),
 LogExplorer:z.strictObject({dataBinding:key,stateKey:key,...action}),
};
const stamp=z.iso.datetime({offset:true}).max(60);
const timezone=z.string().min(1).max(120).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use an IANA timezone');
const unique=(items:{id:string}[])=>new Set(items.map(item=>item.id)).size===items.length;
const slot=z.strictObject({id,start:stamp,end:stamp,label:title.optional(),availability:z.enum(['available','unavailable','tentative']),detail:z.string().max(1000).optional()}).refine(value=>Date.parse(value.end)>Date.parse(value.start),'A slot must end after it starts');
export const EXPLORATION_DATA_SCHEMAS={
 SchedulePicker:z.strictObject({title:title.optional(),timeZone:timezone,slots:z.array(slot).max(64).refine(unique,'Slot identities must be unique'),source}),
 LogExplorer:z.strictObject({title:title.optional(),events:z.array(z.strictObject({id,timestamp:stamp.optional(),level:z.enum(['debug','info','warning','error','unknown']),message:z.string().max(2000),stream:z.string().max(160).optional(),detail:z.string().max(8000).optional(),correlationId:z.string().max(200).optional()})).max(500).refine(unique,'Event identities must be unique'),source}),
};
const annotation=z.strictObject({id,x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1),text:z.string().max(800)});
const annotationCheckpoint=z.strictObject({resourceId,sourceIdentity:z.string().regex(/^[a-f0-9]{64}$/).optional(),selectedId:z.string().max(160).nullable(),annotations:z.array(annotation).max(32).refine(unique)});
export const ANNOTATION_STATE_SCHEMA=annotationCheckpoint.extend({previous:annotationCheckpoint.optional()});
export type AnnotationState=z.infer<typeof ANNOTATION_STATE_SCHEMA>;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const dense=(value:unknown,maximum:number):value is unknown[]=>Array.isArray(value)&&value.length<=maximum&&Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
export function boundedExplorationData(kind:keyof typeof EXPLORATION_DATA_SCHEMAS,raw:unknown){return record(raw)&&dense(kind==='SchedulePicker'?raw.slots:raw.events,kind==='SchedulePicker'?64:500);}
export function readAnnotationState(raw:unknown,resource:string,sourceIdentity?:string):AnnotationState{
 const empty:AnnotationState={resourceId:resource,...(sourceIdentity?{sourceIdentity}:{}),selectedId:null,annotations:[]};
 if(!record(raw)||!dense(raw.annotations,32))return empty;
 if(raw.previous!==undefined&&(!record(raw.previous)||!dense(raw.previous.annotations,32)))return empty;
 const parsed=ANNOTATION_STATE_SCHEMA.safeParse(raw);if(!parsed.success)return empty;
 const current=parsed.data;
 if(current.resourceId===resource&&(sourceIdentity===undefined||current.sourceIdentity===sourceIdentity))return current;
 if(sourceIdentity===undefined)return empty;
 const {previous,...checkpoint}=current;
 if(previous?.resourceId===resource&&previous.sourceIdentity===sourceIdentity)return {...previous,previous:checkpoint};
 return {...empty,previous:checkpoint};
}
export const EXPLORATION_EXAMPLES={ImageAnnotator:{resourceId:'review-image',alt:'Screen under review',stateKey:'imageFeedback',actionId:'sendFeedback',actionLabel:'Send feedback'},SchedulePicker:{dataBinding:'windows',stateKey:'selectedWindow',actionId:'proposeWindow',actionLabel:'Propose this time'},LogExplorer:{dataBinding:'events',stateKey:'logView',actionId:'investigateEvent',actionLabel:'Investigate event'}};
export const EXPLORATION_DESCRIPTIONS={
 ImageAnnotator:'Numbered feedback pins on one granted image, never an external URL. stateKey saves {resourceId,sourceIdentity,selectedId,annotations:[{id,x:0..1,y:0..1,text}],previous?}. sourceIdentity is a host-grant metadata fingerprint, not a content hash. One previous source checkpoint is retained for recovery with at most32 pins and800 characters each. Click or use Add pin, then edit, move with arrows or delete. Resource replacement does not inherit another image’s feedback. Optional action submits {resourceId,annotations}; no image bytes are modified.',
 SchedulePicker:'Choose a supplied appointment, delivery or work window. Bind {title?,timeZone:IANA,slots:[{id,start:explicit-offsetISO,end:explicit-offsetISO,label?,availability:available|unavailable|tentative,detail?}],source?}, at most64 unique slots. Timezone and availability come from the supplied source; no availability is inferred from the current clock. stateKey saves {selectedId,visibleDate}. Unavailable/removed selections cannot submit. Optional action submits the current {slotId,start,end,timeZone}; this proposes a time and does not book a calendar.',
 LogExplorer:'Inspect up to500 supplied log events with local text/level filters, keyboard selection and optional details. Bind {title?,events:[{id,timestamp?:explicit-offsetISO,level:debug|info|warning|error|unknown,message,stream?,detail?,correlationId?}],source?}. Unknown time stays unavailable. stateKey saves {selectedId,query,levels,followTail}; manual scrolling stops following. Appended source data preserves selection and restored logs do not replay entrances. Optional action sends {eventId,correlationId?}; no process or terminal stream is started.',
};
export const EXPLORATION_PACK={version:'1.0.0',description:'Source-bound image feedback, scheduling proposals and log inspection. All local edits are drafts; actions never imply external execution.',dataSchemas:Object.fromEntries(Object.entries(EXPLORATION_DATA_SCHEMAS).map(([name,schema])=>[name,z.toJSONSchema(schema)]))};
export type ScheduleData=z.infer<typeof EXPLORATION_DATA_SCHEMAS.SchedulePicker>;
export type LogData=z.infer<typeof EXPLORATION_DATA_SCHEMAS.LogExplorer>;
