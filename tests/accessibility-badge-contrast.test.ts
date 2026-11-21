import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	WCAG,
	contrast,
	evaluateColor,
	resolveTokens,
	themeTokens,
} from '../scripts/theme-contrast.ts';

const styles = readFileSync(
	new URL('../apps/web/src/styles.css', import.meta.url),
	'utf8',
);
const base = themeTokens(styles, ':root');
const dark = themeTokens(styles, ':root[data-theme="dark"]');
const semantic = themeTokens(styles, ':root');
const semanticDark = themeTokens(
	styles,
	':root[data-theme="dark"]',
);

const themes = {
	light: { ...resolveTokens(base), ...resolveTokens(semantic, base) },
	dark: {
		...resolveTokens(base),
		...resolveTokens(dark),
		...resolveTokens(semanticDark, { ...resolveTokens(base), ...resolveTokens(dark) }),
	},
};

const pairs: [string, string][] = [
	['critical', 'danger-fg|danger-bg'],
	['serious', 'warning-fg|warning-bg'],
	['moderate', 'accent-fg|accent-bg'],
	['minor', 'muted|subtle'],
];

describe('a11y badge contrast (DESIGN §8.2)', () => {
	for (const [name, tokens] of Object.entries(themes)) {
		for (const [impact, pair] of pairs) {
			const [fg, bg] = pair.split('|');
			it(`${impact} badge meets ${WCAG.text}:1 in ${name}`, () => {
				const foreground = evaluateColor(`var(--${fg})`, tokens);
				const background = evaluateColor(`var(--${bg})`, tokens);
				expect(foreground, `--${fg}`).toBeTruthy();
				expect(background, `--${bg}`).toBeTruthy();
				expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(
					WCAG.text,
				);
			});
		}
	}
});
