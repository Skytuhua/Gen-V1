/**
 * Contrast primitives for the appearance themes.
 *
 * The audit reads the theme's own custom properties out of the stylesheets and
 * resolves them, so a token change moves the audit with it instead of aging it out.
 */
export type Tokens = Record<string, string>;

export const WCAG = { text: 4.5, nonText: 3 } as const;

const normalize = (selector: string) => selector.replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();

/** Declarations from every rule whose selector list contains `selector`, in file order. */
export function themeTokens(css: string, selector: string): Tokens {
  const target = normalize(selector), tokens: Tokens = {}, rules: { selectors: string[]; body: string }[] = [];
  let pending = '';
  for (const character of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (character === '{') { rules.push({ selectors: pending.split(',').map(normalize), body: '' }); pending = ''; }
    else if (character === '}') {
      const rule = rules.pop();
      if (rule?.selectors.includes(target)) for (const declaration of rule.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi)) tokens[declaration[1]!] = declaration[2]!.trim();
      pending = '';
    }
    else if (rules.length) rules.at(-1)!.body += character;
    else if (character === ';') pending = '';
    else pending += character;
  }
  return tokens;
}

export function requireTokens(tokens: Tokens, names: readonly string[]): Tokens {
  const missing = names.filter(name => tokens[name] === undefined);
  if (missing.length) throw Error(`Theme is missing tokens: ${missing.join(', ')}`);
  return tokens;
}

/** `var()` chains, including fallbacks; anything still unresolved is an error, not a silent skip. */
export function resolveTokens(overrides: Tokens, inherited: Tokens = {}): Tokens {
  const resolved: Tokens = { ...inherited }, pending = new Map(Object.entries(overrides));
  for (let pass = 0; pass <= pending.size; pass++) {
    let progress = false;
    for (const [name, value] of pending) {
      const expanded = expand(value, resolved);
      if (expanded === undefined) continue;
      resolved[name] = expanded;
      pending.delete(name);
      progress = true;
    }
    if (!progress) break;
  }
  if (pending.size) throw Error(`Unresolved theme tokens: ${[...pending].map(([name, value]) => `${name}:${value}`).join(', ')}`);
  return resolved;
}

function expand(value: string, scope: Tokens): string | undefined {
  const reference = /var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]*))?\)/i.exec(value);
  if (!reference) return value;
  const replacement = scope[reference[1]!] ?? reference[2];
  if (replacement === undefined) return undefined;
  return expand(value.slice(0, reference.index) + replacement + value.slice(reference.index + reference[0].length), scope);
}

function channels(color: string): number[] {
  const value = color.trim(), digits = /^#[0-9a-f]{3}$/i.test(value) ? value.slice(1).split('').map(digit => digit + digit).join('') : /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : undefined;
  if (!digits) throw Error(`Contrast needs a six-digit hex colour, not ${color}`);
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16));
}

/** WCAG relative luminance; sRGB transfer pinned to the 0.04045 knee the settings guard already uses. */
export function luminance(color: string): number {
  const linear = channels(color).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
}

export function contrast(foreground: string, background: string): number {
  const first = luminance(foreground), second = luminance(background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

/** `color-mix(in srgb, first weight%, second)`: the stylesheets own the formula, the audit owns its value. */
export function colorMix(value: string): string {
  const mixed = /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*(#[0-9a-f]{6})\)$/i.exec(value.replace(/\s+/g, ' ').trim());
  if (!mixed) throw Error(`The audit evaluates only color-mix(in srgb, <hex> <weight>%, <hex>), not ${value}`);
  const first = channels(mixed[1]!), second = channels(mixed[3]!), weight = Number(mixed[2]) / 100;
  return '#' + first.map((channel, index) => Math.round(channel * weight + second[index]! * (1 - weight)).toString(16).padStart(2, '0')).join('');
}

/** Mirrors the black-or-white ink the shell derives for an accent solid. */
export function accentInk(solid: string): string {
  return luminance(solid) > .179 ? '#000000' : '#FFFFFF';
}
