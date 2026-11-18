import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isWorkspaceStylesheet, parseStylesheets, reducedMotionAllowlist, scanReducedMotion, uncoveredMotion} from '../scripts/reduced-motion-coverage';

const root = fileURLToPath(new URL('..', import.meta.url));
function files(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, folder), {withFileTypes: true})) {
    if (entry.isDirectory()) found.push(...files(`${folder}/${entry.name}`));
    else if (entry.name.endsWith('.css')) found.push(`${folder}/${entry.name}`);
  }
  return found;
}
function stylesheets(): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const path of ['apps/web/src', 'packages/ui-shell', 'plugins'].flatMap(files)) if (isWorkspaceStylesheet(path)) sources[path] = readFileSync(join(root, path), 'utf8');
  return sources;
}
const sources = stylesheets();
const rulesets = parseStylesheets(sources);
const report = (gaps: {file: string; line: number; selector: string; declared: string}[]) => gaps.map(gap => `${gap.file}:${gap.line} ${gap.selector} — ${gap.declared}`);

describe('reduced-motion coverage', () => {
  it('reads every workspace stylesheet', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain('apps/web/src/shell.css');
    expect(Object.keys(sources)).toContain('packages/ui-shell/tokens.css');
  });
  it('finds a reduced-motion path for every motion declaration', () => {
    expect(report(scanReducedMotion(rulesets).gaps)).toEqual([]);
  });
  it('flags motion that arrives without a reduced-motion path', () => {
    const gaps = (css: string) => uncoveredMotion(parseStylesheets({'fixture.css': css}));
    expect(gaps('@keyframes slide { to { transform:translateX(8px); } } .panel { animation:slide 200ms var(--ease); }').map(gap => gap.selector)).toEqual(['.panel']);
    expect(gaps('.drawer { transition:transform 200ms ease; }')).toHaveLength(1);
    expect(gaps('.drawer { transition:transform 200ms ease, opacity 200ms ease; }')).toHaveLength(1);
    expect(gaps('.bar { transition:width 320ms ease; }')).toHaveLength(1);
    expect(gaps('html { scroll-behavior:smooth; }')).toHaveLength(1);
    expect(gaps('.drawer { transition:transform 200ms ease; } @media (prefers-reduced-motion: reduce) { .drawer { transition:none; } }')).toEqual([]);
    expect(gaps('.drawer[data-state=open] { animation:ui-drawer-in 180ms ease both; } @media (prefers-reduced-motion: reduce) { .drawer[data-state] { animation:none; } }')).toEqual([]);
    expect(gaps('.toggle { transition:transform 120ms ease; } @media (prefers-reduced-motion: reduce) { .toggle:active { transform:none; } }')).toEqual([]);
    expect(gaps('.popover[data-state=closed] { animation:fade-out 160ms ease both; } @media (prefers-reduced-motion: reduce) { :where(.popover[data-state]) { animation-name:fade-in; } }')).toEqual([]);
  });
  it('leaves fades, colour and zero-duration transitions alone', () => {
    const gaps = (css: string) => uncoveredMotion(parseStylesheets({'fixture.css': css}));
    expect(gaps('.notice { transition:opacity 200ms ease; }')).toEqual([]);
    expect(gaps('.link { transition:color 120ms ease, background-color 120ms ease; }')).toEqual([]);
    expect(gaps('.grid { transition:box-shadow 120ms ease; }')).toEqual([]);
    expect(gaps('.tool { transition:transform 0s var(--ease); }')).toEqual([]);
    expect(gaps('.tool { animation:none; }')).toEqual([]);
  });
  it('keeps every allowlist entry necessary', () => {
    const gaps = uncoveredMotion(rulesets);
    for (const entry of reducedMotionAllowlist) {
      expect(Object.keys(sources), entry.file).toContain(entry.file);
      expect(entry.reason.length, entry.file).toBeGreaterThan(40);
      expect(scanReducedMotion(rulesets, reducedMotionAllowlist.filter(other => other !== entry)).gaps.length, entry.file).toBeGreaterThan(0);
    }
    expect(scanReducedMotion(rulesets).allowlisted).toBe(gaps.filter(gap => gap.file === 'apps/web/src/plan-timeline/timeline.css' || gap.file === 'apps/web/src/sentence-reveal.css').length);
  });
});
