import {describe,expect,it} from 'vitest';
import {WORK_OBJECT_SCHEMAS,WORK_OBJECT_DATA_SCHEMAS,boundedWorkObjectData,readBoardDraft,boardProposal} from '../packages/ui-catalog/work-objects';

const board={revision:'r1',lanes:[{id:'todo',label:'To do'},{id:'doing',label:'In progress'}],cards:[{id:'one',laneId:'todo',title:'Review retry ordering'}]};
const graph={revision:'r1',layers:[{id:'client',label:'Client'},{id:'server',label:'Server'}],nodes:[{id:'web',layerId:'client',label:'Web',kind:'client'},{id:'api',layerId:'server',label:'API',kind:'service'}],edges:[{from:'web',to:'api',label:'Requests'}]};
describe('source-bound work objects',()=>{
 it('admits bounded binding props and rejects external or executable inputs',()=>{
  for(const schema of Object.values(WORK_OBJECT_SCHEMAS)){
   expect(schema.safeParse({dataBinding:'source',stateKey:'view',actionId:'ask'}).success).toBe(true);
   for(const extra of [{url:'https://example.test'},{html:'<script>'},{command:'npm start'}])expect(schema.safeParse({dataBinding:'source',stateKey:'view',...extra}).success).toBe(false);
   expect(schema.safeParse({dataBinding:'constructor',stateKey:'view'}).success).toBe(false);
  }
 });
 it('requires current lane references and unique identities',()=>{
  expect(WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard.safeParse(board).success).toBe(true);
  for(const value of [{...board,cards:[...board.cards,...board.cards]},{...board,cards:[{...board.cards[0],laneId:'missing'}]},{...board,revision:''}])expect(WORK_OBJECT_DATA_SCHEMAS.WorkflowBoard.safeParse(value).success).toBe(false);
 });
 it('rejects oversized and sparse collections before schema traversal',()=>{
  const huge=new Array(100_000_000);Object.defineProperty(huge,'0',{get(){throw Error('do not traverse');}});
  expect(boundedWorkObjectData('WorkflowBoard',{lanes:[],cards:huge})).toBe(false);
  expect(boundedWorkObjectData('ArchitectureCanvas',{layers:[],nodes:new Array(2),edges:[]})).toBe(false);
  expect(boundedWorkObjectData('TraceWaterfall',{spans:huge})).toBe(false);
 });
 it('submits only current source-bound lane proposals and rejects stale or removed cards',()=>{
  const draft={sourceRevision:'r1',selectedId:'one',placements:[{cardId:'one',laneId:'doing'}]};
  expect(readBoardDraft(draft,board).placements).toEqual(draft.placements);
  expect(boardProposal(draft,board)).toEqual({sourceRevision:'r1',moves:[{cardId:'one',fromLaneId:'todo',toLaneId:'doing'}]});
  expect(boardProposal(draft,{...board,revision:'r2'})).toBeNull();
  expect(boardProposal(draft,{...board,cards:[]})).toBeNull();
  expect(boardProposal({...draft,placements:[{cardId:'one',laneId:'missing'}]},board)).toBeNull();
  expect(boardProposal({...draft,placements:[{cardId:'one',laneId:'todo'}]},board)).toBeNull();
 });
 it('retains a previous source checkpoint and restores its exact draft when that source returns',()=>{
  const original={sourceRevision:'r1',selectedId:'one',placements:[{cardId:'one',laneId:'doing'}]};
  const replacement={sourceRevision:'r2',selectedId:null,placements:[{cardId:'one',laneId:'todo'}],previous:original};
  const restored=readBoardDraft(replacement,board);
  expect(restored.placements).toEqual(original.placements);
  expect(restored.previous?.sourceRevision).toBe('r2');
  expect(boardProposal(restored,board)?.moves[0].toLaneId).toBe('doing');
 });
 it('rejects dangling architecture references, duplicate edges and raw URL fields',()=>{
  expect(WORK_OBJECT_DATA_SCHEMAS.ArchitectureCanvas.safeParse(graph).success).toBe(true);
  for(const value of [{...graph,edges:[{from:'web',to:'missing'}]},{...graph,edges:[...graph.edges,...graph.edges]},{...graph,nodes:[{...graph.nodes[0],url:'https://example.test'}]}])expect(WORK_OBJECT_DATA_SCHEMAS.ArchitectureCanvas.safeParse(value).success).toBe(false);
 });
 it('allows unknown span timing while rejecting cyclic, missing and invalid timed spans',()=>{
  const spans=[{id:'root',name:'Request',status:'ok',startMs:0,durationMs:100},{id:'child',parentId:'root',name:'Database',status:'unknown'}];
  expect(WORK_OBJECT_DATA_SCHEMAS.TraceWaterfall.safeParse({revision:'trace-1',spans}).success).toBe(true);
  for(const value of [[{...spans[0],durationMs:-1}],[{...spans[0],startMs:Infinity}],[{...spans[1],parentId:'absent'}],[{...spans[0],parentId:'child'},spans[1]]])expect(WORK_OBJECT_DATA_SCHEMAS.TraceWaterfall.safeParse({revision:'r1',spans:value}).success).toBe(false);
 });
});
