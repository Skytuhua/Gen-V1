/**
 * Static reduced-motion audit for the workspace stylesheets.
 *
 * Every declaration that moves something — a transform, size or inset transition, any
 * keyframe animation, smooth scrolling — needs a `prefers-reduced-motion: reduce` path
 * in the same stylesheet, or an allowlist entry naming the mechanism that covers it
 * instead. The app-wide duration clamp in `apps/web/src/styles.css` is not accepted as
 * that path: it shortens a movement to `.01ms` but still applies the transform for a
 * frame, and `packages/ui-shell` consumers load their own sheets without the app.
 */
export type Declaration = [property: string, value: string];
export interface Ruleset { file: string; context: string[]; selector: string; line: number; declarations: Declaration[] }

/** Geometry a reduced-motion user should not watch travel. Paint and opacity are fades, not motion. */
const geometric = /^(?:transform|translate|scale|rotate|width|height|min-width|max-width|min-height|max-height|block-size|inline-size|min-block-size|max-block-size|min-inline-size|max-inline-size|top|right|bottom|left|inset|inset-block|inset-block-start|inset-block-end|inset-inline|inset-inline-start|inset-inline-end|margin|margin-block|margin-inline|margin-top|margin-right|margin-bottom|margin-left|padding|padding-block|padding-inline|padding-top|padding-right|padding-bottom|padding-left|flex-basis|flex-grow|grid-template-columns|grid-template-rows|gap|column-gap|row-gap|offset|offset-path|offset-distance|clip-path|filter|backdrop-filter)$/;
const reduceContext = (context: string[]) => context.some(entry => /prefers-reduced-motion\s*:\s*reduce/.test(entry.replace(/\s+/g, ' ')));
const skipContext = (context: string[]) => context.some(entry => /prefers-reduced-motion\s*:\s*no-preference/.test(entry));

/** Splits on top-level separators only, so `:is(a, b)` and `var(--a, b)` survive. */
function splitTop(value: string, separator: string): string[] {
  const parts: string[] = []; let depth = 0, start = 0, quote = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) { if (character === '\\') index++; else if (character === quote) quote = ''; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
    else if (character === separator && !depth) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  parts.push(value.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

/** Tolerant reader: comments are blanked first so braces and colons inside them never count. */
export function parseStylesheets(sources: Record<string, string>): Ruleset[] {
  const rulesets: Ruleset[] = [];
  for (const [file, source] of Object.entries(sources)) {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '));
    let index = 0, line = 1;
    const advance = (count: number) => { for (; count > 0 && index < text.length; index++, count--) if (text[index] === '\n') line++; };
    const skipString = (quote: string) => { advance(1); while (index < text.length && text[index] !== quote) { if (text[index] === '\\') advance(1); advance(1); } advance(1); };
    const skipParens = () => { const open = text[index], close = open === '(' ? ')' : ']'; advance(1); let depth = 1; while (index < text.length && depth) { const character = text[index]; if (character === '"' || character === "'") { skipString(character); continue; } if (character === open) depth++; else if (character === close) depth--; advance(1); } };
    const readUntil = (stop: string) => {
      const at = line; let value = '';
      while (index < text.length) {
        const character = text[index];
        if (character === '"' || character === "'") { const from = index; skipString(character); value += text.slice(from, index); continue; }
        if (character === '(' || character === '[') { const from = index; skipParens(); value += text.slice(from, index); continue; }
        if (character === stop) { advance(1); return { value: value.trim(), line: at }; }
        if (character === '{' || character === '}') return { value: value.trim(), line: at };
        value += character; advance(1);
      }
      return { value: value.trim(), line: at };
    };
    const readDeclarations = (): Declaration[] => {
      const declarations: Declaration[] = [];
      while (index < text.length) {
        if (text[index] === '}') { advance(1); return declarations; }
        const { value } = readUntil(';');
        const colon = value.indexOf(':');
        if (colon > 0) declarations.push([value.slice(0, colon).trim().toLowerCase(), value.slice(colon + 1).trim().replace(/\s*!important$/i, '')]);
        if (text[index - 1] === '}') return declarations;
      }
      return declarations;
    };
    const readRules = (context: string[]) => {
      while (index < text.length) {
        while (index < text.length && /[\s;]/.test(text[index])) advance(1);
        if (index >= text.length) return;
        if (text[index] === '}') { advance(1); return; }
        const head = readUntil('{');
        const opens = text[index - 1] === '{';
        if (!head.value) { if (!opens) return; continue; }
        if (head.value.startsWith('@')) {
          const name = head.value.match(/^@([\w-]+)/)?.[1].toLowerCase() ?? '';
          if (/keyframes$/.test(name)) { let depth = 1; while (index < text.length && depth) { if (text[index] === '{') depth++; else if (text[index] === '}') depth--; advance(1); } continue; }
          if (/^(?:font-face|property|page|counter-style)$/.test(name)) { if (opens) readDeclarations(); continue; }
          if (opens) readRules([...context, head.value]);
          continue;
        }
        if (opens) rulesets.push({ file, context, selector: head.value, line: head.line, declarations: readDeclarations() });
      }
    };
    readRules([]);
  }
  return rulesets;
}

/** Class, id, type and attribute tokens, with combinators split off. */
function tokens(selector: string, rightmostOnly: boolean): Set<string> {
  const compounds = splitCompound(selector);
  const selected = rightmostOnly ? compounds.slice(-1) : compounds;
  const found = new Set<string>();
  for (const compound of selected) for (const match of compound.matchAll(/(?:[.#][\w-]+)|(?:\[[^\]]+\])|(?:^[a-z][\w-]*)/gi)) found.add(match[0].replace(/\s+/g, '').replace(/\s*=\s*(?:"[^"]*"|'[^']*'|[^\]]*)/, '').toLowerCase());
  return found;
}
function splitCompound(selector: string): string[] {
  const parts: string[] = []; let depth = 0, start = 0;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
    else if (!depth && /[\s>+~]/.test(character)) { if (selector.slice(start, index).trim()) parts.push(selector.slice(start, index).trim()); start = index + 1; }
  }
  if (selector.slice(start).trim()) parts.push(selector.slice(start).trim());
  return parts;
}
const normalize = (selector: string) => selector.replace(/:where\(|:is\(/g, '(').replace(/\s+/g, ' ').replace(/\s*([>+~])\s*/g, '$1').trim();

function motions(declarations: Declaration[]): Declaration[] {
  return declarations.filter(([property, value]) => {
    if (property === 'transition' || property === 'transition-property') {
      return splitTop(value, ',').some(entry => {
        const [target, ...timing] = entry.split(/\s+/);
        const durations = timing.filter(token => /^-?[\d.]+m?s$/.test(token));
        return geometric.test(target.toLowerCase()) && !(durations.length && durations.every(token => parseFloat(token) === 0));
      });
    }
    if (property === 'animation' || property === 'animation-name') return !/^(?:none|initial|unset)$/i.test(value);
    return property === 'scroll-behavior' && value === 'smooth';
  });
}

/** A reduce selector reaches a motion selector when it matches the same element or a narrower one. */
function sameElement(motionSelector: string, reduceSelector: string): boolean {
  if (normalize(motionSelector) === normalize(reduceSelector)) return true;
  const reduceKeys = tokens(reduceSelector, false), motionKeys = tokens(motionSelector, false);
  if (!reduceKeys.size) return false;
  for (const key of reduceKeys) if (!motionKeys.has(key)) return false;
  for (const key of tokens(motionSelector, true)) if (!key.startsWith('[') && !reduceKeys.has(key)) return false;
  return true;
}
/** `:is()`/`:where()` lists are unions: every alternative is a selector a rule can match on its own. */
function alternatives(selector: string, depth = 0): string[] {
  if (depth > 4) return [selector];
  const parts = splitTop(selector, ',');
  if (parts.length > 1) return parts.flatMap(part => alternatives(part, depth));
  const group = selector.match(/:(?:is|where)\(/);
  if (!group) return [selector];
  let index = (group.index ?? 0) + group[0].length, nesting = 1, start = index;
  for (; index < selector.length && nesting; index++) { const character = selector[index]; if (character === '(') nesting++; else if (character === ')') nesting--; }
  const body = selector.slice(start, index - 1);
  return splitTop(body, ',').flatMap(part => alternatives(selector.slice(0, group.index) + part + selector.slice(index), depth + 1));
}
/** Which motion families a reduce declaration neutralizes. */
function neutralizesFor(declared: Declaration[]): Set<'transition' | 'animation' | 'transform' | 'scroll' | 'hidden'> {
  const families = new Set<'transition' | 'animation' | 'transform' | 'scroll' | 'hidden'>();
  for (const [property, value] of declared) {
    if (/^(?:transition|transition-property|transition-duration)$/.test(property)) families.add('transition');
    if (/^(?:animation|animation-name|animation-duration|animation-iteration-count|animation-play-state)$/.test(property)) families.add('animation');
    if (/^(?:transform|translate|scale|rotate)$/.test(property)) families.add('transform');
    if (property === 'scroll-behavior') families.add('scroll');
    if ((property === 'display' && value === 'none') || (property === 'visibility' && /^(?:hidden|collapse)$/.test(value))) families.add('hidden');
  }
  return families;
}
const motionFamilies = (declarations: Declaration[]): Set<'transition' | 'animation' | 'transform' | 'scroll'> => {
  const families = new Set<'transition' | 'animation' | 'transform' | 'scroll'>();
  for (const [property, value] of motions(declarations)) {
    if (property === 'scroll-behavior') families.add('scroll');
    else if (/^animation/.test(property)) families.add('animation');
    else families.add('transition');
    if (property === 'transition' || property === 'transition-property') if (splitTop(value, ',').some(entry => /^(?:transform|translate|scale|rotate)$/.test(entry.split(/\s+/)[0]))) families.add('transform');
  }
  return families;
};

export interface MotionGap { file: string; line: number; selector: string; declared: string }
/** Stylesheets whose motion this check owns; vendored sheets and test fixtures are out of scope. */
export const stylesheetRoots = ['apps/web/src', 'packages/ui-shell', 'plugins'] as const;
export const isWorkspaceStylesheet = (path: string) => /\.css$/.test(path) && stylesheetRoots.some(root => path.startsWith(root + '/'));

/**
 * Every entry is a surface whose reduced-motion path lives somewhere a static scan cannot
 * follow, with the mechanism spelled out. `selector: '*'` allows a whole stylesheet.
 */
export const reducedMotionAllowlist: { file: string; selector: string; reason: string }[] = [
  { file: 'apps/web/src/plan-timeline/timeline.css', selector: '*',
    reason: 'The `.plan-status *` block at the end of this stylesheet already sets transition and animation to none for the whole plan surface; a static selector scan cannot resolve that container scope.' },
  { file: 'apps/web/src/sentence-reveal.css', selector: '.sentence-reveal-edge',
    reason: 'The reduced-motion block removes the parent `.sentence-reveal-layer` with display:none, so the edge animation can never run.' },
];

const allows = (gap: MotionGap, allowlist: typeof reducedMotionAllowlist) => allowlist.some(entry => entry.file === gap.file
  && (entry.selector === '*' || alternatives(entry.selector).some(part => sameElement(gap.selector, part))));

/** Motion declarations with no in-file reduced-motion path, before the allowlist is applied. */
export function uncoveredMotion(rulesets: Ruleset[]): MotionGap[] {
  const reduce = rulesets.flatMap(entry => reduceContext(entry.context)
    ? alternatives(entry.selector).map(selector => ({ file: entry.file, selector, families: neutralizesFor(entry.declarations) }))
    : []).filter(entry => entry.families.size);
  const gaps: MotionGap[] = [];
  for (const rule of rulesets) {
    if (reduceContext(rule.context) || skipContext(rule.context)) continue;
    if (/^(:root|html)\[(?:data-motion|data-panel-animations)/.test(rule.selector)) continue;
    const declared = motions(rule.declarations);
    if (!declared.length) continue;
    const families = motionFamilies(rule.declarations);
    for (const selector of alternatives(rule.selector)) {
      const reached = reduce.some(entry => entry.file === rule.file && sameElement(selector, entry.selector)
        && (entry.families.has('hidden') || [...families].some(family => entry.families.has(family))));
      if (!reached) gaps.push({ file: rule.file, line: rule.line, selector, declared: declared.map(([property, value]) => `${property}:${value}`).join('; ') });
    }
  }
  return gaps;
}

export function scanReducedMotion(rulesets: Ruleset[], allowlist = reducedMotionAllowlist) {
  const gaps = uncoveredMotion(rulesets);
  const unexplained = gaps.filter(gap => !allows(gap, allowlist));
  return { gaps: unexplained, motionDeclarations: new Set(gaps.map(gap => `${gap.file}:${gap.line}`)).size, allowlisted: gaps.length - unexplained.length };
}
