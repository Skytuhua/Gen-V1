import {basename,dirname,isAbsolute,join,parse,relative,resolve,sep} from 'node:path';
import {constants,lstatSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {lstat,mkdir,open,realpath,type FileHandle} from 'node:fs/promises';
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
  if (result.out) captureOutputPath(result.out);
  return result;
}
// Resolve the nearest existing ancestor before creating any output directories.
export function captureOutputPath(path:string):string {
  const out=resolve(path),inside=(value:string,root:string)=>{const part=relative(root,value);return !part||!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
  const cwd=realpathSync('.'),roots=[realpathSync(tmpdir()),resolve(cwd,'tmp'),resolve(cwd,'test-results')];
  if (![tmpdir(),resolve('tmp'),resolve('test-results'),...roots].some(root=>inside(out,root))) throw Error('Capture output must be inside tmp or test-results; copy evidence separately.');
  let parent=out;const missing:string[]=[];
  for (;;) {
    try { lstatSync(parent);break; }
    catch(cause) { if((cause as NodeJS.ErrnoException).code!=='ENOENT')throw cause;missing.unshift(basename(parent));const next=dirname(parent);if(next===parent)throw cause;parent=next; }
  }
  let actual:string;
  try { actual=resolve(realpathSync(parent),...missing); }
  catch { throw Error('Capture output has an unresolved symlink or ancestor.'); }
  if(!roots.some(root=>inside(actual,root)))throw Error('Capture output symlink escapes tmp or test-results; copy evidence separately.');
  return actual;
}
const sameCapturePath=(left:string,right:string)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
async function checkedCaptureDirectory(path:string) {
  let current=parse(path).root,info=await lstat(current,{bigint:true});
  for(const part of relative(current,path).split(sep).filter(Boolean)){
    current=join(current,part);info=await lstat(current,{bigint:true});
    if(info.isSymbolicLink()||!info.isDirectory())throw Error('Capture output contains a symlink or non-directory component.');
  }
  if(!sameCapturePath(await realpath(path),path))throw Error('Capture output directory changed.');
  return info;
}
// Playwright returns bytes; only this helper opens output files, never a renderer.
export async function writeCaptureFile(root:string,path:string,data:string|Uint8Array):Promise<void> {
  root=resolve(root);const destination=resolve(root,path),within=relative(root,destination);
  if(!within||isAbsolute(path)||isAbsolute(within)||within==='..'||within.startsWith('..'+sep))throw Error('Capture output file escapes its root.');
  if(!sameCapturePath(captureOutputPath(root),root))throw Error('Capture output root changed.');
  const rootInfo=await checkedCaptureDirectory(root),handles:FileHandle[]=[];
  const nofollow=process.platform==='win32'?0:constants.O_NOFOLLOW??0;
  let directory:FileHandle|undefined,parent=root;
  const checkDirectory=async()=>{
    const info=await checkedCaptureDirectory(parent);
    if(directory){
      const opened=await directory.stat({bigint:true});
      if(opened.dev!==info.dev||opened.ino!==info.ino||!sameCapturePath(await realpath(`/proc/self/fd/${directory.fd}`),parent))throw Error('Capture output directory changed after open.');
    }
  };
  try {
    if(process.platform==='linux'){
      directory=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|nofollow);handles.push(directory);
      const opened=await directory.stat({bigint:true});
      if(opened.dev!==rootInfo.dev||opened.ino!==rootInfo.ino)throw Error('Capture output root changed after open.');
    }
    await checkDirectory();
    for(const part of relative(root,dirname(destination)).split(sep).filter(Boolean)){
      // Linux resolves each next component through the verified parent descriptor.
      const next=directory?`/proc/self/fd/${directory.fd}/${part}`:join(parent,part);
      try {await mkdir(next);}catch(cause){if((cause as NodeJS.ErrnoException).code!=='EEXIST')throw cause;}
      if(directory){directory=await open(next,constants.O_RDONLY|constants.O_DIRECTORY|nofollow);handles.push(directory);}
      parent=join(parent,part);await checkDirectory();
    }
    await checkDirectory();
    const file=await open(directory?`/proc/self/fd/${directory.fd}/${basename(destination)}`:destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|nofollow,0o600);handles.push(file);
    // Windows lacks O_NOFOLLOW: check every component again and match the opened fd.
    await checkDirectory();
    const actual=await realpath(destination),named=await lstat(destination,{bigint:true}),opened=await file.stat({bigint:true});
    if(!sameCapturePath(actual,destination)||named.isSymbolicLink()||!opened.isFile()||opened.nlink!==1n||opened.dev!==named.dev||opened.ino!==named.ino)throw Error('Capture output file changed after open.');
    if(process.platform==='linux'&&!sameCapturePath(await realpath(`/proc/self/fd/${file.fd}`),destination))throw Error('Capture output descriptor escaped its root.');
    await file.writeFile(data);
    await checkDirectory();
    const final=await lstat(destination,{bigint:true});
    if(final.isSymbolicLink()||final.dev!==opened.dev||final.ino!==opened.ino)throw Error('Capture output changed during the descriptor write.');
  } finally {await Promise.all(handles.reverse().map(handle=>handle.close()));}
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
