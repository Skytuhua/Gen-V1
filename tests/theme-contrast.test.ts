import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { WCAG, accentInk, colorMix, contrast, requireTokens, resolveTokens, themeTokens, type Tokens } from '../scripts/theme-contrast.ts';
import { PROJECT_ACCENT_INK, PROJECT_PALETTE, type ProjectAccent } from '../packages/contracts/preferences.ts';

// Every ratio below is derived from the stylesheets, so editing a token moves the audit.
const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const styles = source('apps/web/src/styles.css'), shell = source('apps/web/src/shell.css'), appearance = source('apps/web/src/appearance.css'), sidebar = source('apps/web/src/sidebar-context.css');

const REQUIRED = [
  '--canvas', '--sidebar', '--surface', '--subtle', '--hover', '--text', '--muted', '--placeholder',
  '--selection-bg', '--selection-ink', '--accent', '--accent-solid', '--accent-fg', '--accent-bg', '--accent-text',
  '--danger', '--danger-soft', '--danger-fg', '--danger-bg', '--pending', '--success', '--success-fg', '--success-bg',
  '--warning-fg', '--warning-bg', '--category-fg', '--category-bg',
] as const;

// Declarations stay unresolved until a context is known, so formulas such as --accent-text
// are evaluated against the theme they are painted in.
const RAW = {
  root: themeTokens(styles, ':root'),
  dark: themeTokens(styles, ':root[data-theme="dark"]'),
  high: themeTokens(shell, '.app-shell[data-contrast=high]'),
  'high dark': themeTokens(shell, ':root[data-theme=dark] .app-shell[data-contrast=high]'),
};
const shells = {
  light: RAW.root,
  'light high contrast': { ...RAW.root, ...RAW.high },
  dark: { ...RAW.root, ...RAW.dark },
  'dark high contrast': { ...RAW.root, ...RAW.dark, ...RAW['high dark'] },
} as const;
const ACCENT_RULES = { any: themeTokens(appearance, ':root[data-appearance-accent]'), dark: themeTokens(appearance, ':root[data-appearance-accent][data-theme=dark]') };
const accents = Object.keys(PROJECT_PALETTE) as ProjectAccent[];

/**
 * applyAppearance writes the chosen palette colour and its ink onto the root element and
 * appearance.css feeds those into the accent tokens; the audit reproduces exactly that.
 */
function themed(name: keyof typeof shells, accent: ProjectAccent): Tokens {
  const ink = PROJECT_ACCENT_INK[accent], runtime = { '--project-accent': PROJECT_PALETTE[accent], '--project-accent-ink': ink, '--accent-ink': accentInk(ink) };
  const tokens = requireTokens(resolveTokens({ ...shells[name], ...ACCENT_RULES.any, ...(name.startsWith('dark') ? ACCENT_RULES.dark : {}), ...runtime }), REQUIRED);
  return Object.fromEntries(Object.entries(tokens).map(([token, value]) => [token, value.startsWith('color-mix(') ? colorMix(value) : value]));
}

type Pair = { foreground: string; background: string; minimum: number; where: string };
const text = (foreground: string, background: string, where: string): Pair => ({ foreground, background, minimum: WCAG.text, where });
const nonText = (foreground: string, background: string, where: string): Pair => ({ foreground, background, minimum: WCAG.nonText, where });

const PAIRS: readonly Pair[] = [
  text('--text', '--canvas', 'conversation, dock and decision copy on the workspace canvas'),
  text('--text', '--sidebar', 'thread titles and settings navigation labels'),
  text('--text', '--surface', 'composer, dock cards and settings content'),
  text('--text', '--subtle', 'user message bubbles and inline code'),
  text('--text', '--hover', 'hovered thread rows, settings results and popup options'),
  text('--selection-ink', '--selection-bg', 'the selected settings destination and sidebar filter'),
  text('--muted', '--canvas', 'activity lines, empty states and composer captions'),
  text('--muted', '--sidebar', 'thread metadata, nav labels and sidebar footer'),
  text('--muted', '--surface', 'dock captions and quiet settings copy'),
  text('--muted', '--subtle', 'status pills and badges'),
  text('--muted', '--hover', 'thread metadata on a hovered or active row'),
  text('--muted', '--selection-bg', 'quiet copy on a selected row'),
  text('--placeholder', '--surface', 'input and composer placeholders'),
  text('--placeholder', '--canvas', 'search placeholders outside a card'),
  text('--accent-fg', '--canvas', 'links and verification triggers'),
  text('--accent-fg', '--surface', 'links inside dock cards and dialogs'),
  text('--accent-fg', '--subtle', 'links inside a message bubble'),
  text('--accent-fg', '--hover', 'a link inside a hovered row'),
  text('--accent-fg', '--selection-bg', 'a link inside a selected row'),
  text('--accent-fg', '--accent-bg', 'the working status chip'),
  text('--accent-text', '--canvas', 'the accent-tinted thread status text'),
  text('--accent-text', '--surface', 'accent-tinted status text on a card'),
  text('--accent-text', '--subtle', 'accent-tinted status text on a status pill'),
  text('--accent-text', '--hover', 'accent-tinted status text on a hovered row'),
  text('--accent-text', '--selection-bg', 'accent-tinted status text on a selected row'),
  text('--accent-ink', '--accent-solid', 'the primary button and send labels on their accent fill'),
  text('--danger', '--canvas', 'failed operation outcomes and error status'),
  text('--danger', '--surface', 'modal errors and the close mark'),
  text('--danger', '--subtle', 'composer and workspace error banners'),
  text('--danger', '--danger-soft', 'destructive controls on hover'),
  text('--danger-fg', '--danger-bg', 'removed diff lines'),
  text('--pending', '--canvas', 'connection state and pending decisions'),
  text('--pending', '--surface', 'dirty artifact state on a card'),
  text('--pending', '--subtle', 'the pending badge on a decision'),
  text('--pending', '--hover', 'the awaiting-input status on a hovered row'),
  text('--warning-fg', '--warning-bg', 'warning chips and notices'),
  text('--success-fg', '--success-bg', 'added diff lines and success chips'),
  text('--success', '--canvas', 'success ticks and tones'),
  text('--category-fg', '--category-bg', 'category chips'),
  nonText('--muted', '--canvas', 'the focus ring on the canvas'),
  nonText('--muted', '--surface', 'the focus ring on a card or dialog'),
  nonText('--muted', '--hover', 'the switch thumb and focus ring on a hovered row'),
  nonText('--pending', '--canvas', 'the pending dot beside a thread status'),
  nonText('--accent', '--selection-bg', 'the selected sidebar filter icon'),
];

function failures(tokens: Tokens): string[] {
  return PAIRS.flatMap(pair => {
    const ratio = contrast(tokens[pair.foreground]!, tokens[pair.background]!);
    return ratio + 1e-9 >= pair.minimum ? [] : [`${pair.foreground} on ${pair.background} is ${ratio.toFixed(2)}:1, needs ${pair.minimum}:1 — ${pair.where}`];
  });
}

const contexts = (Object.keys(shells) as (keyof typeof shells)[]).flatMap(name => accents.map(accent => ({ name: `${name} with the ${accent} accent`, tokens: themed(name, accent) })));

// The shell owns the tinted-accent formula; the audit owns the proof that any accent the
// settings accept stays readable, custom colours included.
const tint = /^color-mix\(in srgb, var\(--accent\) ([\d.]+)%, var\(--text\)\)$/.exec((themeTokens(styles, ':root')['--accent-text'] ?? '').replace(/\s+/g, ' '));
if (!tint) throw Error('--accent-text must stay a single color-mix of the accent with the theme text');
const weight = Number(tint[1]) / 100;
const SURFACES = ['--canvas', '--surface', '--subtle', '--hover', '--selection-bg'] as const;
const tinted = (accent: string, tokens: Tokens) => colorMix(`color-mix(in srgb, ${accent} ${weight * 100}%, ${tokens['--text']})`);

describe('appearance theme contrast audit', () => {
  it('reads the four shells the settings can produce out of the stylesheets', () => {
    for (const name of Object.keys(shells) as (keyof typeof shells)[]) for (const accent of accents) expect(themed(name, accent)).toBeDefined();
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(1);
  });

  it.each(contexts)('$name keeps every primary surface at AA', ({ tokens }) => {
    expect(failures(tokens)).toEqual([]);
  });

  it('paints the surfaces this audit covers with the tokens it measures', () => {
    expect(sidebar).toMatch(/\.sidebar \.thread-item-meta\[data-thread-state='working'\] \.thread-item-status \{\s*color: var\(--accent-text\)/);
    expect(styles).toMatch(/\.send-button \{[^}]*color:var\(--accent-ink,#fff\)/);
  });

  it('fails the pairs it would catch if a token regressed', () => {
    const broken = { ...contexts[0]!.tokens, '--muted': '#9a9a9a', '--danger': '#e0a0a8', '--accent-text': '#8a8a8a' };
    expect(failures(broken)).toEqual(expect.arrayContaining([
      expect.stringContaining('--muted on --hover'),
      expect.stringContaining('--muted on --canvas'),
      expect.stringContaining('--danger on --subtle'),
      expect.stringContaining('--accent-text on --hover'),
    ]));
  });

  it('keeps every custom accent the settings accept readable as text and as a fill', () => {
    const failures: string[] = [];
    for (let red = 0; red < 256; red += 8) for (let green = 0; green < 256; green += 8) for (let blue = 0; blue < 256; blue += 8) {
      const accent = '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
      // AppearanceSettings rejects the colours below 3:1 on either shell surface.
      if (Math.min(contrast(accent, '#0F0F0F'), contrast(accent, '#FFFFFF')) < WCAG.nonText) continue;
      for (const tokens of [themed('light', 'blue'), themed('dark', 'blue')]) {
        const value = tinted(accent, tokens);
        for (const surface of SURFACES) if (contrast(value, tokens[surface]!) < WCAG.text) failures.push(`${accent} tinted on ${surface}`);
        if (contrast(accentInk(accent), accent) < WCAG.text) failures.push(`${accentInk(accent)} on ${accent} as a primary fill`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
  });
});
