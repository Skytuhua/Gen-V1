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
