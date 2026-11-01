/** Offline, bounded motion evidence. Never imported by the app or its recorder. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

type Rect = [number, number, number, number];
type NodeSample = { id: string; rect: Rect };
type Sample = { t: number; document?: string; pdf?: Rect | null; pdfScroll?: number | null; signatureClip?: string | null; graph?: Rect | null; nodes?: NodeSample[]; regions?: { id?: string; h: number; phase?: string; open?: string }[]; paths?: string[]; cells?: { rect: Rect; background: string; text: string }[]; context?: Rect | null; bands?: { opacity: number | string; rect: Rect }[] };
type MotionProbe = { samples: Sample[]; recordingStartMs?: number; events?: unknown[] };
type ChunkProbe = { chunks: { timeOrigin: number; started: number; samples: Sample[]; events: { t: number; action?: string; phase?: string; label?: string }[] }[]; recording: { startedWallTimeMilliseconds: number } };
type Capture = { scenario: string; file: string; motionFile?: string; motionOffsetMs?: number; chapters?: { title: string; startSeconds: number }[] };
type Source = { index: number; path: string; sha256: string };
type Run = { startMs: number; endMs: number; durationMs: number; samples: number; distance: number; values: number[] };
const folder = resolve(process.argv[2] ?? 'docs/evidence/frontend-review/initiated-20261030');
const requestedOutput = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length);
const output = requestedOutput ? resolve(requestedOutput) : join(folder, 'analysis');
const inspectOnly = process.argv.includes('--inspect-only');
const selectedScenario = process.argv.find(argument => argument.startsWith('--scenario='))?.split('=')[1];
const fps = 30;
const readJson = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;
function run(command: string, args: string[], maximumBytes = 4 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const buffers: Buffer[] = []; let total = 0, error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} exceeded 90 seconds`)); }, 90_000);
    child.stdout.on('data', (data: Buffer) => { total += data.length; if (total > maximumBytes) { child.kill(); reject(new Error('Analysis output exceeded its byte budget')); } else buffers.push(data); });
    child.stderr.on('data', (data: Buffer) => { if (error.length < 16_384) error += data.toString(); });
    child.on('error', reject); child.on('exit', code => { clearTimeout(timer); code === 0 ? resolveResult(Buffer.concat(buffers)) : reject(new Error(error || `${command} failed (${code})`)); });
  });
}
/** A span ends at the last observed change, not after the following quiet hold. */
function changedRuns(samples: Sample[], value: (sample: Sample) => number | undefined, threshold: number, minimumDistance = 1): Run[] {
  const result: Run[] = []; let current: Run | undefined, previous: { t: number; value: number; document?: string } | undefined;
  for (const sample of samples) {
    const next = value(sample);
    if (previous && sample.document !== previous.document) { if (current && current.distance >= minimumDistance) result.push(current); current = undefined; previous = undefined; }
    if (next === undefined || !Number.isFinite(next)) { if (current && current.distance >= minimumDistance) result.push(current); current = undefined; previous = undefined; continue; }
    if (previous && Math.abs(next - previous.value) > threshold) {
      if (current && sample.t - current.endMs > 120) { if (current.distance >= minimumDistance) result.push(current); current = undefined; }
      if (!current) current = { startMs: previous.t, endMs: sample.t, durationMs: 0, samples: 1, distance: 0, values: [previous.value] };
      current.endMs = sample.t; current.durationMs = current.endMs - current.startMs; current.samples++; current.distance += Math.abs(next - previous.value); current.values.push(next);
    } else if (current && sample.t - current.endMs > 120) { if (current.distance >= minimumDistance) result.push(current); current = undefined; }
    previous = { t: sample.t, value: next, document: sample.document };
  }
  if (current && current.distance >= minimumDistance) result.push(current);
  return result.map(item => ({ ...item, distance: Math.round(item.distance * 100) / 100, durationMs: Math.round(item.durationMs * 100) / 100 }));
}
function markProgress(sample: Sample) {
  const clip = sample.signatureClip;
  if (!clip || clip === 'none') return undefined;
  const parts = clip.match(/inset\(([^)]+)\)/)?.[1].split(/\s+/);
  if (!parts || parts.length < 2 || !parts[1].endsWith('%')) return undefined;
  return 100 - Number.parseFloat(parts[1]);
}
function relativeNode(sample: Sample, id: string, dimension: 0 | 1) {
  const node = sample.nodes?.find(node => node.id === id);
  if (!node || !sample.graph) return undefined;
  return node.rect[dimension] - sample.graph[dimension];
}
function normalizeProbe(probe: MotionProbe | ChunkProbe): MotionProbe {
  if (!('chunks' in probe)) return probe;
  const epoch = probe.recording.startedWallTimeMilliseconds;
  return {
    samples: probe.chunks.flatMap(chunk => chunk.samples.map(sample => ({ ...sample, document: `${chunk.timeOrigin}:${chunk.started}`, t: chunk.timeOrigin + chunk.started + sample.t - epoch }))).filter(sample => sample.t >= 0).sort((a, b) => a.t - b.t),
    events: probe.chunks.flatMap(chunk => chunk.events.map(event => ({ ...event, t: chunk.timeOrigin + chunk.started + event.t - epoch }))).filter(event => event.t >= 0).sort((a, b) => a.t - b.t), recordingStartMs: 0,
  };
}
function graphAlignment(samples: Sample[]) {
  const measurements: { t: number; maximumYError: number; nodes: number; endpoints: number }[] = [];
  for (const sample of samples) {
    if (!sample.graph || !sample.paths?.length || !sample.nodes?.length) continue;
    const centers = sample.nodes.map(node => node.rect[1] - sample.graph![1] + node.rect[3] / 2);
    const endpoints = sample.paths.filter(path => /^M-?[\d.]+,-?[\d.]+ C/.test(path)).flatMap(path => {
      const values = path.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number);
      return values && values.length >= 4 ? [values[1], values.at(-1)!] : [];
    });
    if (!endpoints.length) continue;
    // The graph body may follow a caption. Remove that common translation;
    // test whether all individual endpoints still meet a row's center.
    const translation = Math.min(...centers) - Math.min(...endpoints);
    const maximumYError = Math.max(...endpoints.map(y => Math.min(...centers.map(center => Math.abs(y + translation - center)))));
    measurements.push({ t: sample.t, maximumYError, nodes: centers.length, endpoints: endpoints.length });
  }
  return { samples: measurements.length, maximumYError: measurements.length ? Math.max(...measurements.map(sample => sample.maximumYError)) : null, measurements, limit: 'Vertical y continuity only; node rects are row boxes, so this is not a horizontal dot-position test.' };
}
function describe(probe: MotionProbe, capture: Capture) {
  const samples = probe.samples;
  const gaps = samples.slice(1).map((sample, index) => sample.t - samples[index].t).sort((a, b) => a - b);
  const offset = capture.motionOffsetMs ?? probe.recordingStartMs;
  const alignment = { recordingOffsetMs: offset ?? null, note: offset === undefined ? 'No recorder/probe clock offset. DOM spans cannot be located in exported video within a two-frame tolerance.' : 'Probe performance clock aligned by recorder observation; encoded frame timing still has one-frame uncertainty.' };
  const ids = [...new Set(samples.flatMap(sample => sample.nodes?.map(node => node.id) ?? []))];
  const graphs = ids.map(id => ({ id, x: changedRuns(samples, sample => relativeNode(sample, id, 0), .05), y: changedRuns(samples, sample => relativeNode(sample, id, 1), .05) })).filter(item => item.x.length || item.y.length);
  const regionCount = Math.max(0, ...samples.map(sample => sample.regions?.length ?? 0));
  const regions = Array.from({ length: regionCount }, (_, index) => ({ index, runs: changedRuns(samples, sample => sample.regions?.[index]?.h, .05) })).filter(item => item.runs.length);
  return {
    scenario: capture.scenario, samples: samples.length, sampleIntervalMs: { minimum: gaps[0] ?? null, median: gaps[Math.floor(gaps.length / 2)] ?? null, maximum: gaps.at(-1) ?? null }, alignment,
    pdfPan: changedRuns(samples, sample => sample.pdfScroll ?? undefined, .1, 3),
    pdfReframe: changedRuns(samples, sample => sample.pdf?.[2], .05, 2),
    signatureReveal: changedRuns(samples, markProgress, .01, 5), graphGeometry: graphs, regions,
    contextTravel: changedRuns(samples, sample => sample.context?.[1], .05),
    contextBands: Array.from({ length: Math.max(0, ...samples.map(sample => sample.bands?.length ?? 0)) }, (_, index) => ({ index, runs: changedRuns(samples, sample => sample.bands?.[index] ? Number(sample.bands[index].opacity) : undefined, .001, .05) })),
    graphAlignment: graphAlignment(samples), actions: probe.events,
    limits: ['DOM observations measure committed layout and computed styles, not painted pixels.', 'Region indices can shift when a tree changes; compare those spans against the exported frames.', 'No inference or execution waiting time is counted as an animation effect.', 'Missing probe fields are not inferred from application duration constants.'],
  };
}
const sourceWindows = [
  { id: 'signing-pan', index: 1, start: 16.30, duration: 1.10, note: 'Field-navigation pan; stable local document content.' },
  { id: 'signing-mark', index: 1, start: 21.10, duration: .90, note: 'Generated mark reveal inside the signature well.' },
  { id: 'signing-complete', index: 1, start: 34.10, duration: 1.10, note: 'Whole-page completion reframe and receipt entry.' },
  { id: 'vertical-conflict', index: 2, start: 8.60, duration: .80, note: 'Amber conflict footer arrival.' },
  { id: 'vertical-checks', index: 2, start: 21.90, duration: .80, note: 'Ready checks stagger; source camera motion must be separated.' },
  { id: 'vertical-complete', index: 2, start: 29.30, duration: 1.10, note: 'Purple completion; global presentation zoom excluded.' },
  { id: 'horizontal-supplement', index: 3, start: 11.60, duration: 1.10, note: 'Supplementary reference only; PR product uses vertical in both themes.' },
  { id: 'migration-column', index: 4, start: 12.65, duration: .80, note: 'Tab swap, column insertion and affected-data highlight.' },
  { id: 'context-open', index: 5, start: 3.93, duration: .80, note: 'Staged popover; global presentation zoom must be separated.' },
  { id: 'context-busy', index: 5, start: 11.50, duration: .80, note: 'Busy transition; counters should not be manufactured.' },
  { id: 'context-accepted', index: 5, start: 12.00, duration: 2.30, note: 'Only accepted measurements interpolate.' },
  { id: 'faq-answer', index: 6, start: 8.50, duration: 1.10, note: 'Pending, answer growth and follow-up remain separate.' },
  { id: 'faq-submit', index: 6, start: 22.83, duration: 1.50, note: 'New root, pending and then answer; input focus retained.' },
];
async function contactSheet(path: string, start: number, duration: number, target: string, crop?: Rect) {
  const frames = Math.min(72, Math.ceil(duration * fps));
  const columns = 6, rows = Math.ceil(frames / columns);
  const scale = crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},scale=384:-2` : 'scale=320:180';
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-ss', start.toFixed(4), '-i', path, '-t', duration.toFixed(4), '-an', '-vf', `${scale},tile=${columns}x${rows}:nb_frames=${frames}:padding=2:margin=2:color=gray`, '-frames:v', '1', '-update', '1', '-y', target]);
  return { file: basename(target), startSeconds: start, endSeconds: start + duration, frameRate: fps, consecutiveFrames: frames, columns, ...(crop ? { analysisCrop: crop } : {}), note: 'Every consecutive encoded frame in the selected window. No interpolation or frame-rate conversion; cell0 is the selected starting frame. Crops are analysis-only.' };
}
async function inkExtent(path: string, start: number, duration: number, crop: Rect) {
  const [x, y, width, height] = crop;
  const bytes = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1', '-ss', String(start), '-i', path, '-t', String(duration), '-an', '-vf', `crop=${width}:${height}:${x}:${y},format=rgb24`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], 8 * 1024 * 1024);
  const frameSize = width * height * 3, frames = Math.floor(bytes.length / frameSize), samples = [];
  for (let frame = 0; frame < frames; frame++) {
    let left = width, right = -1, count = 0;
    for (let pixel = 0; pixel < width * height; pixel++) {
      const at = frame * frameSize + pixel * 3;
      if (Math.max(bytes[at], bytes[at + 1], bytes[at + 2]) < 160) { const column = pixel % width; left = Math.min(left, column); right = Math.max(right, column); count++; }
    }
    samples.push({ seconds: start + frame / fps, left, right, count });
  }
  const visible = samples.filter(sample => sample.count > 10), left = Math.min(...visible.map(sample => sample.left)), right = Math.max(...visible.map(sample => sample.right));
  return { crop, startSeconds: start, frameRate: fps, frames, left, right, samples: samples.map(sample => ({ ...sample, fraction: sample.count > 10 && right > left ? Math.max(0, (sample.right - left) / (right - left)) : 0 })), limit: 'Dark-ink horizontal extent inside a visually checked signature-only crop. This observes pixels, not vector stroke position or CSS alpha.' };
}
function inkTiming(series: Awaited<ReturnType<typeof inkExtent>>) {
  const onset = series.samples.find(sample => sample.count > 35 && sample.fraction > .02);
  const settled = series.samples.find((sample, index) => sample.fraction >= .98 && series.samples.slice(index, index + 3).length === 3 && series.samples.slice(index, index + 3).every(next => next.fraction >= .98));
  return { onsetSeconds: onset?.seconds ?? null, settledSeconds: settled?.seconds ?? null, durationMs: onset && settled ? Math.round((settled.seconds - onset.seconds) * 1000) : null, uncertaintyMs: 1000 / fps };
}
await mkdir(output, { recursive: true });
const manifestPath = join(folder, 'manifest.json');
const manifest = await readJson<{ captures: Capture[] }>(manifestPath).catch(() => ({ captures: [] }));
const sources = await readJson<Source[]>(resolve('docs/evidence/frontend-review/fidelity-20261030/analysis/originals-metadata.json'));
const evidence: Record<string, unknown> = { capturedAt: new Date().toISOString(), fps, toleranceFrames: 2, scope: 'Offline analysis of actual renderer recordings, DOM observations and original encoded frames. Not backend provenance.', sources: [], recordings: [], observations: [], sheets: [], limits: ['Two-frame agreement is assessed only for isolatable effects with both onset and settle measurable.', 'Source video includes global camera zoom/smear; pixel changes alone do not identify app motion.', 'The horizontal original is supplementary; both PR demonstrations follow the vertical source.'] };
let signingProbe: MotionProbe | undefined;
for (const capture of manifest.captures.filter(capture => !selectedScenario || capture.scenario === selectedScenario)) {
  if (!capture.motionFile) continue;
  const probe = normalizeProbe(await readJson<MotionProbe | ChunkProbe>(join(folder, capture.motionFile)));
  if (!inspectOnly) { const bytes = await readFile(join(folder, capture.file)); (evidence.recordings as unknown[]).push({ scenario: capture.scenario, file: basename(capture.file), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }); }
  const observation = describe(probe, capture);
  (evidence.observations as unknown[]).push(observation);
  if (!inspectOnly && capture.scenario === 'signing') {
    signingProbe = probe;
    const actions = probe.events as { t: number; action?: string; label?: string; phase?: string }[];
    const firstNext = actions.find(event => event.label === 'Next step')?.t ?? 0;
    const firstMark = observation.signatureReveal[0]?.startMs ?? 0;
    const style = actions.find(event => event.action === 'Another style')?.t ?? firstMark;
    const approve = actions.find(event => event.action === 'Approve operation')?.t ?? 0;
    const reframe = observation.pdfReframe.find(span => span.startMs > approve && span.durationMs > 200);
    const ready = actions.find(event => event.t > approve && event.phase?.includes('ready|ready'))?.t ?? reframe?.endMs ?? approve;
    const windows = [
      { id: 'pan', start: Math.max(0, firstNext / 1000 - .1), duration: 1.10 },
      { id: 'mark', start: Math.max(0, firstMark / 1000 - .15), duration: 1.10 },
      { id: 'style', start: Math.max(0, style / 1000 - .1), duration: 1.00 },
      { id: 'completion-reframe', start: Math.max(0, (reframe?.startMs ?? ready) / 1000 - .1), duration: 1.20 },
      { id: 'completion-receipt', start: Math.max(0, ready / 1000 - .1), duration: 1.10 },
    ];
    for (const window of windows) {
      const sheet = await contactSheet(join(folder, capture.file), window.start, window.duration, join(output, `result-signing-${window.id}.png`));
      (evidence.sheets as unknown[]).push({ ...sheet, scenario: capture.scenario, event: window.id, note: 'Recording event window selected from actual probe, not a CSS duration.' });
    }
  }
  if (!inspectOnly && capture.scenario.startsWith('pr-')) {
    const events = probe.events as { t: number; action?: string; phase?: string }[];
    const onset = (word: string) => events.find(event => event.phase?.includes(word))?.t;
    const conflict = onset('mainpending'), ready = onset('mainsuccess'), merged = onset('#128merged');
    const resolveAction = events.find(event => event.action === 'Resolve conflicts')?.t ?? 0;
    const geometry = observation.graphGeometry.flatMap(node => node.y).find(span => span.startMs > resolveAction);
    const windows = [{ id: 'preparation', t: observation.graphGeometry[0]?.y[0]?.startMs, duration: 1.1 }, { id: 'conflict', t: conflict, duration: .8 }, { id: 'resolution-geometry', t: geometry?.startMs, duration: 1.1 }, { id: 'checks', t: ready, duration: .9 }, { id: 'completion', t: merged, duration: 1.1 }];
    for (const window of windows) if (window.t !== undefined) {
      const sheet = await contactSheet(join(folder, capture.file), Math.max(0, window.t / 1000 - .1), window.duration, join(output, `result-${capture.scenario}-${window.id}.png`), [700, 200, 770, 530]);
      (evidence.sheets as unknown[]).push({ ...sheet, scenario: capture.scenario, event: window.id });
    }
  }
  if (!inspectOnly && capture.scenario === 'context') {
    const first = probe.samples.find(sample => sample.context), events = probe.events as { t: number; action?: string; phase?: string }[];
    const busy = events.find(event => event.action === 'Compact now')?.t;
    const accepted = events.find(event => busy !== undefined && event.t > busy && event.phase?.includes('Compact now') && !event.phase.includes('Summarizing'))?.t;
    for (const window of [{ id: 'staged-open', t: first?.t, duration: .7 }, { id: 'busy', t: busy, duration: .8 }, { id: 'accepted', t: accepted, duration: 2.1 }]) if (window.t !== undefined) {
      const sheet = await contactSheet(join(folder, capture.file), Math.max(0, window.t / 1000 - .1), window.duration, join(output, `result-context-${window.id}.png`), [810, 450, 420, 610]);
      (evidence.sheets as unknown[]).push({ ...sheet, scenario: capture.scenario, event: window.id });
    }
  }
  if (!inspectOnly && capture.scenario === 'faq') {
    const events = probe.events as { t: number; action?: string }[];
    const documents = events.find(event => event.action === 'What documents do I need?')?.t, root = events.filter(event => event.action === 'Who can open an account?');
    const windows = [{ id: 'pending', t: documents, duration: .8 }, { id: 'answer-followup', t: documents === undefined ? undefined : documents + 450, duration: 1.5 }, { id: 'collapse', t: root[1]?.t, duration: .6 }, { id: 'reopen', t: root[2]?.t, duration: .6 }];
    for (const window of windows) if (window.t !== undefined) {
      const sheet = await contactSheet(join(folder, capture.file), Math.max(0, window.t / 1000 - .1), window.duration, join(output, `result-faq-${window.id}.png`), [700, 190, 770, 660]);
      (evidence.sheets as unknown[]).push({ ...sheet, scenario: capture.scenario, event: window.id });
    }
  }
  if (!inspectOnly && capture.scenario === 'migration') {
    const events = probe.events as { t: number; action?: string }[];
    for (const title of ['workspaces', 'users', 'projects', 'messages']) {
      const event = events.find(event => event.action === title); if (!event) continue;
      const sheet = await contactSheet(join(folder, capture.file), Math.max(0, event.t / 1000 - .1), .9, join(output, `result-migration-${title}.png`), [560, 0, 1050, 590]);
      (evidence.sheets as unknown[]).push({ ...sheet, scenario: capture.scenario, event: title });
    }
  }
}
if (!inspectOnly) {
  for (const source of sources) {
    const bytes = await readFile(source.path), actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== source.sha256) throw new Error('Original hash changed: ' + source.index);
    (evidence.sources as unknown[]).push({ index: source.index, path: source.path, sha256: actual, size: (await stat(source.path)).size });
  }
  for (const window of sourceWindows) {
    const source = sources.find(source => source.index === window.index)!;
    const sheet = await contactSheet(source.path, window.start, window.duration, join(output, `source-${window.id}.png`));
    (evidence.sheets as unknown[]).push({ ...sheet, sourceIndex: source.index, event: window.id, note: window.note });
  }
  const signing = manifest.captures.find(capture => capture.scenario === 'signing');
  if (signing && signingProbe) {
    const firstMark = describe(signingProbe, signing).signatureReveal[0]?.startMs;
    if (firstMark === undefined) throw new Error('No observed generated mark reveal; do not claim a match.');
    const reference = await inkExtent(sources.find(source => source.index === 1)!.path, 21.10, .75, [700, 335, 245, 64]);
    const result = await inkExtent(join(folder, signing.file), Math.max(0, firstMark / 1000), 1.00, [1230, 420, 300, 65]);
    const referenceTiming = inkTiming(reference), resultTiming = inkTiming(result);
    evidence.signatureInk = { reference, result, referenceTiming, resultTiming, differenceFrames: referenceTiming.durationMs !== null && resultTiming.durationMs !== null ? (resultTiming.durationMs - referenceTiming.durationMs) * fps / 1000 : null };
  }
}
await writeFile(join(output, inspectOnly ? 'probe-observations.json' : 'motion-analysis.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ captures: manifest.captures.length, observations: (evidence.observations as unknown[]).length, sheets: (evidence.sheets as unknown[]).length, output, inspectOnly }));
