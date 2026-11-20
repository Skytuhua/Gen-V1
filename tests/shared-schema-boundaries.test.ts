import { describe, expect, it } from 'vitest';
import { PlanningQuestionSchema } from '../packages/contracts/planning-question.ts';
import {
  researchAuthoritySchema,
  researchContextSchema,
  researchHashSchema,
  researchPageSchema,
  researchPassageSchema,
  RESEARCH_PASSAGE_BYTES,
  RESEARCH_SOURCE_BYTES,
} from '../packages/contracts/research.ts';
import { IMAGE_COMPARE_SCHEMAS } from '../packages/ui-catalog/image-compare.ts';

const option = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: 'Label ' + id, ...extra });

describe('PlanningQuestionSchema', () => {
  it('accepts a minimal question with one option', () => {
    const value = { options: [option('a')] };
    expect(PlanningQuestionSchema.parse(value)).toEqual(value);
  });
  it('accepts the maximum of 12 options and rejects 13', () => {
    const options = Array.from({ length: 12 }, (_, i) => option('o' + i));
    expect(PlanningQuestionSchema.parse({ options })).toHaveProperty('options');
    options.push(option('o12'));
    expect(PlanningQuestionSchema.safeParse({ options }).success).toBe(false);
  });
  it('rejects duplicate option IDs', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('x'), option('x')] }).success).toBe(false);
  });
  it('enforces option ID character and length rules', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('ok-1.a:b_c')] }).success).toBe(true);
    for (const id of ['', ' has-space', '-leading', 'with space', 'x'.repeat(161), 'bad/char', '.leading', ':leading']) {
      expect(PlanningQuestionSchema.safeParse({ options: [option(id)] }).success).toBe(false);
    }
  });
  it('rejects an empty or whitespace-only label and labels over 160 chars', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { label: ' ' })] }).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { label: 'x'.repeat(161) })] }).success).toBe(false);
  });
  it('bounds descriptions and explanations', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { description: 'x'.repeat(500) })] }).success).toBe(true);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { description: 'x'.repeat(501) })] }).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { explanation: 'x'.repeat(4001) })] }).success).toBe(false);
  });
  it('requires each example to carry text or a granted resource ID', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{ text: 'show this' }] })] }).success).toBe(true);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{ resourceId: 'img-1' }] })] }).success).toBe(true);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{ alt: 'nothing usable' }] })] }).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{}] })] }).success).toBe(false);
  });
  it('rejects example resource IDs that are paths or URLs', () => {
    for (const resourceId of ['../escape', 'a/b', 'https://x', '.', '..', 'has space', 'with?query']) {
      expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{ resourceId }] })] }).success).toBe(false);
    }
  });
  it('limits examples to four per option', () => {
    const examples = Array.from({ length: 4 }, (_, i) => ({ text: 'e' + i }));
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples })] }).success).toBe(true);
    examples.push({ text: 'e4' });
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples })] }).success).toBe(false);
  });
  it('rejects extra keys at every level', () => {
    expect(PlanningQuestionSchema.safeParse({ options: [option('a')], extra: 1 }).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { extra: 1 })] }).success).toBe(false);
    expect(PlanningQuestionSchema.safeParse({ options: [option('a', { examples: [{ text: 't', extra: 1 }] })] }).success).toBe(false);
  });
  it('defaults allowCustom to absent and accepts it', () => {
    expect(PlanningQuestionSchema.parse({ options: [option('a')] })).not.toHaveProperty('allowCustom');
    expect(PlanningQuestionSchema.parse({ options: [option('a')], allowCustom: true }).allowCustom).toBe(true);
  });
});

const hash = 'a'.repeat(64);

describe('research contract schemas', () => {
  it('defines the documented byte budgets', () => {
    expect(RESEARCH_SOURCE_BYTES).toBe(4 * 1024 * 1024);
    expect(RESEARCH_PASSAGE_BYTES).toBe(64 * 1024);
  });
  it('accepts only lowercase 64-hex hashes', () => {
    expect(researchHashSchema.safeParse(hash).success).toBe(true);
    for (const bad of ['', 'A' + hash.slice(1), hash.slice(0, 63), hash + 'f', 'g' + hash.slice(1)]) {
      expect(researchHashSchema.safeParse(bad).success).toBe(false);
    }
  });
  it('distinguishes personal and company authority', () => {
    expect(researchAuthoritySchema.parse({ kind: 'personal' })).toEqual({ kind: 'personal' });
    expect(researchAuthoritySchema.parse({ kind: 'company', companyId: 'acme-1' })).toEqual({ kind: 'company', companyId: 'acme-1' });
    expect(researchAuthoritySchema.safeParse({ kind: 'company' }).success).toBe(false);
    expect(researchAuthoritySchema.safeParse({ kind: 'other' }).success).toBe(false);
    expect(researchAuthoritySchema.safeParse({ kind: 'personal', companyId: 'x' }).success).toBe(false);
  });
  it('validates a research context with a nullable project', () => {
    const ctx = { authority: { kind: 'personal' }, threadId: 't1', projectId: null };
    expect(researchContextSchema.parse(ctx)).toEqual(ctx);
    expect(researchContextSchema.safeParse({ ...ctx, projectId: 'p_1' }).success).toBe(true);
    for (const key of ['authority', 'threadId', 'projectId']) {
      const rest = { ...ctx } as Record<string, unknown>;
      delete rest[key];
      expect(researchContextSchema.safeParse(rest).success).toBe(false);
    }
    expect(researchContextSchema.safeParse({ ...ctx, extra: 1 }).success).toBe(false);
    expect(researchContextSchema.safeParse({ ...ctx, threadId: 'bad id!' }).success).toBe(false);
  });
  it('accepts a bounded half-open passage and rejects degenerate or oversized ranges', () => {
    const base = { sourceId: 's1', revision: 1, sha256: hash, start: 0, end: 1 };
    expect(researchPassageSchema.parse(base)).toEqual(base);
    expect(researchPassageSchema.safeParse({ ...base, end: RESEARCH_PASSAGE_BYTES }).success).toBe(true);
    for (const patch of [
      { start: 5, end: 5 },
      { start: 5, end: 4 },
      { start: -1 },
      { end: 0 },
      { end: RESEARCH_PASSAGE_BYTES + 1 },
      { revision: 0 },
      { revision: 1.5 },
      { start: 0.5 },
      { sha256: 'xyz' },
      { extra: 1 },
    ]) {
      expect(researchPassageSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    }
  });
  it('validates page queries with a bounded limit and cursor', () => {
    expect(researchPageSchema.parse({ kind: 'sources' })).toEqual({ kind: 'sources' });
    expect(researchPageSchema.parse({ kind: 'documents', limit: 100, cursor: 'abc' })).toMatchObject({ limit: 100 });
    for (const value of [
      { kind: 'other' },
      { kind: 'sources', limit: 0 },
      { kind: 'sources', limit: 101 },
      { kind: 'sources', limit: 2.5 },
      { kind: 'sources', cursor: 'x'.repeat(2049) },
      { kind: 'sources', extra: 1 },
    ]) {
      expect(researchPageSchema.safeParse(value).success).toBe(false);
    }
    expect(researchPageSchema.safeParse({ kind: 'sources', cursor: 'x'.repeat(2048) }).success).toBe(true);
  });
});

const resourceId = 'img-res-1';
const compare = (extra: Record<string, unknown> = {}) => ({ beforeResourceId: resourceId, afterResourceId: 'img-res-2', stateKey: 'compare1', ...extra });

describe('IMAGE_COMPARE_SCHEMAS', () => {
  it('accepts a minimal comparison', () => {
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.parse(compare())).toMatchObject({ stateKey: 'compare1' });
  });
  it('rejects path-like or URL-like resource IDs', () => {
    for (const bad of ['a/b', 'a\\b', 'x?y', 'x#y', 'x y', '.', '..', '', 'x'.repeat(201)]) {
      expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ beforeResourceId: bad })).success).toBe(false);
    }
  });
  it('enforces identifier rules on stateKey', () => {
    for (const key of ['_ok', 'K9-x_y', 'a'.repeat(128)]) {
      expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ stateKey: key })).success).toBe(true);
    }
    for (const key of ['9starts-digit', 'has space', 'has.dot', '', 'a'.repeat(129), '__proto__', 'prototype', 'constructor']) {
      expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ stateKey: key })).success).toBe(false);
    }
  });
  it('bounds optional labels and title', () => {
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ beforeLabel: 'x'.repeat(121) })).success).toBe(false);
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ beforeLabel: '' })).success).toBe(false);
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ title: 'x'.repeat(300) })).success).toBe(true);
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ title: 'x'.repeat(301) })).success).toBe(false);
    expect(IMAGE_COMPARE_SCHEMAS.ImageCompare.safeParse(compare({ unknown: 1 })).success).toBe(false);
  });
});
