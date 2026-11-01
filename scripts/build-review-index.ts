/** Static review handoff only. This CLI never starts the app, Pi, or a capture. */
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, CATALOG_VERSION } from '../packages/ui-catalog/index.ts';

type Json = Record<string, unknown>;
type Chapter = { title: string; startSeconds: number; endSeconds?: number };
type Capture = Json & { scenario: string; file: string; chapters?: Chapter[] };
type Asset = { file: string; href: string };
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const titles: Record<string, string> = { signing: 'Sign a local PDF', 'pr-dark': 'PR lifecycle · dark vertical graph', 'pr-light': 'PR lifecycle · light vertical graph', migration: 'Local SQLite migration', context: 'Fixture context telemetry and compaction', faq: 'Progressive questions and answers', map: 'Map and linked place comparison', catalog: 'Complete component catalog', shell: 'Workspace and settings' };
const references: Record<string, { file: string; recording: string; frame: string }> = {
  signing: { file: 'signing-18.png', recording: '15:47:28', frame: '18 s' },
  'pr-dark': { file: 'merge-16.png', recording: '15:46:41', frame: '16 s' },
  'pr-light': { file: 'merge-16.png', recording: '15:46:41', frame: '16 s · vertical reference for both themes' },
  migration: { file: 'migration-16.png', recording: '15:49:30', frame: '16 s' },
  context: { file: 'context-10.png', recording: '15:49:05', frame: '10 s' },
  faq: { file: 'faq-24.png', recording: '15:48:20', frame: '24 s' },
};
const authorizedReferenceNames = new Set(Object.values(references).map(reference => reference.file));
const within = (parent: string, path: string) => { const part = relative(parent, path); return part === '' || !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep); };
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export async function buildReviewIndex(input: string) {
  const folder = await realpath(resolve(input));
  const manifest = object(JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')));
  const warnings: string[] = [];
  const asset = async (name: unknown, extensions?: string[]): Promise<Asset | null> => {
    if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(name) || /[\u0000-\u001f]/.test(name)) return null;
    const path = resolve(folder, name);
    if (!within(folder, path) || extensions && !extensions.includes(extname(path).toLowerCase())) return null;
    try {
      if (!(await lstat(path)).isFile() || !within(folder, await realpath(path))) return null;
      const file = relative(folder, path).split(sep).join('/');
      return { file, href: file.split('/').map(encodeURIComponent).join('/') };
    } catch { return null; }
  };
  const captures = (value: unknown): Capture[] => list(value).map(item => {
    const capture = object(item);
    return { ...capture, scenario: string(capture.scenario, 'additional'), file: string(capture.file) } as Capture;
  });
  const genuine = object(manifest.genuinePi);
  const allCaptures: Capture[] = [...captures(manifest.captures), ...captures(Array.isArray(manifest.genuinePi) ? manifest.genuinePi : genuine.captures).map((capture): Capture => ({ ...capture, provenance: capture.provenance ?? 'genuine-pi' }))];
  const declaredFiles = new Set(allCaptures.map(capture => capture.file));
  const topLevel = (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
  for (const file of topLevel.filter(file => extname(file).toLowerCase() === '.mp4' && !declaredFiles.has(file))) {
    allCaptures.push({ scenario: 'additional', file, title: basename(file, extname(file)), provenance: 'unclassified' });
    warnings.push(`Unclassified MP4: ${file}. No model-generation or fixture claim is inferred from its filename.`);
  }
  const declaredCoverage = [...new Set(list(manifest.catalogCoverage).filter((entry): entry is string => typeof entry === 'string'))].sort();
  const advertised = CAPABILITIES.map(capability => capability.name).sort();
  const coverage = { catalogVersion: CATALOG_VERSION, scope: 'Manifest-declared component composition coverage; this does not establish that every component was visible or exercised in a recording.', advertised, declared: declaredCoverage, missing: advertised.filter(name => !declaredCoverage.includes(name)), unexpected: declaredCoverage.filter(name => !advertised.includes(name)) };
  const captureRecords: Json[] = [];
  const cards: string[] = [];
  let index = 0;
  for (const capture of allCaptures) {
    const id = `capture-${++index}`, media = await asset(capture.file, ['.mp4']);
    const poster = await asset(capture.poster ?? `${capture.scenario}-settled.png`, ['.png']);
    const explicitGenuine = capture.fixture === false && capture.provenance === 'genuine-pi';
    const fixture = capture.fixture === true;
    const provenance = fixture ? 'Deterministic fixture · actual local app' : explicitGenuine ? 'Genuine Pi · declared by manifest' : 'Unclassified provenance';
    const provenanceDetail = fixture ? 'Scripted local runtime; no model inference. Local PDF/SQLite operations can be real. External GitHub, CI, Supabase, email and phone effects are illustrative.' : explicitGenuine ? 'Review the linked runtime evidence for the model, session, actions and recovery scope. This index does not independently authenticate provider execution.' : 'This entry lacks an explicit provenance declaration. Its presence does not establish inference or an external effect.';
    if (!media) warnings.push(`Missing or unsupported recording: ${capture.file || '(no file)'}`);
    const chapters = list(capture.chapters).map(object).filter(chapter => typeof chapter.startSeconds === 'number' && Number.isFinite(chapter.startSeconds) && chapter.startSeconds >= 0).map(chapter => ({ title: string(chapter.title, 'Chapter'), startSeconds: chapter.startSeconds as number, ...(typeof chapter.endSeconds === 'number' && chapter.endSeconds >= (chapter.startSeconds as number) ? { endSeconds: chapter.endSeconds } : {}) })).sort((a, b) => a.startSeconds - b.startSeconds);
    const evidence: Asset[] = [];
    for (const file of list(capture.evidence)) { const linked = await asset(file); if (linked) evidence.push(linked); else warnings.push(`Missing or unsafe evidence link for ${capture.scenario}: ${string(file)}`); }
    const probe = object(capture.probe), streams = list(probe.streams).map(object), stream = streams.find(value => value.width && value.height) ?? {}, format = object(probe.format);
    const technical = [stream.width && stream.height ? `${stream.width} × ${stream.height}` : '', string(stream.codec_name), string(stream.avg_frame_rate) ? `encoded fps ${stream.avg_frame_rate}` : '', format.duration ? `${Number(format.duration).toFixed(1)} s` : ''].filter(Boolean).join(' · ');
    cards.push(`<article id="${id}" class="capture"><header><h2>${escape(capture.title ?? titles[capture.scenario] ?? capture.scenario)}</h2><p>${escape(capture.summary ?? provenanceDetail)}</p>${capture.summary ? `<p class="muted">${escape(provenanceDetail)}</p>` : ''}${capture.failed === true ? `<p class="issue">Recording action failed: ${escape(capture.error ?? 'Inspect the manifest before acceptance.')}</p>` : ''}</header>${media ? `<video id="${id}-video" controls playsinline preload="metadata"${poster ? ` poster="${poster.href}"` : ''}><source src="${media.href}" type="video/mp4">Your browser cannot play this recording. <a href="${media.href}">Download the MP4</a>.</video><p class="media-links"><a href="${media.href}">Open / download MP4</a>${poster ? ` · <a href="${poster.href}">Open settled frame</a>` : ''}</p>` : '<p class="pending">Recording file unavailable. This entry is pending.</p>'}${technical ? `<p class="technical">${escape(technical)}</p>` : ''}${chapters.length ? `<nav class="chapters" aria-label="Chapters for ${escape(capture.title ?? titles[capture.scenario] ?? capture.scenario)}">${chapters.map(chapter => media ? `<button type="button" data-video="${id}-video" data-start="${chapter.startSeconds}">${escape(time(chapter.startSeconds))} · ${escape(chapter.title)}</button>` : `<span>${escape(time(chapter.startSeconds))} · ${escape(chapter.title)}</span>`).join('')}</nav>` : '<p class="muted">No chapter timestamps were supplied.</p>'}${evidence.length ? `<ul class="evidence">${evidence.map(link => `<li><a href="${link.href}">${escape(link.file)}</a></li>`).join('')}</ul>` : ''}${capture.probe ? `<details><summary>Capture metadata</summary><pre>${escape(JSON.stringify(capture.probe, null, 2))}</pre></details>` : ''}</article>`);
    captureRecords.push({ scenario: capture.scenario, file: capture.file, available: !!media, provenance, chapters, evidence: evidence.map(link => link.file) });
  }
  const referenceFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/reference');
  const referenceOutput = join(folder, 'references');
  const regularOutput = async (path: string) => {
    try { if (!(await lstat(path)).isFile()) throw new Error(`Refusing to overwrite a nonregular output: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
  const referenceAssets = new Map<string, Asset>();
  for (const name of authorizedReferenceNames) {
    try {
      const source = join(referenceFolder, name);
      if (!(await lstat(source)).isFile()) throw new Error('Reference is not a regular file');
      await mkdir(referenceOutput, { recursive: true });
      if (!(await lstat(referenceOutput)).isDirectory() || !within(folder, await realpath(referenceOutput))) throw new Error('Reference output must remain inside the recording folder');
      await regularOutput(join(referenceOutput, name));
      await copyFile(source, join(referenceOutput, name));
      const copied = await asset(`references/${name}`, ['.png']); if (copied) referenceAssets.set(name, copied);
    } catch { warnings.push(`Authorized reference extract unavailable: ${name}`); }
  }
  const explicitComparisons = list(manifest.frameComparisons).map(object);
  const comparisons: Json[] = explicitComparisons.length ? explicitComparisons : Object.entries(references).map(([scenario, reference]) => ({ scenario, reference: reference.file, result: `${scenario}-settled.png`, label: titles[scenario], note: 'Scenario comparison only. The reference extract and settled result use different workflow moments and viewports; no exact timing or pixel match is asserted.' }));
  const comparisonCards: string[] = [], comparisonRecords: Json[] = [];
  for (const comparison of comparisons) {
    const name = basename(string(comparison.reference)), reference = authorizedReferenceNames.has(name) ? referenceAssets.get(name) : undefined;
    const result = await asset(comparison.result, ['.png']);
    const source = references[string(comparison.scenario)];
    const referenceCaption = `User-supplied behavioral reference${source?.file === name ? ` · recording ${source.recording} · extract ${source.frame}` : ''} · ${name}`;
    const note = string(comparison.note, 'The supplied frame pair is shown for visual review. This index does not establish matching time, viewport or workflow state.');
    comparisonCards.push(`<article class="comparison"><h3>${escape(comparison.label ?? titles[string(comparison.scenario)] ?? comparison.scenario ?? 'Frame comparison')}</h3><p class="muted">${escape(note)}</p><div class="frame-pair"><figure>${reference ? `<a href="${reference.href}"><img loading="lazy" src="${reference.href}" alt="${escape(referenceCaption)}"></a>` : '<p class="pending">No authorized reference extract available.</p>'}<figcaption>${escape(referenceCaption)}</figcaption></figure><figure>${result ? `<a href="${result.href}"><img loading="lazy" src="${result.href}" alt="${escape(comparison.label ?? comparison.scenario)} result frame"></a>` : '<p class="pending">Result frame pending.</p>'}<figcaption>${escape(result?.file ?? comparison.result ?? 'Result not supplied')}</figcaption></figure></div></article>`);
    comparisonRecords.push({ scenario: comparison.scenario, reference: reference?.file ?? null, result: result?.file ?? null, note });
  }
  const knownResults = new Set(comparisonRecords.map(comparison => comparison.result));
  const otherFrames = topLevel.filter(file => extname(file).toLowerCase() === '.png' && !knownResults.has(file));
  const genuineCount = captureRecords.filter(capture => capture.provenance === 'Genuine Pi · declared by manifest').length;
  const genuineStatus = genuineCount ? `${genuineCount} manifest-declared genuine Pi entry/entries. Missing files remain marked pending.` : 'No genuine Pi recording is declared in this manifest. Deterministic fixtures do not establish model generation.';
  const navigation = allCaptures.map((capture, i) => `<a href="#capture-${i + 1}">${escape(capture.title ?? titles[capture.scenario] ?? capture.scenario)}</a>`).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Frontend recorded review</title><style>
:root{font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--foreground,#20262d);color-scheme:light}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:0}h1,h2,h3{line-height:1.2;letter-spacing:-.02em}h1{font-size:2.2rem;margin:0 0 16px}h2{font-size:1.5rem;margin:8px 0 14px}h3{margin:0 0 10px}p{max-width:94ch}a{color:#245180;text-underline-offset:3px}button{font:inherit}.intro,.capture,.comparison,.support{background:var(--card,white);border:1px solid var(--border,#dce0e4);border-radius:12px;padding:24px;margin:0 0 24px}.eyebrow{font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;font-weight:650;color:#52606d;margin:0}.muted,.technical,figcaption{font-size:.88rem;color:#586573}.pending,.issue{padding:14px;background:#f5f0e5;border:1px solid #a47a33;border-radius:8px}.capture video{display:block;width:100%;max-height:720px;background:#111;border:1px solid #dce0e4;border-radius:6px}.media-links{font-size:.9rem}.toc,.chapters{display:flex;gap:9px;flex-wrap:wrap;margin:18px 0}.toc a,.chapters button{border:1px solid #cbd2d9;border-radius:5px;padding:6px 10px;background:white;text-decoration:none;color:#244767;font-size:.88rem;cursor:pointer}.frame-pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;min-width:0}figure img{display:block;width:100%;height:auto;border:1px solid #dce0e4;background:#f1f2f3}figcaption{margin:9px 0}.coverage{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));list-style:none;padding:0;gap:6px}.coverage li{font-size:.88rem;padding:6px 9px;background:#f3f5f6;border-radius:4px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;background:#f2f4f5;padding:14px}details{margin-top:14px}summary{cursor:pointer}.section-title{margin:44px 0 20px}.footnote{font-size:.85rem;color:#586573}@media(max-width:760px){main{padding:0}.intro,.capture,.comparison,.support{padding:16px}.frame-pair{grid-template-columns:1fr}h1{font-size:1.8rem}}
</style></head><body><main><section class="intro"><h1>Frontend recorded review</h1><p>Play the recordings below to inspect the working app. Each entry states whether its runtime is a deterministic fixture or manifest-declared genuine Pi evidence. Local PDF and SQLite effects are distinct from illustrative external services.</p><p class="muted">${escape(manifest.source ?? 'Provenance must be read per recording.')}</p>${manifest.generation ? `<p class="muted">${escape(manifest.generation)}</p>` : ''}<p><a href="manifest.json">Original recording manifest</a> · <a href="review-index.json">Media and comparison inventory</a> · <a href="component-coverage.json">Component coverage</a></p><nav class="toc" aria-label="Recordings">${navigation}</nav></section><section class="support" id="pi-provenance"><h2>Genuine Pi evidence</h2><p>${escape(genuineStatus)}</p>${genuine.status || genuine.notes ? `<p class="muted">${escape(genuine.status)}${genuine.notes ? ` · ${escape(genuine.notes)}` : ''}</p>` : ''}</section>${cards.join('\n')}<h2 class="section-title" id="frame-comparisons">Reference and result frames</h2><p class="muted">These references are byte-for-byte copies of the six extracts documented in docs/reference-videos.md. They demonstrate reference behavior, not backend execution. Each pair states its comparison scope. No reference was invented for the map, catalog or settings.</p>${comparisonCards.join('\n')}${otherFrames.length ? `<section class="support"><h2>Additional captured frames</h2><p class="muted">Available PNGs without a reference pairing.</p><ul>${otherFrames.map(file => `<li><a href="${file.split('/').map(encodeURIComponent).join('/')}">${escape(file)}</a></li>`).join('')}</ul></section>` : ''}<section class="support" id="component-coverage"><h2>Component composition coverage</h2><p>${declaredCoverage.filter(name => advertised.includes(name)).length} / ${advertised.length} advertised catalog entries are declared in the recording manifest.</p><p class="muted">${escape(coverage.scope)}</p><ul class="coverage">${advertised.map(name => `<li>${declaredCoverage.includes(name) ? 'Declared' : 'Missing'} · ${escape(name)}</li>`).join('')}</ul>${coverage.unexpected.length ? `<p class="issue">Unrecognized names: ${escape(coverage.unexpected.join(', '))}</p>` : ''}</section>${warnings.length ? `<section class="support"><h2>Pending or unclassified evidence</h2><ul>${warnings.map(warning => `<li>${escape(warning)}</li>`).join('')}</ul></section>` : ''}<p class="footnote">This handoff does not imply user visual approval, fresh-run model reliability, external provider execution, generated-app enablement or completion of the deferred 36-run pilot.</p></main><script>document.addEventListener('click',function(event){var button=event.target.closest('[data-video]');if(!button)return;var video=document.getElementById(button.dataset.video);if(!video)return;video.currentTime=Number(button.dataset.start);video.focus();});</script></body></html>`;
  for (const name of ['component-coverage.json', 'review-index.json', 'index.html']) await regularOutput(join(folder, name));
  await writeFile(join(folder, 'component-coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
  await writeFile(join(folder, 'review-index.json'), JSON.stringify({ manifest: 'manifest.json', captures: captureRecords, frameComparisons: comparisonRecords, additionalFrames: otherFrames, coverage: 'component-coverage.json', warnings }, null, 2) + '\n');
  await writeFile(join(folder, 'index.html'), html);
  return { folder, recordings: captureRecords.length, availableRecordings: captureRecords.filter(capture => capture.available).length, genuinePiEntries: genuineCount, declaredComponents: declaredCoverage.filter(name => advertised.includes(name)).length, advertisedComponents: advertised.length, warnings };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--input');
  if (index < 0 || !args[index + 1] || args[index + 1]!.startsWith('--') || args.some((_arg, i) => i !== index && i !== index + 1)) {
    console.error('Usage: pnpm exec tsx scripts/build-review-index.ts --input <recording-folder>'); process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await buildReviewIndex(args[index + 1]!), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}
