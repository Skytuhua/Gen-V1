/** Curated evidence only: no app startup, model calls, credentials or host storage copies. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildReviewIndex } from './build-review-index.ts';
import type { Snapshot } from '../packages/contracts/index.ts';

type Json = Record<string, unknown>;
type Chapter = { title: string; startSeconds: number };
type Capture = Json & { scenario: string; file: string; threadId: string; poster?: string; motionFile?: string; failed?: boolean; chapters: Chapter[] };
type Manifest = Json & { captures: Capture[]; catalogCoverage: string[] };
type Source = { folder: string; manifest: Manifest; snapshot: Snapshot };
const raw = resolve('docs/evidence/frontend-review/initiated-20261030');
const output = resolve('docs/evidence/frontend-review/agent-initiated-20261030');
const scenarios = ['signing', 'pr-dark', 'pr-light', 'migration', 'context', 'faq', 'map', 'catalog', 'shell'];
const values = (flag: string) => process.argv.slice(2).flatMap((value, index, args) => value === flag && args[index + 1] ? [args[index + 1]!] : []);
const sourceFolders = ['confirmation', 'confirmation-tail', ...values('--fixture')];
const conflictInspection = values('--conflict-inspection').at(-1) ?? 'inspection/conflict-confirm';
const within = (root: string, path: string) => { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep); };
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const slash = (path: string) => path.split(sep).join('/');
const scrub = (value: unknown): unknown => Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'sessionPath' && item ? '[local Pi session path omitted]' : scrub(item)])) : value;
async function regular(path: string, root = raw) {
  const absolute = resolve(path);
  if (!within(root, absolute) || !(await lstat(absolute)).isFile() || !within(await realpath(root), await realpath(absolute))) throw Error('Evidence must be an ordinary file inside its declared source: ' + path);
  return absolute;
}
async function saveJson(name: string, value: unknown) { const destination = resolve(output, name); if (!within(output, destination)) throw Error('Invalid package path'); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, JSON.stringify(scrub(value), null, 2) + '\n'); }
async function copy(source: string, name: string) { await regular(source); const destination = resolve(output, name); if (!within(output, destination)) throw Error('Invalid package path'); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); return slash(name); }
function scope(snapshot: Snapshot, id: string) {
  return { ...snapshot, threads: snapshot.threads.filter(x => x.id === id), archivedThreads: [], messages: snapshot.messages.filter(x => x.threadId === id), artifacts: snapshot.artifacts.filter(x => x.threadId === id), userStates: snapshot.userStates.filter(x => x.threadId === id), data: snapshot.data.filter(x => x.threadId === id), resources: snapshot.resources.filter(x => x.threadId === id), operations: snapshot.operations.filter(x => x.threadId === id), requests: snapshot.requests.filter(x => x.threadId === id), usage: { [id]: snapshot.usage[id] }, activeThreadId: id };
}
async function command(executable: string, args: string[]) {
  return await new Promise<string>((done, fail) => { const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', errors = ''; const timer = setTimeout(() => { child.kill(); fail(Error(executable + ' exceeded 180 seconds')); }, 180_000); child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { if (errors.length < 32_768) errors += data; }); child.on('error', fail); child.on('exit', code => { clearTimeout(timer); code === 0 ? done(out) : fail(Error(errors || executable + ' failed')); }); });
}
async function probe(path: string) { return JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate:format=duration,size', '-of', 'json', path])) as { streams: Json[]; format: { duration: string } }; }
async function copyEvidenceFolder(source: string, target: string, allowed: string[] = ['.json', '.md', '.png']) {
  const result: string[] = [];
  for (const entry of await readdir(source, { withFileTypes: true })) if (entry.isFile() && allowed.includes(extname(entry.name))) {
    const name = slash(join(target, entry.name));
    if (entry.name.endsWith('.json')) await saveJson(name, await readJson(join(source, entry.name))); else await copy(join(source, entry.name), name);
    result.push(name);
  }
  return result;
}
async function copyAnalysis(source: string, target: string) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyAnalysis(join(source, entry.name), join(target, entry.name));
    else if (entry.isFile() && ['.json', '.md', '.png', '.mp4'].includes(extname(entry.name))) await copy(join(source, entry.name), join(target, entry.name));
  }
}
async function exists(path: string) { try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

const sources: Source[] = [];
for (const name of sourceFolders) {
  const folder = resolve(raw, name); if (!within(raw, folder)) throw Error('Fixture source must remain inside the raw recording root');
  if (await exists(join(folder, 'manifest.json'))) sources.push({ folder, manifest: await readJson<Manifest>(join(folder, 'manifest.json')), snapshot: await readJson<Snapshot>(join(folder, 'snapshot.json')) });
}
const selected = scenarios.map(scenario => { const source = sources.toReversed().find(source => source.manifest.captures.some(capture => capture.scenario === scenario && !capture.failed)); return { scenario, source, capture: source?.manifest.captures.find(capture => capture.scenario === scenario && !capture.failed) }; });
const required = ['genuine-natural/account/proof.json', 'genuine-natural-confirm/account/resumed/proof.json', 'inspection/account/proof.json', 'genuine-agreement-confirm/agreement/proof.json', 'inspection/agreement/proof.json', 'genuine-conflict-confirm/conflict/proof.json', `${conflictInspection}/proof.json`];
const missing = [...selected.filter(item => !item.capture).map(item => 'fixture:' + item.scenario), ...(await Promise.all(required.map(async name => await exists(join(raw, name)) ? null : name))).filter((name): name is string => name !== null)];
const plan = { output, fixtureSources: selected.map(item => ({ scenario: item.scenario, folder: item.source?.folder, file: item.capture?.file })), genuineCases: ['account: two attempts and restart recovery', 'agreement: generated proposal then successful local content action', 'conflict: fresh valid-binding confirmation'], missing, mediaMethod: 'Stream-copy concatenation of actual 1920x1080/30fps clips; no interpolation or inference-wait editing.' };
if (!process.argv.includes('--assemble')) { console.log(JSON.stringify(plan, null, 2)); }
else {
  if (missing.length) throw Error('Evidence is incomplete: ' + missing.join(', '));
  const accountFirst = await readJson<Json>(join(raw, required[0]!)), accountRecovery = await readJson<Json>(join(raw, required[1]!)), accountInspection = await readJson<Json>(join(raw, required[2]!)), agreementRaw = await readJson<Json>(join(raw, required[3]!)), agreementInspection = await readJson<Json>(join(raw, required[4]!)), conflictRaw = await readJson<Json>(join(raw, required[5]!)), conflictProof = await readJson<Json>(join(raw, required[6]!));
  if (accountFirst.status !== 'failed' || accountRecovery.status !== 'passed' || accountInspection.status !== 'passed' || accountInspection.reloadPreserved !== true) throw Error('Recheck the account attempts/recovery before publishing');
  if (agreementInspection.status !== 'passed' || agreementInspection.reloadPreserved !== true || (agreementInspection.localAction as Json)?.savedValue !== 'legal@studio.example') throw Error('Agreement content action has not been verified');
  if (conflictRaw.status !== 'passed' || conflictRaw.relationshipRendered !== true || conflictProof.status !== 'passed' || conflictProof.reloadPreserved !== true) throw Error('Fresh conflict rendering/reload has not been verified');
  await mkdir(output, { recursive: true });
  const captures: Capture[] = [], effects: Json[] = [];
  for (const [index, item] of selected.entries()) {
    const source = item.source!, capture = item.capture!, scenario = item.scenario, file = `${String(index + 1).padStart(2, '0')}-${scenario}.mp4`;
    await copy(join(source.folder, capture.file), file);
    for (const entry of await readdir(source.folder)) if (entry.startsWith(scenario + '-') && entry.endsWith('.png') && !entry.includes('failed')) await copy(join(source.folder, entry), entry);
    const evidence = [`snapshot-${scenario}.json`]; await saveJson(evidence[0]!, scope(source.snapshot, capture.threadId));
    if (capture.motionFile) { await copy(join(source.folder, capture.motionFile), `${scenario}-motion.json`); evidence.push(`${scenario}-motion.json`); }
    captures.push({ ...capture, file, evidence, ...(scenario === 'signing' ? { comparisonSeconds: 8.2 } : {}) });
    const operations = source.snapshot.operations.filter(operation => operation.threadId === capture.threadId); effects.push({ scenario, threadId: capture.threadId, snapshot: evidence[0], operations });
    const operation = operations.find(operation => operation.kind === (scenario === 'signing' ? 'pdf.export' : 'database.migration') && operation.status === 'succeeded' && operation.approved);
    if (scenario === 'signing' || scenario === 'migration') {
      if (!operation) throw Error('Expected actual native-approved local effect for ' + scenario);
      const resourceId = scenario === 'signing' ? String((operation.result as Json).resourceId) : String(operation.args.resourceId), resource = source.snapshot.resources.find(resource => resource.id === resourceId && resource.threadId === capture.threadId);
      if (!resource) throw Error('Local operation output grant is missing');
      const path = scenario === 'signing' ? join(resource.path, String((operation.result as Json).path)) : resource.path, bytes = await readFile(await regular(path));
      const expected = scenario === 'signing' ? String((operation.result as Json).sha256) : String((operation.result as Json).resourceVersion);
      if (sha(bytes) !== expected) throw Error('Local output bytes changed for ' + scenario);
      const destination = scenario === 'signing' ? 'signed-agreement.pdf' : 'migrated-project.sqlite'; await copy(path, join('local-effects', destination));
      effects.push({ scenario, output: 'local-effects/' + destination, sha256: expected, verifiedAgainst: operation.id });
      if (scenario === 'signing') {
        const input = source.snapshot.resources.find(resource => resource.id === operation.args.resourceId)!; await copy(input.path, 'local-effects/source-agreement.pdf');
        for (const [markIndex, mark] of ((operation.args.signatures ?? []) as Json[]).entries()) if (mark.kind === 'image') { const grant = source.snapshot.resources.find(resource => resource.id === mark.resourceId)!; const markBytes = await readFile(await regular(grant.path)); if (sha(markBytes) !== operation.preconditions['signature:' + grant.id]) throw Error('Signature resource changed'); await copy(grant.path, `local-effects/signature-${markIndex + 1}.png`); }
      }
    }
  }
  const genuineRecords: Json[] = [];
  async function compilation(id: string, title: string, summary: string, parts: { source: string; label: string; proof?: Json }[], evidenceFolders: string[], poster: string) {
    const directory = join('genuine-pi', id), segments: Json[] = [], inputs: string[] = [], chapters: Chapter[] = []; let offset = 0;
    for (const [index, part] of parts.entries()) {
      const source = await regular(join(raw, part.source)); inputs.push(source); const metadata = await probe(source);
      const stream = metadata.streams[0]!; if (stream.codec_name !== 'h264' || stream.width !== 1920 || stream.height !== 1080 || stream.r_frame_rate !== '30/1') throw Error('Unexpected genuine segment encoding');
      chapters.push({ title: part.label, startSeconds: offset });
      const details = Array.isArray(part.proof?.chapters) ? part.proof!.chapters as Chapter[] : [];
      chapters.push(...details.filter(chapter => chapter.startSeconds > 0).map(chapter => ({ title: chapter.title, startSeconds: offset + chapter.startSeconds })));
      segments.push({ index: index + 1, source: part.source, startSeconds: offset, durationSeconds: Number(metadata.format.duration), sha256: sha(await readFile(source)) }); offset += Number(metadata.format.duration);
    }
    await mkdir(join(output, directory), { recursive: true });
    const listName = join(output, directory, 'concat.txt'); await writeFile(listName, inputs.map(path => `file '${slash(path).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
    const file = slash(join(directory, `${id}.mp4`));
    if (await exists(join(output, file))) {
      const previous = await readJson<{ segments: Json[] }>(join(output, directory, 'compilation.json'));
      if (JSON.stringify(previous.segments) !== JSON.stringify(segments)) throw Error('Refusing to replace a compilation made from different source bytes');
    } else await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', '-movflags', '+faststart', '-n', join(output, file)]);
    const evidence: string[] = [];
    for (const [index, folder] of evidenceFolders.entries()) evidence.push(...await copyEvidenceFolder(join(raw, folder), join(directory, `evidence-${index + 1}`)));
    const posterName = slash(join(directory, 'working.png')); await copy(join(raw, poster), posterName);
    await saveJson(join(directory, 'compilation.json'), { title, summary, segments, chapters, noInterpolation: true, uneditedInferenceWaits: true }); evidence.unshift(slash(join(directory, 'compilation.json')));
    genuineRecords.push({ scenario: `genuine-${id}`, title, summary, file, fixture: false, provenance: 'genuine-pi', model: 'openai/gpt-6.1-sol', poster: posterName, chapters, evidence, probe: await probe(join(output, file)) });
  }
  await compilation('account', 'Genuine Pi: account understanding, attempts and recovery', 'Attempt 1 spontaneously created an interface but did not update it on follow-up. A fresh task after stronger generic guidance was interrupted with the host, then resumed and updated its own artifact 1 to 2. The two attempts have different thread/artifact IDs. Final inspection verifies acknowledged local state through reload; this is not first-attempt reliability.', [
    { source: 'genuine-natural/account/genuine.mp4', label: 'Attempt 1: spontaneous composition, followed by a missed continuation', proof: accountFirst },
    { source: 'genuine-natural-confirm/account/resumed/recovery.mp4', label: 'Attempt 2: resume the fresh task after host interruption', proof: accountRecovery },
    { source: 'inspection/account/inspection.mp4', label: 'Inspect attempt 2 and verify acknowledged state after reload', proof: accountInspection },
  ], ['genuine-natural/account', 'genuine-natural-confirm/account', 'genuine-natural-confirm/account/resumed', 'inspection/account'], 'inspection/account/reloaded.png');
  await compilation('agreement', 'Genuine Pi: agreement and requested notices change', 'Ordinary agreement requests produced and revised the same artifact 1 to 2. An exact accessible-name mismatch stopped the first content driver. The later inspection selects the agent-proposed notices address through its real local control, updates the retained PDF Email binding and verifies reload. No PDF export or delivery is claimed for this natural case.', [
    { source: 'genuine-agreement-confirm/agreement/genuine.mp4', label: 'Spontaneous composition and same-artifact proposal; content-driver timeout retained', proof: agreementRaw },
    { source: 'inspection/agreement/inspection.mp4', label: 'Apply the proposed notices choice and verify PDF/reload', proof: agreementInspection },
  ], ['genuine-agreement-confirm/agreement', 'inspection/agreement'], 'inspection/agreement/reloaded.png');
  await compilation('conflict', 'Genuine Pi: inspect a branch conflict and keep both changes', 'A fresh ordinary branch-conflict request and continuation use a rendered vertical relationship surface and proposed change without applying it. Earlier unusable source-binding evidence is retained separately and is not credited as a rendered graph.', [
    { source: 'genuine-conflict-confirm/conflict/genuine.mp4', label: 'Fresh natural conflict request and same-artifact continuation', proof: conflictRaw },
    { source: `${conflictInspection}/inspection.mp4`, label: 'Inspect the actual graph and proposed resolution after reload', proof: conflictProof },
  ], ['genuine-conflict-confirm/conflict', conflictInspection], `${conflictInspection}/reloaded.png`);
  await copyEvidenceFolder(join(raw, 'genuine-natural/agreement'), 'prior-quality-limits/agreement-unapplied-email');
  await copyEvidenceFolder(join(raw, 'genuine-natural/conflict'), 'prior-quality-limits/conflict-invalid-pointer');
  await saveJson('genuine-pi/quality-ledger.json', {
    account: { firstAttempt: 'failed: follow-up remained chat-only', freshAttempt: 'host interruption, then same-artifact continuation 1 to 2 after Resume', reload: 'passed in acknowledged-state inspection', note: 'The raw recovery reloadPreserved=false compared a pre-local-edit baseline; its later independent inspection compares acknowledged state.' },
    agreement: { earlierAttempt: 'structural pass only; Email preview binding was removed and the requested replacement was not applied', confirmation: 'same artifact 1 to 2 with retained Email binding and an agent-proposed replacement choice', driver: 'exact accessible-name timeout; no content action credited there', inspection: 'real local choice applied legal@studio.example and PDF/state survived reload' },
    conflict: { earlierAttempt: 'structural pass only; nonexistent /value/value pointer left the graph unavailable', confirmation: 'fresh same-artifact continuation with rendered vertical graph and proposed keep-both change', inspection: 'passed; no applied repository operation' },
    firstAttemptReliability: 'not established', pilot: 'deferred',
  });
  await writeFile(join(output, 'prior-quality-limits', 'README.md'), '# Earlier quality limits\n\nThese raw files retain their original driver statuses. A structural `passed` status is not semantic acceptance. The earlier agreement revision removed its live Email field binding, so it did not complete the requested notices change. The earlier conflict revision used `/value/value`, leaving its graph unavailable despite a structural revision pass. Neither is credited as a complete working interaction. The main captions and genuine-pi/quality-ledger.json distinguish the later confirmations and successful local inspections.\n');
  const packets = [
    ['genuine-natural/sources/account-terms.md', 'genuine-pi/sources/account-attempt-1.md'],
    ['genuine-natural-confirm/sources/account-terms.md', 'genuine-pi/sources/account-attempt-2.md'],
    ['genuine-agreement-confirm/sources/agreement.pdf', 'genuine-pi/sources/agreement.pdf'],
    ['genuine-conflict-confirm/sources/branch-fixture/repository/conflict.txt', 'genuine-pi/sources/conflict.txt'],
    ['genuine-conflict-confirm/sources/branch-fixture/repository/README.md', 'genuine-pi/sources/repository-README.md'],
  ];
  const sourcePackets = [];
  for (const [source, destination] of packets) { await copy(join(raw, source!), destination!); sourcePackets.push({ file: destination, source, sha256: sha(await readFile(join(output, destination!))) }); }
  await saveJson('genuine-pi/source-packets.json', sourcePackets);
  for (const name of ['copy-audit.json', 'motion-coverage.json', 'final-checks.json', 'coherent-review.md']) if (await exists(join(raw, name))) await copy(join(raw, name), name);
  if (await exists(join(raw, 'analysis'))) await copyAnalysis(join(raw, 'analysis'), 'analysis');
  if (await exists(join(raw, 'confirmation/analysis'))) await copyAnalysis(join(raw, 'confirmation/analysis'), 'analysis/confirmation');
  const verification = await exists(join(raw, 'final-checks.json')) ? await readJson<Json>(join(raw, 'final-checks.json')) : { status: 'Root final verification pending' };
  const manifest = { source: sources[0]!.manifest.source, generation: 'Nine deterministic actual-app demonstrations plus three chaptered subscription-Pi compilations. Natural prompts contain no UI/layout instructions. Failed attempts, driver failures and restart recovery are distinguished from successful continuations.', catalogCoverage: sources[0]!.manifest.catalogCoverage, captures, genuinePi: { status: 'available with explicitly recorded quality limits', notes: 'GPT-6.1 Sol subscription only. No API-key fallback. These cases are not a reliability estimate or the deferred 36-run pilot.', captures: genuineRecords }, frameComparisons: Object.entries({ signing: 'signing-18.png', 'pr-dark': 'merge-16.png', 'pr-light': 'merge-16.png', migration: 'migration-16.png', context: 'context-10.png', faq: 'faq-24.png' }).map(([scenario, reference]) => ({ scenario, reference, result: `${scenario}-result.png`, note: 'Supplied reference and decoded actual-app frame. Both PR themes follow the vertical reference. Consecutive-frame motion findings and measured limits are recorded separately in analysis.' })), verification, boundaries: ['Browser-first local app; desktop packaging remains later work.', 'Generated-code applications remain disabled.', 'External GitHub, CI, Supabase, email and phone effects are simulated in deterministic recordings.', 'Local PDF export and SQLite migration are actual exact-operation-approved effects with output hashes.', 'Natural-case content/controls are model-generated, with failed attempts and driver limits retained.', 'User visual approval and the 36-run pilot remain open.'] };
  await saveJson('manifest.json', manifest); await saveJson('execution-evidence.json', effects); await saveJson('assembly-plan.json', plan);
  const hashes = await Promise.all([...captures, ...genuineRecords].map(async capture => { const file = String(capture.file); return { file, sha256: sha(await readFile(join(output, file))) }; })); await saveJson('media-hashes.json', hashes);
  await writeFile(join(output, 'README.md'), '# Recorded UI review\n\nOpen [index.html](index.html) to review nine actual-app demonstrations, three chaptered genuine-Pi compilations, reference/result frames and the 31-component inventory. Videos are 1920×1080, H.264, 30fps, without frame interpolation. Chapters preserve real inference waits and explicitly mark attempt/restart boundaries.\n\nThe fixture videos demonstrate renderer and local-operation behavior; GitHub, CI, Supabase, email and phone effects are simulated. The separate genuine cases use ordinary subscription-Pi task prompts. They include a failed account follow-up, a restart-recovered fresh task, an agreement driver naming failure corrected through a real local choice, and earlier invalid-pointer evidence. Read each caption and its proof before judging success. No first-attempt reliability or full-pilot claim is made.\n\n[copy-audit.json](copy-audit.json), [motion-coverage.json](motion-coverage.json), [execution-evidence.json](execution-evidence.json) and [media-hashes.json](media-hashes.json) provide the bounded evidence. Raw host databases and Pi session/authentication files are excluded; session-path strings in snapshots are omitted for portability.\n');
  console.log(JSON.stringify(await buildReviewIndex(output), null, 2));
}
