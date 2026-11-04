import { describe, expect, it } from 'vitest';
import { assertCatalogCoverage, catalogSpec, everydaySpec, EVERYDAY_REVIEW_DATA, INTERACTION_REVIEW_DATA,interactionSpec,faqSpec, graphData, graphSpec, MAP_DATA, mapSpec, migrationSpec, signingSpec } from '../scripts/review-fixtures';
import {INTERACTION_DATA_SCHEMAS} from '../packages/ui-catalog/interactions';
import { CAPABILITIES, validateSurface } from '../packages/ui-catalog/index';
import { mapData, relationshipData } from '../packages/ui-catalog/workflow';
import {EVERYDAY_DATA_SCHEMAS} from '../packages/ui-catalog/everyday';

describe('recorded review fixture coverage', () => {
  it('uses typed declarative review, editable-record and parameter fixtures',()=>{validateSurface(interactionSpec());for(const name of ['ReviewQueue','EditableTable','ParameterControls'] as const)expect(INTERACTION_DATA_SCHEMAS[name].safeParse(INTERACTION_REVIEW_DATA[name]).success).toBe(true);});
  it('covers every advertised catalog entry through one reusable renderer', () => {
    expect(assertCatalogCoverage(catalogSpec('pdf-resource', 'png-resource'))).toEqual(CAPABILITIES.map(item=>item.name).sort());
    expect(CAPABILITIES).toHaveLength(48);
  });
  it('covers typed statistics, selection and a declared private credential without embedding token bytes',()=>{
    expect(()=>validateSurface(everydaySpec())).not.toThrow();
    expect(EVERYDAY_DATA_SCHEMAS.Stats.parse(EVERYDAY_REVIEW_DATA.Stats).metrics.map(item=>item.id)).toEqual(['requests','latency','availability','cost']);
    expect(EVERYDAY_REVIEW_DATA.Stats.metrics.find(item=>item.id==='cost')?.value).toBeNull();
    expect(EVERYDAY_DATA_SCHEMAS.Comparison.parse(EVERYDAY_REVIEW_DATA.Comparison).options.map(item=>item.id)).toEqual(['starter','studio','team']);
    const catalog=catalogSpec('pdf-resource','png-resource');
    expect(catalog.elements.catalog.props.labels).toContain('Everyday');
    expect(catalog.elements.privateToken.props).toEqual({slotKey:'projectApiToken',label:'API token',service:'Project API'});
    expect(JSON.stringify([catalog,everydaySpec(),EVERYDAY_REVIEW_DATA])).not.toMatch(/SYNTHETIC_REVIEW_TOKEN/);
  });
  it('admits all reference compositions without bespoke application routes', () => {
    for (const spec of [signingSpec('pdf-resource'), migrationSpec(), mapSpec(), faqSpec([{ id: 'first', title: 'How does this work?' }, { id: 'next', parent: 'first', title: 'What follows?' }]), graphSpec('vertical', 'conflicts'), graphSpec('horizontal', 'merged')]) expect(() => validateSurface(spec)).not.toThrow();
  });
  it('can add an unfamiliar differently nested question without changing existing ids', () => {
    const before = faqSpec([{ id: 'alpha', title: 'What is an eclipse?' }]);
    const after = faqSpec([{ id: 'alpha', title: 'What is an eclipse?' }, { id: 'beta', parent: 'alpha', title: 'When does the shadow arrive?' }]);
    expect(after.elements.alpha.props.stateKey).toBe(before.elements.alpha.props.stateKey);
    expect(after.elements.alpha.children).toEqual(['beta']); expect(() => validateSurface(after)).not.toThrow();
  });
  it('supplies valid source records in every PR phase and exactly three cafe selections', () => {
    for (const phase of ['conflicts', 'resolving', 'ready', 'merging', 'merged'] as const) {
      expect(relationshipData.safeParse(graphData(phase, 20)).success).toBe(true);
      expect(graphData(phase).source).toContain('simulated');
    }
    expect(mapData.safeParse(MAP_DATA).success).toBe(true);
    expect(MAP_DATA.points.map(point => point.id)).toEqual(['boathouse', 'fern', 'lumen']);
  });
  it('keeps reference review actions in the graph footer and a stable branch timeline', () => {
    const spec = graphSpec('horizontal', 'conflicts');
    expect(spec.elements.graph.children).toEqual(['resolve']);
    const conflict = graphData('conflicts'), ready = graphData('ready');
    expect(conflict.nodes.length).toBeGreaterThanOrEqual(8);
    for (const item of conflict.nodes) expect(ready.nodes.find(node => node.id === item.id)?.column).toBe(item.column);
    expect(conflict.edges.some(edge => edge.prospective)).toBe(true);
  });
  it('offers a contextual custom notice address instead of a permanent duplicate field', () => {
    const spec = signingSpec('pdf-resource');
    expect(spec.elements.emails.props.custom).toEqual({ label: 'Something else', placeholder: 'An email address' });
    expect(spec.elements.email).toBeUndefined();
  });
});
