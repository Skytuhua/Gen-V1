import {expect, it} from 'vitest';
import {parseSkillMetadata} from '../packages/skill-catalog/filesystem.ts';

it('reads quoted display values followed by YAML comments', () => {
  const source = `---
name: 'Review ''notes''' # label comment
description: "Keep # inside and \\"quotes\\" too" # explanation
---
Body`;
  expect(parseSkillMetadata(source)).toEqual({name: "Review 'notes'", description: 'Keep # inside and "quotes" too'});
});

it('keeps multiline quoted metadata and does not mistake its comment for display text', () => {
  expect(parseSkillMetadata('---\nname: Review\ndescription: "First line\n  second line" # comment\n---'))
    .toEqual({name: 'Review', description: 'First line second line'});
});

it.each(['"quoted" trailing junk', "'quoted' trailing junk", "'bad'quote'"])('rejects malformed quoted display metadata: %s', value => {
  expect(() => parseSkillMetadata(`---\nname: Review\ndescription: ${value}\n---`)).toThrow();
});

it.each(['>', '|-'])('reads the supported block header %s followed by a YAML comment', indicator => {
  expect(parseSkillMetadata('---\nname: Notes\ndescription: ' + indicator + ' # author comment\n  First line\n  second line\n---'))
    .toEqual({name: 'Notes', description: 'First line second line'});
});
