import {z} from 'zod';

const forbidden=new Set(['__proto__','prototype','constructor']);
const key=z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_-]{0,127}$/).refine(value=>!forbidden.has(value));
const id=z.string().min(1).max(160).regex(/^[a-zA-Z0-9_][a-zA-Z0-9_:.-]*$/).refine(value=>!forbidden.has(value));
const label=z.string().trim().min(1).max(200);
const revision=z.string().trim().min(1).max(160);
const source=z.string().max(4000).optional();
const props=z.strictObject({dataBinding:key,stateKey:key,actionId:key.optional(),actionLabel:label.optional()});
export const WORK_OBJECT_SCHEMAS={WorkflowBoard:props,ArchitectureCanvas:props,TraceWaterfall:props};
const unique=(items:{id:string}[])=>new Set(items.map(item=>item.id)).size===items.length;
const lane=z.strictObject({id,label,detail:z.string().max(1000).optional()});
const card=z.strictObject({id,laneId:id,title:label,detail:z.string().max(4000).optional(),tag:z.string().max(80).optional(),owner:z.string().max(120).optional()});
const node=z.strictObject({id,layerId:id,label,kind:z.enum(['client','service','store','queue']),detail:z.string().max(4000).optional(),facts:z.array(z.strictObject({label,value:z.string().max(1000)})).max(12).optional()});
const edge=z.strictObject({from:id,to:id,label:z.string().max(200).optional()});
const span=z.strictObject({id,parentId:id.optional(),name:label,service:z.string().max(160).optional(),status:z.enum(['ok','error','unknown']),startMs:z.number().finite().min(0).max(86_400_000).optional(),durationMs:z.number().finite().min(0).max(86_400_000).optional(),detail:z.string().max(8000).optional()});
export const WORK_OBJECT_DATA_SCHEMAS={
 WorkflowBoard:z.strictObject({revision,title:label.optional(),lanes:z.array(lane).min(1).max(6).refine(unique,'Lane identities must be unique'),cards:z.array(card).max(100).refine(unique,'Card identities must be unique'),source}).refine(data=>data.cards.every(card=>data.lanes.some(lane=>lane.id===card.laneId)),'Every card must reference a supplied lane'),
 ArchitectureCanvas:z.strictObject({revision,title:label.optional(),layers:z.array(z.strictObject({id,label})).min(1).max(6).refine(unique,'Layer identities must be unique'),nodes:z.array(node).max(60).refine(unique,'Node identities must be unique'),edges:z.array(edge).max(120),source}).refine(data=>data.nodes.every(node=>data.layers.some(layer=>layer.id===node.layerId))&&data.edges.every(edge=>edge.from!==edge.to&&data.nodes.some(node=>node.id===edge.from)&&data.nodes.some(node=>node.id===edge.to))&&new Set(data.edges.map(edge=>JSON.stringify([edge.from,edge.to]))).size===data.edges.length,'Use supplied layers and unique directed edges between supplied nodes'),
 TraceWaterfall:z.strictObject({revision,title:label.optional(),spans:z.array(span).max(200).refine(unique,'Span identities must be unique'),source}).refine(data=>{
  const byId=new Map(data.spans.map(span=>[span.id,span]));
  return data.spans.every(span=>{const seen=new Set([span.id]);let parent=span.parentId;while(parent){if(seen.has(parent)||!byId.has(parent))return false;seen.add(parent);parent=byId.get(parent)?.parentId;}return span.startMs===undefined||span.durationMs===undefined||span.startMs+span.durationMs<=86_400_000;});
 },'Spans must form a finite supplied hierarchy with bounded timing'),
};
export type WorkflowData=z.infer<typeof WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard>;
export type ArchitectureData=z.infer<typeof WORK_OBJECT_DATA_SCHEMAS.ArchitectureCanvas>;
export type TraceData=z.infer<typeof WORK_OBJECT_DATA_SCHEMAS.TraceWaterfall>;
type Kind=keyof typeof WORK_OBJECT_DATA_SCHEMAS;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const dense=(value:unknown,maximum:number):value is unknown[]=>Array.isArray(value)&&value.length<=maximum&&Array.from({length:value.length},(_,index)=>Object.hasOwn(value,index)).every(Boolean);
export function boundedWorkObjectData(kind:Kind,raw:unknown):boolean{
 if(!object(raw))return false;
 if(kind==='WorkflowBoard')return dense(raw.lanes,6)&&dense(raw.cards,100);
 if(kind==='ArchitectureCanvas')return dense(raw.layers,6)&&dense(raw.nodes,60)&&dense(raw.edges,120)&&raw.nodes.every(node=>object(node)&&(node.facts===undefined||dense(node.facts,12)));
 return dense(raw.spans,200);
}
const placement=z.strictObject({cardId:id,laneId:id});
const boardCheckpoint=z.strictObject({sourceRevision:revision,selectedId:id.nullable(),placements:z.array(placement).max(100).refine(items=>new Set(items.map(item=>item.cardId)).size===items.length)});
export const BOARD_DRAFT_SCHEMA=boardCheckpoint.extend({previous:boardCheckpoint.optional()});
export type BoardDraft=z.infer<typeof BOARD_DRAFT_SCHEMA>;
export function boardDraftMatchesSource(saved:BoardDraft,data:WorkflowData):boolean{
 return saved.sourceRevision===data.revision&&saved.placements.length===data.cards.length&&saved.placements.every(row=>data.cards.some(card=>card.id===row.cardId)&&data.lanes.some(lane=>lane.id===row.laneId));
}
export function readBoardDraft(raw:unknown,data:WorkflowData):BoardDraft{
 const empty:BoardDraft={sourceRevision:data.revision,selectedId:null,placements:data.cards.map(card=>({cardId:card.id,laneId:card.laneId}))};
 if(!object(raw)||!dense(raw.placements,100))return empty;
 if(raw.previous!==undefined&&(!object(raw.previous)||!dense(raw.previous.placements,100)))return empty;
 const parsed=BOARD_DRAFT_SCHEMA.safeParse(raw);if(!parsed.success)return empty;
 const saved=parsed.data;
 if(!boardDraftMatchesSource(saved,data)&&saved.previous&&boardDraftMatchesSource(saved.previous,data)){
  const {previous,...checkpoint}=saved;return {...previous,previous:checkpoint};
 }
 return saved;
}
export function boardProposal(raw:unknown,sourceData:unknown):{sourceRevision:string;moves:{cardId:string;fromLaneId:string;toLaneId:string}[]}|null{
 if(!boundedWorkObjectData('WorkflowBoard',sourceData)||!object(raw)||!dense(raw.placements,100)||(raw.previous!==undefined&&(!object(raw.previous)||!dense(raw.previous.placements,100))))return null;
 const source=WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard.safeParse(sourceData),draft=BOARD_DRAFT_SCHEMA.safeParse(raw);
 if(!source.success||!draft.success||source.data.revision!==draft.data.sourceRevision)return null;
 const data=source.data,value=draft.data;
 if(value.placements.length!==data.cards.length||value.placements.some(row=>!data.cards.some(card=>card.id===row.cardId)||!data.lanes.some(lane=>lane.id===row.laneId)))return null;
 const moves=value.placements.flatMap(row=>{const card=data.cards.find(card=>card.id===row.cardId)!;return card.laneId===row.laneId?[]:[{cardId:card.id,fromLaneId:card.laneId,toLaneId:row.laneId}];});
 return moves.length?{sourceRevision:data.revision,moves}:null;
}
export const WORK_OBJECT_EXAMPLES={
 WorkflowBoard:{dataBinding:'work',stateKey:'boardDraft',actionId:'proposeMoves',actionLabel:'Send move proposal'},
 ArchitectureCanvas:{dataBinding:'architecture',stateKey:'architectureView',actionId:'askAboutNode'},
 TraceWaterfall:{dataBinding:'trace',stateKey:'traceView',actionId:'askAboutSpan'},
};
export const WORK_OBJECT_DESCRIPTIONS={
  WorkflowBoard:'Arrange supplied cards in up to6 named lanes; use a board for a real workflow, not a generic list. Bind {revision,title?,lanes:[{id,label,detail?}],cards:[{id,laneId,title,detail?,tag?,owner?}],source?}, at most100 unique cards. revision is the supplied source revision, not a client-generated timestamp. Drag a card, select its destination or use Alt+Left/Right. stateKey durably stores {sourceRevision,selectedId,placements:[{cardId,laneId}],previous?}; previous retains one source checkpoint after a reset and restores when that source returns. A source revision change requires resetting the local draft. Optional action submits only current {sourceRevision,moves:[{cardId,fromLaneId,toLaneId}]}; moving a local card never changes a ticket or proves external completion.',
 ArchitectureCanvas:'Inspect a layered architecture schematic with literal source nodes, directed edges, neighbor focus and contextual details. Bind {revision,title?,layers:[{id,label}],nodes:[{id,layerId,label,kind:client|service|store|queue,detail?,facts?:[{label,value}]}],edges:[{from,to,label?}],source?}. Up to6 layers,60 unique nodes,120 unique directed edges and12 facts per node; no dangling references, external URLs or raw HTML. stateKey stores {sourceRevision,selectedId,neighborsOnly}. Optional action asks about the current {sourceRevision,nodeId}; this does not deploy or call any service.',
 TraceWaterfall:'Explore supplied trace spans and latency in a nested timing waterfall, with local hierarchy collapse, text/status filters, zoom and details. Bind {revision,title?,spans:[{id,parentId?,name,service?,status:ok|error|unknown,startMs?,durationMs?,detail?}],source?}, at most200 unique spans in an acyclic hierarchy. Times are supplied relative milliseconds in0..86400000; a span lacking either start or duration has Timing unavailable and no invented bar. stateKey stores {sourceRevision,selectedId,query,status,zoom,collapsedIds}. Filters include matching ancestors. Optional action submits current {sourceRevision,spanId}; no live execution or telemetry subscription starts.',
};
export const WORK_OBJECT_PACK={version:'1.0.0',description:'Distinct source-bound workflow boards, layered architecture schematics and trace waterfalls with durable local exploration. Actions are proposals or questions, never external execution claims.',dataSchemas:Object.fromEntries(Object.entries(WORK_OBJECT_DATA_SCHEMAS).map(([name,schema])=>[name,z.toJSONSchema(schema)]))};
