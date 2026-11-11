import {describe, expect, it} from 'vitest';
import {captureWidths, keyStates, requiredOutputScreenIds,screens} from '../../scripts/capture-ui/screen-map';
import {isReducedOffender, motionKey, type CaptureEntry, type Motion} from '../../scripts/capture-ui/helpers';
import {captureExitCode, canCaptureStrip, verifyCaptureOutputs, type CaptureOutputManifest, type ReducedMotionOutput, type StripMotionReference} from '../../scripts/capture-ui/runtime-helpers';
import {reducedMotionMarkdown} from '../../scripts/capture-ui/reports';

const iframe: Motion = {screen: 'plugin-frame', state: 'default', width: 375, frame: 'frame:0 /plugins/personal-visuals/frame', selector: '.floating-window', type: 'Animation', animationName: '', transitionProperty: '', properties: ['opacity'], duration: 180, delay: 0, easing: 'ease', iterations: 1, fill: 'both', keyframes: [{opacity: 0}, {opacity: 1}]};
function entries(screen: string): CaptureEntry[] {
  return captureWidths.flatMap(width => keyStates.map(state => ({screen, width, state, status: 'captured'})));
}
function fixture(ids: readonly string[] = ['plugin-frame']) {
  const manifest = {screens: [...ids], widths: [...captureWidths], entries: ids.flatMap(entries)} satisfies CaptureOutputManifest;
  const motion: Motion[] = ids.includes('plugin-frame') ? [{...iframe}] : [];
  const reduced: ReducedMotionOutput = {records: [...motion], offenders: motion.filter(isReducedOffender)};
  const strips: StripMotionReference[] = motion.map(row => ({screen: row.screen, state: row.state, width: row.width, frame: row.frame, selector: row.selector, status: 'captured', motionKey: motionKey(row)}));
  return {manifest, motion, reduced, strips};
}
const check = (f: ReturnType<typeof fixture>) => verifyCaptureOutputs(f.manifest, f.motion, f.reduced, f.strips);

describe('capture output verification', () => {
  it('includes the primary WO-5 desktop width without dropping existing widths', () => {
    expect(captureWidths).toEqual([375, 768, 1024, 1440]);
  });
  it('does not click ready-only controls while capturing an unresolved App or terminal',()=>{
    for(const id of ['terminal-excerpts','conversation-find'])expect(screens.find(screen=>screen.id===id)!.states.loading.steps).toEqual([]);
    expect(screens.find(screen=>screen.id==='conversation-find')!.states.error.steps).toEqual([]);
  });
  it('accepts complete output with captured, identical, and justified skipped cells', () => {
    const f = fixture(['plugin-frame', 'side-chat']);
    f.manifest.entries[0] = {...f.manifest.entries[0], status: 'identical-to-default'};
    f.manifest.entries[1] = {...f.manifest.entries[1], status: 'skipped', code: 'U', reason: 'No distinct empty inventory.'};
    expect(check(f)).toEqual([]);
    expect(captureExitCode(f.manifest.entries, f.strips, check(f))).toBe(0);
  });

  it.each(requiredOutputScreenIds)('detects a missing state/width cell for %s', screen => {
    const f = fixture([screen]);
    f.manifest.entries = f.manifest.entries.filter(row => row.state !== 'loading' || row.width !== 1440);
    const errors = check(f);
    expect(errors).toEqual([expect.stringContaining(`${screen}/loading/1440`)]);
    expect(captureExitCode([], [], errors)).toBe(1);
  });

  it.each(keyStates)('checks %s at every required width', state => {
    for (const width of captureWidths) {
      const f = fixture(['side-chat']);
      f.manifest.entries = f.manifest.entries.filter(row => row.state !== state || row.width !== width);
      expect(check(f)).toEqual([expect.stringContaining(`side-chat/${state}/${width}`)]);
    }
  });

  it('does not let reduced-only or duplicate entries hide a missing normal cell', () => {
    const f = fixture(['side-chat']);
    f.manifest.entries[0] = {...f.manifest.entries[0], reduced: true};
    f.manifest.entries.push({...f.manifest.entries[1]});
    expect(check(f)).toEqual([expect.stringContaining('side-chat/default/375')]);
  });

  it.each([undefined, '', '  \n '])('rejects a skip without a meaningful reason: %j', reason => {
    const f = fixture(['side-chat']);
    f.manifest.entries[0] = {...f.manifest.entries[0], status: 'skipped', code: 'U', reason};
    expect(check(f)).toEqual([expect.stringContaining('side-chat/default/375')]);
    expect(captureExitCode(f.manifest.entries, f.strips, check(f))).toBe(1);
  });

  it('rejects an unrecognized outcome and cannot be bypassed by removing a manifest width', () => {
    const f = fixture(['side-chat']);
    f.manifest.entries[0] = {...f.manifest.entries[0], status: 'failed', reason: 'Screenshot failed'};
    f.manifest.widths = [375, 768];
    f.manifest.entries = f.manifest.entries.filter(row => row.width !== 1440);
    const errors = check(f);
    expect(errors).toContainEqual(expect.stringContaining('side-chat/default/375'));
    expect(errors).toContainEqual(expect.stringContaining('manifest.widths'));
    expect(errors.filter(error => error.includes('/1440'))).toHaveLength(7);
  });

  it('fails when plugin motion contains only main-frame rows', () => {
    const f = fixture();
    f.motion = [{...iframe, frame: 'main'}];
    f.strips = [];
    expect(check(f)).toContainEqual(expect.stringContaining('motion.json'));
  });

  it.each(['main', '', undefined])('does not accept an invalid iframe tag: %j', frame => {
    const f = fixture();
    f.motion = [{...iframe, frame} as Motion];
    f.strips = [];
    expect(check(f)).toContainEqual(expect.stringContaining('motion.json'));
  });

  it.each(['absent', 'main', 'skipped'])('requires a captured iframe strip (%s)', mode => {
    const f = fixture();
    f.strips = mode === 'absent' ? [] : [{...f.strips[0], frame: mode === 'main' ? 'main' : iframe.frame, status: mode === 'skipped' ? 'skipped' : 'captured'}];
    expect(check(f)).toContainEqual(expect.stringContaining('captured iframe strip'));
  });

  it.each(['absent', 'main'])('requires iframe reduced-motion records (%s)', mode => {
    const f = fixture();
    f.reduced = {records: mode === 'absent' ? [] : [{...iframe, frame: 'main'}], offenders: []};
    expect(check(f)).toContainEqual(expect.stringContaining('reduced-motion.json records'));
  });

  it('requires each running reduced-motion record in offenders, including its frame, state and width', () => {
    for (const offender of [undefined, {...iframe, frame: 'main'}, {...iframe, state: 'hover'}, {...iframe, width: 768}]) {
      const f = fixture();
      f.reduced.offenders = offender ? [offender] : [];
      expect(check(f)).toContainEqual(expect.stringContaining('reduced-motion.json offenders'));
    }
  });

  it('allows effectively instant iframe records without treating them as offenders', () => {
    const f = fixture();
    f.reduced = {records: [{...iframe, duration: 1}], offenders: []};
    expect(check(f)).toEqual([]);
  });

  it('ignores out-of-scope screens and retains strip correspondence checks', () => {
    expect(check(fixture(['workspace']))).toEqual([]);
    const f = fixture();
    f.strips[0] = {...f.strips[0], motionKey: 'missing'};
    expect(check(f)).toContainEqual(expect.stringContaining('no corresponding motion record'));
  });
});

it('keeps a plugin iframe slot inside the strip cap, even when earlier screens use the budget', () => {
  expect(canCaptureStrip(59, 60, true, false)).toBe(false);
  expect(canCaptureStrip(59, 60, true, true)).toBe(true);
  expect(canCaptureStrip(60, 60, false, true)).toBe(false);
  expect(canCaptureStrip(59, 60, false, false)).toBe(true);
  expect(canCaptureStrip(0, 1, true, false)).toBe(false);
  expect(canCaptureStrip(0, 1, true, true)).toBe(true);
  expect(canCaptureStrip(0, 0, true, true)).toBe(false);
});

it('renders frame-tagged reduced-motion rows even when no iframe animation remains an offender', () => {
  const markdown = reducedMotionMarkdown({records: [{...iframe, duration: 1}], offenders: []});
  expect(markdown).toContain('## Offenders');
  expect(markdown).toContain('## All recorded animations');
  expect(markdown).toContain(' | frame | ');
  expect(markdown).toContain(iframe.frame);
  expect(reducedMotionMarkdown({records: [iframe], offenders: [iframe]}).split(iframe.frame)).toHaveLength(3);
});
