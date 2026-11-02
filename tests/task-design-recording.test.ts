import {expect,it} from 'vitest';
import {CAPABILITIES,validateSurface} from '../packages/ui-catalog';
import {taskDesignScenes,TASK_DESIGN_SELECTORS} from '../scripts/task-design-scenes';

it('keeps all 48 advertised components in 18 valid recording scenes with visible selectors',()=>{
 const scenes=taskDesignScenes();expect(scenes).toHaveLength(18);
 const recorded=new Set(scenes.flatMap(scene=>{validateSurface(scene.spec);return Object.values(scene.spec.elements).map(node=>node.type);}));
 expect([...recorded].sort()).toEqual(CAPABILITIES.map(component=>component.name).sort());expect(recorded.size).toBe(48);
 for(const component of recorded)expect(TASK_DESIGN_SELECTORS[component]).toBeTruthy();
});

it('records an editable prepared handoff and an explicit download proposal beside disclosed source evidence',()=>{
 const delivery=taskDesignScenes().find(scene=>scene.id==='delivery')!;
 const {elements}=delivery.spec;
 expect(elements.delivery).toMatchObject({type:'Stack',children:['handoff','form','sources']});
 expect(elements.handoff).toMatchObject({type:'Document',props:{title:'Delivery handoff',dataBinding:'handoff',presentation:'window',editableStateKey:'handoffDraft',linkLabel:'Open handoff'}});
 expect(delivery.inputs.handoff).toMatch(/Agreement handoff/);
 expect(elements.form.props).toMatchObject({actionId:'proposeDelivery',submitLabel:'Prepare download',payloadFromState:{document:'handoffDraft',note:'note',format:'format',includeOriginal:'original'}});
 expect(elements.sources).toMatchObject({type:'Disclosure',props:{title:'Source files'},children:['bundle']});
 expect(elements.document).toMatchObject({type:'Document',props:{resourceId:'agreement'}});
 expect(elements.files.type).toBe('Tree');expect(elements.evidence.type).toBe('EvidenceList');
});
