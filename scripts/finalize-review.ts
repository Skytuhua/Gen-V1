/** Assemble the approved review delivery from completed, explicitly labelled captures. */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const base = resolve('docs/evidence/frontend-review/review-20261030');
const correction = resolve('.harness-review-visual-confirm');
const shell = resolve('.harness-review-shell-confirm');
const faq = resolve('.harness-review-faq-confirm');
const genuine = resolve('docs/evidence/frontend-review/genuine-pi-2026-10-30T07-49-25Z');
const output = resolve(process.argv[2] ?? 'docs/evidence/frontend-review/delivery-20261030');
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const sources = await Promise.all([base, correction, shell, faq].map(async folder => ({ folder, manifest: await json(join(folder, 'manifest.json')), snapshot: await json(join(folder, 'snapshot.json')) })));
const scenarios = ['signing', 'pr-dark', 'pr-light', 'migration', 'context', 'faq', 'map', 'catalog', 'shell'];
const chosen = scenarios.map(scenario => {
  const source = [...sources].reverse().find(source => source.manifest.captures.some((capture: { scenario: string; failed?: boolean }) => capture.scenario === scenario && !capture.failed));
  if (!source) throw new Error('No successful recording for ' + scenario);
  return { ...source, capture: source.manifest.captures.find((capture: { scenario: string; failed?: boolean }) => capture.scenario === scenario && !capture.failed), scenario };
});
const proof = await json(join(genuine, 'proof.json'));
if (proof.status !== 'passed' || !proof.sameArtifact || !proof.reloadPreserved || proof.repairPrompts.length || proof.initialArtifactRevision !== 1 || proof.finalArtifactRevision !== 2) throw new Error('Recheck genuine Pi evidence before assembling it.');
if (createHash('sha256').update(await readFile(proof.sourcePath)).digest('hex') !== proof.sourceSha256) throw new Error('The genuine source packet changed.');
await mkdir(output, { recursive: false });
const captures: Record<string, unknown>[] = [], effects: Record<string, unknown>[] = [];
for (const [index, source] of chosen.entries()) {
  const file = `${String(index + 1).padStart(2, '0')}-${source.scenario}.mp4`;
  await copyFile(join(source.folder, source.capture.file), join(output, file));
  for (const name of await readdir(source.folder)) if (name.startsWith(source.scenario + '-') && name.endsWith('.png') && !name.includes('failed')) await copyFile(join(source.folder, name), join(output, name));
  const snapshot = `snapshot-${source.scenario}.json`;
  await writeFile(join(output, snapshot), JSON.stringify(source.snapshot, null, 2));
  captures.push({ ...source.capture, file, evidence: [snapshot] });
  const operations = source.snapshot.operations.filter((operation: { threadId: string }) => operation.threadId === source.capture.threadId);
  effects.push({ scenario: source.scenario, threadId: source.capture.threadId, snapshot, operations });
}
await mkdir(join(output, 'genuine-pi'));
for (const entry of await readdir(genuine, { withFileTypes: true })) if (entry.isFile()) await copyFile(join(genuine, entry.name), join(output, 'genuine-pi', entry.name));
await mkdir(join(output, 'genuine-pi', 'resources'));
await copyFile(proof.sourcePath, join(output, 'genuine-pi', 'resources', basename(proof.sourcePath)));
await mkdir(join(output, 'local-effects'));
for (const source of chosen.filter(source => ['signing', 'migration'].includes(source.scenario))) {
  const fixture = (await readdir(source.folder)).find(name => name.startsWith('fixture-'));
  if (!fixture) throw new Error('Recording fixture resources unavailable.');
  const relative = source.scenario === 'signing' ? 'exports/signed-agreement.pdf' : 'project.sqlite';
  await copyFile(join(source.folder, fixture, 'resources', relative), join(output, 'local-effects', basename(relative)));
}
const files = [...captures.map(capture => String(capture.file)), 'genuine-pi/10-genuine-pi-composition.mp4'];
const hashes = await Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(join(output, file))).digest('hex') })));
const manifest = {
  source: sources[0].manifest.source,
  generation: 'Nine deterministic UI demonstrations use the actual application. Separate genuine subscription-Pi composition and continuation is included with source, event and state evidence.',
  catalogCoverage: sources[0].manifest.catalogCoverage, captures,
  genuinePi: { status: 'available', notes: 'GPT-6.1 Sol; zero model repair prompts; same artifact 1→2; reload preserved branches and notes. A script URL error before any model run is retained separately.', captures: [{ scenario: 'genuine-pi', title: 'Genuine Pi: plan a workshop visit', file: 'genuine-pi/10-genuine-pi-composition.mp4', poster: 'genuine-pi/after-reload.png', fixture: false, provenance: 'genuine-pi', model: proof.modelId, chapters: proof.chapters.map((chapter: { name: string; seconds: number }) => ({ title: chapter.name.replaceAll('-', ' '), startSeconds: chapter.seconds })), evidence: ['genuine-pi/proof.json', 'genuine-pi/events.json', 'genuine-pi/snapshot-before-action.json', 'genuine-pi/snapshot-after-reload.json'], probe: proof.recording }] },
  frameComparisons: Object.entries({ signing: 'signing-18.png', 'pr-dark': 'merge-16.png', 'pr-light': 'graph-14.png', migration: 'migration-16.png', context: 'context-10.png', faq: 'faq-24.png' }).map(([scenario, reference]) => ({ scenario, reference, result: `${scenario}-result.png`, note: 'Supplied reference and actual decoded recording frame. Compare structure, density and controls; viewport and workflow timing differ.' })),
  verification: { unit: { passed: 215, command: 'pnpm exec vitest run --maxWorkers=1 --no-file-parallelism' }, browser: { passed: 93, optInCaptureSkipped: 4, frontend: 62, pdf: 19, taskInterfaces: 12 }, typecheck: 'passed', build: 'passed; ~641kB main chunk advisory', independentReview: 'One coherent review; duplicate PNG headers, model propagation and available-width signing stack repaired with failing→passing regressions.', visualCorrection: 'Compact single-question submission and inspection-only evidence identities; affected clips recaptured once.' },
  boundaries: ['Browser-first local app; desktop packaging follows later.', 'External GitHub, CI, Supabase, email and phone effects are illustrative.', 'PDF export and SQLite migration are actual native-approved local effects.', 'Generated-code applications remain disabled.', 'The full 36-run pilot and user visual approval remain outstanding.'], hashes,
};
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(output, 'execution-evidence.json'), JSON.stringify(effects, null, 2));
console.log('DELIVERY_OUTPUT ' + output);
