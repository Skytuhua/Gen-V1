import {describe,expect,it} from 'vitest';
import {rebaseAppearanceDraft,editedAppearancePatch} from '../apps/web/src/appearance-draft';
import {DEFAULT_PREFERENCES,type UiPreferences} from '../packages/contracts/preferences';

const base:UiPreferences={...DEFAULT_PREFERENCES,density:'comfortable',chatFontSize:16};

describe('appearance draft rebase and changed-keys apply (AUD-08)',()=>{
 it('sends only edited keys, so an untouched external density update is not overwritten',()=>{
  const draft={...base,chatFontSize:18};
  const patch=editedAppearancePatch(draft,new Set(['chatFontSize']));
  expect(patch).toEqual({chatFontSize:18});
  expect('density' in patch).toBe(false);
 });
 it('rebases untouched fields from latest preferences while preserving an edited field',()=>{
  const draft={...base,chatFontSize:18};
  const latest:UiPreferences={...base,density:'compact'};
  const rebased=rebaseAppearanceDraft(draft,latest,new Set(['chatFontSize']));
  expect(rebased.density).toBe('compact');
  expect(rebased.chatFontSize).toBe(18);
 });
 it('preserves the fontSize/uiFontSize pair and motion/panelAnimations coupling when those fields change',()=>{
  const draft:UiPreferences={...base,uiFontSize:15,fontSize:15,motion:'off',panelAnimations:false};
  const patch=editedAppearancePatch(draft,new Set(['uiFontSize','fontSize','motion','panelAnimations']));
  expect(patch.uiFontSize).toBe(15);expect(patch.fontSize).toBe(15);
  expect(patch.motion).toBe('off');expect(patch.panelAnimations).toBe(false);
 });
 it('an empty edit set produces an empty patch',()=>{
  expect(editedAppearancePatch({...base,chatFontSize:18},new Set())).toEqual({});
 });
});
