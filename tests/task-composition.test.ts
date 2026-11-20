import {expect,it} from 'vitest';
import {COMPOSITION_EXAMPLES} from '../packages/ui-catalog/composition-examples';
import {CAPABILITIES,validateSurface} from '../packages/ui-catalog';
import {discoverCapabilities} from '../packages/core/discovery';
import {PRESENTATION_POLICY} from '../packages/runtime-pi/presentation-policy';

it('offers different task structures rather than relabeled versions of one workflow screen',()=>{
 expect(COMPOSITION_EXAMPLES.length).toBeGreaterThanOrEqual(6);
 const mechanics=new Set(CAPABILITIES.map(item=>item.name));
 for(const example of COMPOSITION_EXAMPLES){validateSurface(example.spec);for(const component of example.components)expect(mechanics.has(component)).toBe(true);}
 for(const family of ['time','review','investigation']){
  const examples=COMPOSITION_EXAMPLES.filter(example=>example.id.startsWith(family+'-'));expect(examples).toHaveLength(2);
  const structure=(spec:typeof examples[number]['spec'])=>Object.values(spec.elements).map(node=>[node.type,node.children?.length??0]);
  expect(structure(examples[0].spec)).not.toEqual(structure(examples[1].spec));
 }
});
it('keeps composition examples out of the cheap index and returns at most two relevant examples with schema discovery',async()=>{
 expect(await discoverCapabilities({})).not.toHaveProperty('compositionExamples');
 const detail=await discoverCapabilities({query:'SchedulePicker',details:true});expect(detail).toHaveProperty('compositionExamples');
 const examples=(detail as unknown as {compositionExamples:typeof COMPOSITION_EXAMPLES}).compositionExamples;
 expect(examples).toHaveLength(2);expect(examples.every(example=>example.components.includes('SchedulePicker'))).toBe(true);
 expect(await discoverCapabilities({query:'SchedulePicker',details:true,offset:1})).not.toHaveProperty('compositionExamples');
});
it('guides object-specific composition within the current inline constraints without growing the prompt',()=>{
 expect(PRESENTATION_POLICY).toContain('working object');expect(PRESENTATION_POLICY).toContain('composer width');expect(PRESENTATION_POLICY).toContain('chat owns scrolling');
 expect(PRESENTATION_POLICY).not.toContain('1040px');expect(PRESENTATION_POLICY).not.toContain('blue-filled');
 expect(Buffer.byteLength(PRESENTATION_POLICY)).toBeLessThan(12000);
});
it('lets ordinary topics continue in the main conversation composer instead of an automatic question form',()=>{
 expect(PRESENTATION_POLICY).not.toContain('A question Form clears');
 expect(PRESENTATION_POLICY).toContain('main conversation composer');
 const guidance=JSON.stringify(CAPABILITIES.map(item=>item.description));
 expect(guidance).not.toContain('sibling');
 expect(guidance).not.toContain('durable new root question');
 expect(guidance).toContain('main conversation composer');
});
it('pairs document editing with the signing composition as distinct arrangements',()=>{
 const examples=Object.fromEntries(COMPOSITION_EXAMPLES.map(example=>[example.id,example]));
 const edit=examples['document-edit'],signing=examples['document-signing'];
 expect(edit).toBeDefined();expect(signing).toBeDefined();
 validateSurface(edit.spec);validateSurface(signing.spec);
 expect(edit.spec.root).toBe('handoff');expect(signing.spec.root).toBe('signing');
 const types=(spec:typeof edit.spec)=>Object.values(spec.elements).map(node=>node.type);
 expect(types(edit.spec)).toEqual(['Document']);
 expect(edit.spec.elements.handoff.props.editableStateKey).toBe('handoffDraft');
 expect(types(signing.spec)).toContain('DocumentPreview');expect(types(signing.spec)).toContain('SignaturePad');
});
it('keeps a single preference form distinct from kit comparison',()=>{
 const examples=Object.fromEntries(COMPOSITION_EXAMPLES.map(example=>[example.id,example]));
 const prefs=examples['preferences-single'],kits=examples['kit-comparison'];
 expect(prefs).toBeDefined();expect(kits).toBeDefined();
 validateSurface(prefs.spec);validateSurface(kits.spec);
 expect(prefs.spec.root).toBe('prefs');
 const types=(spec:typeof prefs.spec)=>Object.values(spec.elements).map(node=>node.type);
 expect(types(prefs.spec)).toEqual(['Form','Select','Input']);
 expect(types(prefs.spec)).not.toContain('Grid');
 expect(prefs.spec.elements.prefs.type).toBe('Form');expect(prefs.spec.elements.prefs.props.actionId).toBe('submitPreference');
 expect(types(kits.spec)).toContain('Comparison');
});
it('pairs image annotation with the export composition as distinct arrangements',()=>{
 const examples=Object.fromEntries(COMPOSITION_EXAMPLES.map(example=>[example.id,example]));
 const feedback=examples['image-feedback'],exp=examples['image-export'];
 expect(feedback).toBeDefined();expect(exp).toBeDefined();
 validateSurface(feedback.spec);validateSurface(exp.spec);
 expect(feedback.spec.root).toBe('pins');
 const types=(spec:typeof feedback.spec)=>Object.values(spec.elements).map(node=>node.type);
 expect(types(feedback.spec)).toEqual(['ImageAnnotator']);
 expect(types(exp.spec)).toContain('Split');expect(types(exp.spec)).toContain('Image');expect(types(exp.spec)).toContain('ParameterControls');
 const mechanics=new Set(CAPABILITIES.map(item=>item.name));
 for(const id of ['document-edit','preferences-single','image-feedback'])for(const component of examples[id].components)expect(mechanics.has(component)).toBe(true);
});
it('returns the new examples within the two-entry discovery bound',async()=>{
 for(const [query,id] of [['Document','document-edit'],['Select','preferences-single'],['ImageAnnotator','image-feedback']] as const){
  const detail=await discoverCapabilities({query,details:true}) as unknown as {compositionExamples:typeof COMPOSITION_EXAMPLES};
  expect(detail.compositionExamples.length).toBeLessThanOrEqual(2);
  expect(detail.compositionExamples.some(example=>example.id===id)).toBe(true);
 }
 expect(await discoverCapabilities({query:'Document'})).not.toHaveProperty('compositionExamples');
});
