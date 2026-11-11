import { describe, expect, it } from 'vitest';
import { aggregate, parseArgs, normalizeMotion, isReducedOffender, motionKey, frameTag, paddedClip, type Motion, hasDistinctRecipe, imageStatus, coverageMatrix } from '../../scripts/capture-ui/helpers';
import { mapFile, screens, keyStates } from '../../scripts/capture-ui/screen-map';
const motion: Motion = { screen: 'workspace', state: 'default', width: 375, frame: 'main', selector: 'button', type: 'CSSAnimation', animationName: 'enter', transitionProperty: '', properties: ['opacity', 'transform', 'opacity'], duration: 100, delay: 0, easing: 'ease', iterations: 1, fill: 'both', keyframes: [] };
it('tags nested frames without volatile server ports or query parameters', () => {
  expect(frameTag([], 'http://localhost:123/')).toBe('main');
  expect(frameTag([0, 1], 'http://localhost:123/plugins/tools?nonce=123')).toBe('frame:0.1 /plugins/tools');
  expect(frameTag([0, 1], 'http://localhost:987/plugins/tools?nonce=456')).toBe('frame:0.1 /plugins/tools');
});
it('clips translated frame bounds to the main viewport, retaining collapsed endpoints', () => {
  expect(paddedClip({x: 90, y: 40, width: 30, height: 0}, {width:100, height:100})).toEqual({x:82, y:32, width:18, height:16});
  expect(paddedClip({x: -10, y: -10, width: 20, height: 20}, {width:100, height:100})).toEqual({x:0, y:0, width:18, height:18});
  expect(paddedClip({x:200, y:200, width:10, height:10}, {width:100, height:100})).toBeNull();
});
describe('file mapping', () => {
  it('accumulates shared matches and normalizes Windows paths', () => {
    expect(mapFile('apps\\web\\src\\App.tsx').screens).toContain('app-shell');
    expect(mapFile('packages/ui-shell/Modal.tsx').screens).toEqual(screens.map(s => s.id));
    expect(mapFile('apps/desktop/main.ts')).toMatchObject({ path: 'apps/desktop/main.ts', desktopOnly: true, screens: [], category: 'desktopOnly' });
    expect(mapFile('README.md').screens).toEqual([]);
  });
  it('maps every registered fixture to itself', () => { for (const s of screens.filter(s => s.fixture)) expect(mapFile(`tests/e2e/${s.fixture}`).screens).toContain(s.id); });
  it('declares default states and unique screen ids', () => { expect(new Set(screens.map(s => s.id)).size).toBe(screens.length); for (const s of screens) { expect(s.states.default).toBeDefined(); expect(Object.keys(s.states).every(k => keyStates.includes(k as typeof keyStates[number]))).toBe(true); } });
});
it('aggregates PR scope without losing provenance, unmapped or desktop files', () => {
  const pr = { number: 42, title: 'test', mergedAt: '2026-11-01', files: [{ path: 'apps/web/src/App.tsx' }, { path: 'apps/desktop/main.ts' }, { path: 'README.md' }] };
  const result = aggregate([pr, { ...pr, number: 43 }]);
  expect(result.screens).toEqual(['app-shell']); expect(result.unmapped).toEqual([]); expect(result.nonUi).toEqual(['README.md']); expect(result.desktopOnly).toEqual(['apps/desktop/main.ts']); expect(result.pulls[0].number).toBe(42); expect(aggregate([]).screens).toEqual([]);
});
it('normalizes motion and dedupes across widths but retains differing keyframes', () => {
  expect(normalizeMotion({ ...motion, iterations: Infinity }).iterations).toBe('Infinity');
  expect(normalizeMotion(motion).properties).toEqual(['opacity', 'transform']);
  expect(normalizeMotion({ ...motion, duration: NaN }).duration).toBe(0);
  expect(motionKey(motion)).toBe(motionKey({ ...motion, width: 1440 }));
  expect(motionKey(motion)).not.toBe(motionKey({ ...motion, keyframes: [{ opacity: 0 }] }));
});
it('filters reduced motion with a 1ms instant threshold', () => {
  expect(isReducedOffender(motion)).toBe(true); expect(isReducedOffender({ ...motion, duration: 1 })).toBe(false); expect(isReducedOffender({ ...motion, duration: 0 })).toBe(false); expect(isReducedOffender({ ...motion, iterations: 0 })).toBe(false);
});
describe('CLI', () => {
  it('defaults and supports pnpm separator, equals and separate values', () => {
    expect(parseArgs([])).toMatchObject({ scope: 'all', sinceDays: 30, maxStrips: 60 });
    expect(parseArgs(['--', '--scope=baseline', '--screens', 'files,plan', '--out=tmp', '--since-days=7', '--max-strips', '0'])).toEqual({ scope: 'baseline', screens: ['files', 'plan'], out: 'tmp', sinceDays: 7, maxStrips: 0 });
  });
  it('keeps capture output inside test-results or temporary directories', () => {
    for (const out of ['/tmp/wo5-final', 'tmp/wo5-final', 'test-results/wo5-final']) expect(parseArgs(['--out', out]).out).toBe(out);
    for (const out of [['/home/box', 'gen-company', 'ledger', 'WO-5/capture'].join('/'), 'test-results/../../ledger', '/home/box/screenshots']) expect(() => parseArgs(['--out', out])).toThrow('Capture output');
  });
  it.each([['--wat'], ['--scope=no'], ['--since-days=0'], ['--max-strips=-1'], ['--out'], ['--since-days=NaN']])('rejects invalid args %s', (...args) => expect(() => parseArgs(args)).toThrow());
});

describe('renderer classification', () => {
  it.each([
    ['apps/web/src/InboxView.tsx', 'inbox'],
    ['apps/web/src/RelationshipGraph.tsx', 'graph'],
    ['apps/web/src/SavedLayoutChooser.tsx', 'saved-layouts'],
    ['apps/web/src/App.tsx', 'app-shell'],
    ['apps/web/src/registry.tsx', 'generated-selects'],
  ])('maps %s to a reachable screen', (path, id) => expect(mapFile(path).screens).toContain(id));
  it('retains only justified native exclusions and reports missing browser coverage', () => {
    expect(mapFile('apps/web/src/DesktopBrowser.tsx')).toMatchObject({ category: 'excludedWebUi', attemptedRoute: expect.any(String) });
    expect(mapFile('apps/web/src/api.ts').category).toBe('nonUi');
    expect(mapFile('packages/ui-catalog/everyday.ts').category).toBe('nonUi');
    expect(mapFile('plugins/personal-visuals/src/frontend.tsx').screens).toContain('plugin-frame');
    expect(mapFile('apps/web/src/FutureRenderer.tsx').category).toBe('unmappedWebUi');
  });
  it.each(['tests/side-chat.test.ts', 'docs/ui.md', 'scripts/capture-ui/index.ts', 'apps/server/main.ts', 'packages/core/models.ts', 'python/worker.py', 'packages/ui-catalog/README.md'])('classifies %s as nonUi', path => expect(mapFile(path).category).toBe('nonUi'));
  it('preserves per-PR excluded reasons and deduplicates nonUi files', () => {
    const pr = { number: 1, title: 'UI change', mergedAt: '2026-11-01', files: [{path: 'apps/web/src/DesktopBrowser.tsx'}, {path: 'docs/readme.md'}] };
    const scope = aggregate([pr, {...pr, number: 2}]);
    expect(scope.excludedWebUi).toHaveLength(1); expect(scope.pulls[0].excludedWebUi[0].reason).toContain('WebContents'); expect(scope.nonUi).toEqual(['docs/readme.md']); expect(scope.unmapped).toEqual([]);
  });
});
it('rejects empty/unchanged recipes as distinct states', () => {
  expect(hasDistinctRecipe({})).toBe(false);
  expect(hasDistinctRecipe({query: 'primitives=1'}, {query: 'primitives=1'})).toBe(false);
  expect(hasDistinctRecipe({api: 'loading', hold: '^/api/bootstrap$'})).toBe(true);
  for (const screen of screens) for (const [state, recipe] of Object.entries(screen.states)) if (state !== 'default' && !recipe.skip) expect(hasDistinctRecipe(recipe, screen.states.default), `${screen.id}/${state}`).toBe(true);
});
it('marks equal images and does not count identical widths as captured in the matrix', () => {
  expect(imageStatus('same', 'same')).toBe('identical-to-default'); expect(imageStatus('a', 'b')).toBe('captured');
  const matrix = coverageMatrix(['controls'], [
    {screen: 'controls', state: 'hover', width: 375, status: 'identical-to-default', code: 'I'},
    {screen: 'controls', state: 'hover', width: 768, status: 'captured'},
    {screen: 'controls', state: 'loading', width: 375, status: 'skipped', code: 'U'},
  ]);
  expect(matrix[0].hover).toBe('768; I:375'); expect(matrix[0].loading).toBe('U:375');
});
