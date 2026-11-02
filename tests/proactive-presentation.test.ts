import { describe, expect, it } from 'vitest';
import { createHostResourceLoader, createHostTools, UI_TOOLS } from '../packages/runtime-pi/tool-definitions';
import { PRESENTATION_POLICY } from '../packages/runtime-pi/presentation-policy';
import { catalogSpec } from '../scripts/review-fixtures';
import { validateSurface } from '../packages/ui-catalog';

describe('agent-initiated useful presentation', () => {
  it('gives every session proactive guidance without a phrase requirement', () => {
    const loader = createHostResourceLoader({ createExtensionRuntime: () => ({}) } as never);
    expect(loader.getSystemPrompt()).toContain(PRESENTATION_POLICY);
    expect(PRESENTATION_POLICY).toContain('Do not wait for the user to ask for UI');
    expect(PRESENTATION_POLICY).toContain('vertical');
    const tools = createHostTools([], async () => null);
    expect(tools.map(tool => tool.name)).toContain('ui_present');
    expect(UI_TOOLS.find(tool => tool.name === 'ui_present')!.description).toContain('proactively');
  });
  it('removes implementation commentary from the actual catalog composition', () => {
    const spec = catalogSpec('pdf', 'image'); validateSurface(spec);
    const content = Object.values(spec.elements).map(node => JSON.stringify(node.props)).join('\n');
    for (const phrase of ['A durable action returns', 'The content remains mounted', 'The current result comes first', 'Direct manipulation', 'Local steps preserve']) expect(content).not.toContain(phrase);
  });
  it('admits a disabled contextual action without changing its registered identity', () => {
    expect(() => validateSurface({ root: 'action', elements: { action: { type: 'Button', props: { label: 'Resolving…', actionId: 'resolve', disabled: true } } } })).not.toThrow();
  });
});
