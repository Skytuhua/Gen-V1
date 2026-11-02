import {describe,it,expect} from 'vitest';
import {EXPLORATION_SCHEMAS,EXPLORATION_DATA_SCHEMAS,boundedExplorationData,readAnnotationState} from '../packages/ui-catalog/exploration';

const slots={timeZone:'America/New_York',slots:[{id:'morning',start:'2026-11-03T10:00:00-05:00',end:'2026-11-03T10:30:00-05:00',availability:'available'}]};
describe('source-bound exploration contracts',()=>{
 it('requires grant IDs and rejects executable or external image inputs',()=>{
  expect(EXPLORATION_SCHEMAS.ImageAnnotator.safeParse({resourceId:'granted-image',alt:'Review screenshot',stateKey:'pins'}).success).toBe(true);
  for(const resourceId of ['https://example.com/a.png','../private','file:///a'])expect(EXPLORATION_SCHEMAS.ImageAnnotator.safeParse({resourceId,alt:'Image',stateKey:'pins'}).success).toBe(false);
  expect(EXPLORATION_SCHEMAS.LogExplorer.safeParse({dataBinding:'logs',stateKey:'view',command:'npm test'}).success).toBe(false);
 });
 it('admits only explicit-offset valid slots and a real supplied timezone',()=>{
  expect(EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(slots).success).toBe(true);
  for(const invalid of [{...slots,timeZone:'Invented/Nowhere'},{...slots,slots:[{...slots.slots[0],start:'2026-11-03T10:00:00'}]},{...slots,slots:[{...slots.slots[0],end:'2026-11-03T09:30:00-05:00'}]},{...slots,slots:[...slots.slots,...slots.slots]}])expect(EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(invalid).success).toBe(false);
 });
 it('bounds dense collections before parsing and refuses duplicate log identities',()=>{
  const huge=new Array(100_000_000);Object.defineProperty(huge,'0',{get(){throw Error('must not traverse');}});
  expect(boundedExplorationData('LogExplorer',{events:huge})).toBe(false);
  expect(boundedExplorationData('SchedulePicker',{slots:new Array(2)})).toBe(false);
  const event={id:'one',level:'error',message:'Actual supplied failure'};
  expect(EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse({events:[event,event]}).success).toBe(false);
  expect(EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse({events:[{...event,message:'x'.repeat(2001)}]}).success).toBe(false);
 });
 it('restores only bounded normalized pins belonging to the displayed source',()=>{
  const state={resourceId:'first',selectedId:'pin1',annotations:[{id:'pin1',x:.25,y:.8,text:'Use a shorter heading'}]};
  expect(readAnnotationState(state,'first')).toEqual(state);
  expect(readAnnotationState(state,'other').annotations).toEqual([]);
  expect(readAnnotationState({...state,annotations:[{...state.annotations[0],x:Infinity}]},'first').annotations).toEqual([]);
  expect(readAnnotationState({...state,annotations:Array.from({length:33},(_,i)=>({...state.annotations[0],id:'p'+i}))},'first').annotations).toEqual([]);
 });
});
