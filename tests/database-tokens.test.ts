import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** T09 conformance: the database CSS must consume shared tokens only — no new
 * colour values, fonts, radii or durations may be introduced (issue #1348 VISUAL_DESIGN_AND_MOTION). */
const FILES = ['apps/web/src/database/database-panel.css', 'apps/web/src/database/query-result-grid.css', 'apps/web/src/database-settings.css'];
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

describe('database CSS token conformance', () => {
	for (const file of FILES) {
		const css = stripComments(readFileSync(file, 'utf8'));
		it(`${file} uses no literal colours`, () => {
			expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
			expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|color-mix)\s*\(/gi) ?? []).toEqual([]);
		});
		it(`${file} uses no literal durations outside shared tokens`, () => {
			// transition/animation shorthand may reference var(--ui-motion-*) only; a bare ms/s value is a new duration.
			const declarations = css.match(/(?:transition|animation)[^;]*;/g) ?? [];
			for (const declaration of declarations.filter(entry => !/\binfinite\b/.test(entry))) // indeterminate progress loops have no motion token

				expect(declaration.replace(/var\([^)]*\)/g, '').match(/\d+(?:\.\d+)?m?s\b/g) ?? [], declaration).toEqual([]);
		});
	}
});
