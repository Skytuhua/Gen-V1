import {describe, expect, it} from 'vitest';
import {PlanningQuestionSchema} from '../packages/contracts/planning-question.ts';

const option = (id: string, extra: object = {}) => ({id, label: `Pick ${id}`, ...extra});

describe('PlanningQuestionSchema', () => {
  it('accepts a minimal single-option question', () => {
    expect(PlanningQuestionSchema.safeParse({options: [option('a')]}).success).toBe(true);
  });

  it('accepts options with descriptions, explanations, custom input and examples', () => {
    const value = {
      options: [
        option('opt-1', {
          description: 'first', explanation: 'why',
          examples: [{text: 'like this'}, {resourceId: 'img-42', alt: 'sample'}],
        }),
        option('opt.2:x_y'),
      ],
      allowCustom: true,
    };
    const parsed = PlanningQuestionSchema.safeParse(value);
    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate option IDs', () => {
    expect(PlanningQuestionSchema.safeParse({options: [option('same'), option('same')]}).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({options: [option('a'), option('b'), option('a')]}).success).toBe(false);
  });

  it('rejects empty and oversized option lists', () => {
    expect(PlanningQuestionSchema.safeParse({options: []}).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({options: Array.from({length: 13}, (_, i) => option(`o${i}`))}).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({options: Array.from({length: 12}, (_, i) => option(`o${i}`))}).success).toBe(true);
  });

  it('rejects malformed, blank and oversized option fields', () => {
    for (const bad of [
      {options: [{id: '', label: 'x'}]},
      {options: [{id: '-lead', label: 'x'}]},
      {options: [{id: 'white space', label: 'x'}]},
      {options: [{id: 'a'.repeat(161), label: 'x'}]},
      {options: [{id: 'ok'}]},
      {options: [{id: 'ok', label: ''}]},
      {options: [{id: 'ok', label: '   '}]},
      {options: [{id: 'ok', label: 'x'.repeat(161)}]},
      {options: [{id: 'ok', label: 'x', description: 'd'.repeat(501)}]},
      {options: [{id: 'ok', label: 'x', explanation: 'e'.repeat(4001)}]},
      {options: [{id: 'ok', label: 'x', extra: 'key'}]},
      {options: [option('a')], allowCustom: 'yes'},
      {options: [option('a')], unexpected: 1},
      {},
    ]) expect(PlanningQuestionSchema.safeParse(bad).success).toBe(false);
  });

  it('requires each example to carry text or a granted image resource', () => {
    const base = option('a');
    for (const [examples, ok] of [
      [[{text: 'hint'}], true],
      [[{resourceId: 'r1'}], true],
      [[{text: '   ', resourceId: 'r1'}], true],
      [[{text: '   '}], false],
      [[{}], false],
      [[{alt: 'only'}], false],
      [[{text: 't', resourceId: '../escape'}], false],
      [[{text: 't', resourceId: 'has space'}], false],
      [[{text: 't', resourceId: 'a/b'}], false],
      [[{text: 't', resourceId: 'a\\b'}], false],
      [[{text: 't', resourceId: 'a?b'}], false],
      [[{text: 't', resourceId: 'a#b'}], false],
      [[{text: 't', resourceId: '.'}], false],
      [[{text: 't', resourceId: '..'}], false],
      [[{text: 'x'.repeat(4001)}], false],
      [[{text: 't', alt: 'a'.repeat(301)}], false],
    ] as const) {
      expect(PlanningQuestionSchema.safeParse({options: [{...base, examples}]}).success).toBe(ok);
    }
  });

  it('caps examples at four per option', () => {
    const examples = Array.from({length: 5}, (_, i) => ({text: `e${i}`}));
    expect(PlanningQuestionSchema.safeParse({options: [option('a', {examples})]}).success).toBe(false);
  });
});
