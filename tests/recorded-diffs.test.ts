import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecordedDiffs } from '../apps/web/src/WorkspacePanelBodies';
import { DEFAULT_PREFERENCES } from '../packages/contracts/preferences';

// T07/R10: display preferences govern recorded before/after comparisons only;
// unified source patches stay verbatim, and the viewer labels that scope.
const diffs = [
  { id: 'pair', title: 'Pair', before: 'alpha\n \nbeta', after: 'alpha\n\t\nbeta changed', provenance: 'Synthetic recorded comparison' },
  { id: 'unified', title: 'Repository diff', unified: '@@ -1 +1 @@\n-alpha\n+beta', provenance: 'executor; git diff; synthetic' },
];
const render = (patch: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(RecordedDiffs, { diffs, preferences: { ...DEFAULT_PREFERENCES, ...patch } }));

describe('recorded comparison display scope', () => {
  it('labels the preference scope and the verbatim unified exception', () => {
    const html = render();
    expect(html).toContain('Layout, whitespace and color preferences apply to recorded before/after comparisons.');
    expect(html).toContain('Unified source patches are shown verbatim.');
  });
  it('hideWhitespace removes whitespace-only and unchanged lines from the pair, never from unified patches', () => {
    const kept = render();
    expect(kept).toContain('alpha\n \nbeta');
    const hidden = render({ hideWhitespace: true });
    expect(hidden).toContain('<pre>beta</pre>');
    expect(hidden).toContain('<pre>beta changed</pre>');
    expect(hidden).toContain('@@ -1 +1 @@');
    expect(hidden).toContain('-alpha');
  });
  it('layout and color preferences reach the rendered comparison classes', () => {
    expect(render({ diffLayout: 'split' })).toContain('diff-split');
    expect(render({ diffLayout: 'stacked' })).not.toContain('diff-split');
    expect(render({ diffColors: 'blue-orange' })).toContain('diff-colors-blue-orange');
    expect(render()).toContain('diff-colors-red-green');
  });
});
