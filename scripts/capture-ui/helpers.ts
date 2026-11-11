import {resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import { mapFile, keyStates, type Recipe } from './screen-map';
export function parseArgs(args: string[]) {
  const result = { scope: 'all', sinceDays: 30, maxStrips: 60, screens: [] as string[], out: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') continue;
    const separator = args[i].indexOf('=');
    const key = separator < 0 ? args[i] : args[i].slice(0, separator);
    const inline = separator < 0 ? undefined : args[i].slice(separator + 1);
    if (!['--scope', '--since-days', '--max-strips', '--screens', '--out'].includes(key)) throw Error(`Unknown flag ${key}`);
    const value = inline ?? args[++i];
    if (!value || value.startsWith('--')) throw Error(`Missing value for ${key}`);
    if (key === '--scope') result.scope = value;
    if (key === '--since-days') result.sinceDays = Number(value);
    if (key === '--max-strips') result.maxStrips = Number(value);
    if (key === '--screens') result.screens = value.split(',').filter(Boolean);
    if (key === '--out') result.out = value;
  }
  if (!['diff', 'baseline', 'all'].includes(result.scope)) throw Error('Invalid scope');
  if (!Number.isInteger(result.sinceDays) || result.sinceDays < 1 || !Number.isInteger(result.maxStrips) || result.maxStrips < 0) throw Error('Invalid numeric flag');
  if (result.out) {
    const out = resolve(result.out);
    if (![tmpdir(), resolve('tmp'), resolve('test-results')].some(root => out === root || out.startsWith(root + sep))) throw Error('Capture output must be inside tmp or test-results; copy evidence separately.');
  }
  return result;
}
export type PullRequest = { number: number | null; title: string; mergedAt: string; files: { path: string }[] };
export function aggregate(prs: PullRequest[]) {
  const pulls = prs.map(pr => {
    const classifications = pr.files.map(f => mapFile(f.path));
    return { ...pr, classifications, screens: [...new Set(classifications.flatMap(f => f.screens))],
      unmapped: classifications.filter(f => f.category === 'unmappedWebUi').map(f => f.path), desktopOnly: classifications.filter(f => f.desktopOnly).map(f => f.path),
      excludedWebUi: classifications.filter(f => f.category === 'excludedWebUi').map(f => ({ path: f.path, reason: f.reason!, attemptedRoute: f.attemptedRoute ?? '' })),
      nonUi: classifications.filter(f => f.category === 'nonUi').map(f => f.path) };
  });
  const unique = [...new Map(pulls.flatMap(pr => pr.classifications).map(f => [f.path, f])).values()];
  return { pulls, screens: [...new Set(pulls.flatMap(pr => pr.screens))], unmapped: unique.filter(f => f.category === 'unmappedWebUi').map(f => f.path),
    desktopOnly: unique.filter(f => f.desktopOnly).map(f => f.path),
    excludedWebUi: unique.filter(f => f.category === 'excludedWebUi').map(f => ({ path: f.path, reason: f.reason!, attemptedRoute: f.attemptedRoute ?? '' })),
    nonUi: unique.filter(f => f.category === 'nonUi').map(f => f.path) };
}
export function hasDistinctRecipe(recipe: Recipe, defaultRecipe?: Recipe) {
  return Boolean(recipe.api || recipe.event || recipe.action || recipe.steps?.length || recipe.query && recipe.query !== defaultRecipe?.query);
}
export type CaptureEntry = { screen: string; state: string; width: number; status: string; reason?: string; code?: string; path?: string; hash?: string; heldRequests?: number; reduced?: boolean; loadFailure?: boolean; optional?: boolean; declaredSkip?: boolean };
export function imageStatus(defaultHash: string | undefined, hash: string) {
  return defaultHash === hash ? 'identical-to-default' : 'captured';
}
export function coverageMatrix(ids: string[], entries: CaptureEntry[]) {
  return ids.map(screen => Object.fromEntries([['screen', screen], ...keyStates.map(state => {
    const samples = entries.filter(e => e.screen === screen && e.state === state && !e.reduced);
    const captured = samples.filter(e => e.status === 'captured').map(e => e.width).sort((a,b) => a-b);
    const other = [...new Set(samples.filter(e => e.status !== 'captured').map(e => `${e.code ?? (e.status === 'identical-to-default' ? 'I' : 'F')}:${e.width}`))];
    return [state, [...(captured.length ? [captured.join(',')] : []), ...other].join('; ') || 'U'];
  })]));
}
export type Motion = { screen: string; state: string; width: number; frame: string; selector: string; type: string; animationName: string; transitionProperty: string; properties: string[]; duration: number; delay: number; easing: string; iterations: number | string; fill: string; keyframes: unknown[] };
export function frameTag(indices: readonly number[], url: string) {
  if (!indices.length) return 'main';
  const pathname = new URL(url).pathname;
  return `frame:${indices.join('.')} ${pathname}`;
}
export function paddedClip(box: {x: number; y: number; width: number; height: number}, viewport: {width: number; height: number}, padding = 8) {
  const x = Math.max(0, box.x - padding), y = Math.max(0, box.y - padding);
  const right = Math.min(viewport.width, box.x + box.width + padding), bottom = Math.min(viewport.height, box.y + box.height + padding);
  return right > x && bottom > y ? {x, y, width: right - x, height: bottom - y} : null;
}
export function normalizeMotion(record: Motion): Motion {
  return { ...record, properties: [...new Set(record.properties)].sort(), duration: Number.isFinite(Number(record.duration)) ? Math.max(0, Number(record.duration)) : 0, delay: Number(record.delay) || 0, iterations: record.iterations === Infinity ? 'Infinity' : record.iterations };
}
export function isReducedOffender(record: Motion) { return record.duration > 1 && (record.iterations === 'Infinity' || Number(record.iterations) > 0); }
export function motionKey(m: Motion) { return JSON.stringify([m.screen, m.frame, m.selector, m.type, m.animationName, m.transitionProperty, m.properties, m.duration, m.delay, m.easing, m.iterations, m.fill, m.keyframes]); }
export function table(rows: Record<string, unknown>[]) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => String(typeof v === 'object' ? JSON.stringify(v) : v ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
  return `| ${keys.join(' | ')} |\n| ${keys.map(() => '---').join(' | ')} |\n${rows.map(row => `| ${keys.map(k => cell(row[k])).join(' | ')} |`).join('\n')}\n`;
}
