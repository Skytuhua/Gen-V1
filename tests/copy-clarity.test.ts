import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionProvider, Renderer, StateProvider, VisibilityProvider } from '@json-render/react';
import { expect, it } from 'vitest';
import { discoverCapabilities } from '../packages/core/discovery';
import { validateSurface } from '../packages/ui-catalog';
import type { CompositionExample } from '../packages/ui-catalog/composition-examples';
import { registry } from '../apps/web/src/registry';
import { Comparison } from '../apps/web/src/EverydayData';
import { mapActionPayload } from '../apps/web/src/task-context';
import { KIT_INPUTS, VISIT_INPUTS } from '../evals/copy-clarity';

async function discover(name: string, id: string) {
  const result = await discoverCapabilities({ query: name, details: true });
  const example = (result as { compositionExamples?: CompositionExample[] }).compositionExamples?.find(item => item.id === id);
  expect(example, `${name} discovery must offer the ${id} composition`).toBeDefined();
  validateSurface(example!.spec);
  return example!.spec;
}

function render(spec: CompositionExample['spec'], inputs: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(StateProvider, {
    initialState: { inputs, values: {} },
    children: createElement(VisibilityProvider, null, createElement(ActionProvider, null,
      createElement(Renderer, { spec, registry: { ...registry, Comparison } }))),
  }));
}

it('discovery offers a visit answer before visible deadlines, eligibility facts and next action', async () => {
  const spec = await discover('Disclosure', 'visit-facts');
  const html = render(spec, VISIT_INPUTS);
  expect(html).toContain('Thursday at 14:30');
  expect(html.indexOf('Thursday at 14:30')).toBeLessThan(html.indexOf('Member hours'));
  for (const fact of ['Mon–Thu 09:00–19:00', 'Fri 09:00–17:00', 'Sat 10:00–16:00', 'Sun closed', 'Tue and Thu 13:00–17:00', 'Wednesday 17:00', 'no same-day', 'two accompanied guests', 'observe only', '90 minutes', 'two active', 'four hours', 'West alcove', '30-minute', 'room capacity', 'not a confirmed booking']) expect(html).toContain(fact);
  expect(html.indexOf('Visitor deadline')).toBeLessThan(html.indexOf('Request the visitor pass'));
});

it('discovery keeps comparison totals and fit reasons with one selection mechanism', async () => {
  const spec = await discover('Comparison', 'kit-comparison');
  const html = render(spec, KIT_INPUTS);
  expect(html).toContain('Choose Field kit');
  expect(html.indexOf('Choose Field kit')).toBeLessThan(html.indexOf('<table'));
  expect(html.match(/aria-label="Select /g)).toHaveLength(3);
  expect(html).not.toContain('type="radio"');
  for (const fact of ['USD 220', '>270<', '>160<', 'Observers', 'Weight', 'Setup', '>4<', '>2<', '>8<', '>7<', '>5<', '>12<', '>10<', '20 over budget', 'Two observers short', 'tax, shipping and stock', 'does not place an order']) expect(html).toContain(fact);
  expect(Object.values(spec.elements).filter(node => node.type === 'Disclosure')).toHaveLength(0);
});

it('signing discovery omits routine framing while retaining actual document and signature bindings', async () => {
  const spec = await discover('DocumentPreview', 'document-signing');
  const nodes = Object.values(spec.elements);
  expect(nodes.filter(node => node.type === 'Disclosure' || node.type === 'Text')).toHaveLength(0);
  const preview = nodes.find(node => node.type === 'DocumentPreview')!.props;
  expect(preview).toMatchObject({ resourceId: 'granted-agreement', fieldStateKeys: { Name: 'name', Title: 'title', Email: 'email', SignedDate: 'signedDate' }, signatureStateKey: 'signature' });
  expect(preview).not.toHaveProperty('exportOperationId');
  const form = nodes.find(node => node.type === 'Form')!.props;
  expect(mapActionPayload(form, { name: 'Alex Morgan', email: 'legal@studio.example', signedDate: '2026-10-30', title: 'Designer', signature: { resourceId: 'saved-signature' } })).toEqual({ name: 'Alex Morgan', email: 'legal@studio.example', signedDate: '2026-10-30', title: 'Designer', signature: { resourceId: 'saved-signature' } });
});

it('retains long requested source text and legal words without a runtime phrase filter', () => {
  const text = 'Requested source passage. '.repeat(300) + 'Source and signature details: legal@studio.example. END OF SOURCE';
  const spec = { root: 'source', elements: { source: { type: 'Text', props: { text } } } };
  validateSurface(spec);
  const html = render(spec, {});
  expect(html).toContain(text);
});
