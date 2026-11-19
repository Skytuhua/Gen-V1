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
const sources: Record<string, string> = {};
for (const path of ['apps/web/src', 'packages/ui-shell', 'plugins'].flatMap(files)) if (isWorkspaceStylesheet(path)) sources[path] = readFileSync(join(root, path), 'utf8');
const parsed = parseStylesheets(sources);
const report = (gaps: {file: string; line: number; selector: string; declared: string}[]) => gaps.map(gap => `${gap.file}:${gap.line} ${gap.selector} — ${gap.declared}`);
const gaps = (css: string) => uncoveredMotion(parseStylesheets({'fixture.css': css})).map(gap => gap.selector);

describe('reduced-motion coverage', () => {
  it('reads every workspace stylesheet', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(Object.keys(sources)).toContain('apps/web/src/shell.css');
    expect(Object.keys(sources)).toContain('packages/ui-shell/tokens.css');
  });
  it('finds a reduced-motion path for every motion declaration', () => {
    expect(report(scanReducedMotion(parsed).gaps)).toEqual([]);
  });
  it('flags motion that arrives without a reduced-motion path', () => {
    expect(gaps('@keyframes slide { to { transform:translateX(8px); } } .panel { animation:slide 200ms var(--ease); }')).toEqual(['.panel']);
    expect(gaps('.drawer { transition:transform 200ms ease; }')).toEqual(['.drawer']);
    expect(gaps('.drawer { transition:transform 200ms ease, opacity 200ms ease; }')).toEqual(['.drawer']);
    expect(gaps('.bar { transition:width 320ms ease; }')).toEqual(['.bar']);
    expect(gaps('.bar { transition:all 200ms ease; }')).toEqual(['.bar']);
    expect(gaps('html { scroll-behavior:smooth; }')).toEqual(['html']);
  });
  it('does not accept a slowed or renamed animation as a path', () => {
    const moving = '@keyframes slide { to { transform:translateX(8px); } } ';
    expect(gaps(`${moving}.panel { animation:slide 200ms ease; } @media (prefers-reduced-motion: reduce) { .panel { animation-duration:5s; } }`)).toEqual(['.panel']);
    expect(gaps(`${moving}@keyframes slide-long { to { transform:translateX(40px); } } .panel { animation:slide 200ms ease; } @media (prefers-reduced-motion: reduce) { .panel { animation-name:slide-long; } }`)).toEqual(['.panel']);
    expect(gaps('.bar { transition:width 320ms ease; } @media (prefers-reduced-motion: reduce) { .bar { transition-duration:60ms; } }')).toEqual(['.bar']);
    expect(gaps('.panel { animation:slide 200ms ease infinite; } @media (prefers-reduced-motion: reduce) { .panel { animation-iteration-count:1; } }')).toEqual(['.panel']);
  });
  it('accepts the neutralizations that actually stop the movement', () => {
    const moving = '@keyframes slide { to { transform:translateX(8px); } } @keyframes fade { from { opacity:0; } } ';
    expect(gaps(`${moving}.panel { animation:slide 200ms ease; } @media (prefers-reduced-motion: reduce) { .panel { animation:none; } }`)).toEqual([]);
    expect(gaps(`${moving}.panel { animation:slide 200ms ease; } @media (prefers-reduced-motion: reduce) { .panel { animation-name:fade; } }`)).toEqual([]);
    expect(gaps(`${moving}.panel { animation:slide 200ms ease infinite; } @media (prefers-reduced-motion: reduce) { .panel { animation-play-state:paused; } }`)).toEqual([]);
    expect(gaps(`${moving}.panel { animation:slide 200ms ease; } @media (prefers-reduced-motion: reduce) { .panel { animation-duration:1ms !important; } }`)).toEqual([]);
    expect(gaps('.drawer { transition:transform 200ms ease, opacity 200ms ease; } @media (prefers-reduced-motion: reduce) { .drawer { transition:opacity 200ms ease; } }')).toEqual([]);
    expect(gaps('.drawer { transition:transform 200ms ease; } @media (prefers-reduced-motion: reduce) { .drawer { transition:none; } }')).toEqual([]);
    expect(gaps('.drawer[data-state=open] { animation:ui-drawer-in 180ms ease both; } @media (prefers-reduced-motion: reduce) { .drawer[data-state] { animation:none; } }')).toEqual([]);
    expect(gaps('.toggle { transition:transform 120ms ease; } @media (prefers-reduced-motion: reduce) { .toggle:active { transform:none; } }')).toEqual([]);
  });
  it('leaves fades, colour and zero-duration transitions alone', () => {
    expect(gaps('.notice { transition:opacity 200ms ease; }')).toEqual([]);
    expect(gaps('.link { transition:color 120ms ease, background-color 120ms ease; }')).toEqual([]);
    expect(gaps('.grid { transition:box-shadow 120ms ease; }')).toEqual([]);
    expect(gaps('.tool { transition:transform 0s var(--ease); }')).toEqual([]);
    expect(gaps('@keyframes fade { from { opacity:0; } } .tip { animation:fade 160ms ease; }')).toEqual([]);
    expect(gaps('.tool { animation:none; }')).toEqual([]);
  });
  it('keeps every allowlist entry necessary', () => {
    const found = uncoveredMotion(parsed);
    for (const entry of reducedMotionAllowlist) {
      expect(Object.keys(sources), entry.file).toContain(entry.file);
      expect(entry.reason.length, entry.file).toBeGreaterThan(40);
      expect(scanReducedMotion(parsed, reducedMotionAllowlist.filter(other => other !== entry)).gaps.length, entry.file).toBeGreaterThan(0);
    }
    expect(scanReducedMotion(parsed).allowlisted).toBe(found.length);
  });
});
