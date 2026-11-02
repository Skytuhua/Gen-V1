import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir, cpus, release } from 'node:os';
import { gzipSync } from 'node:zlib';
import { discoverCapabilities } from '../packages/core/discovery.ts';
import * as catalog from '../packages/ui-catalog/index.ts';
import { DOMAIN_TOOLS } from '../packages/capabilities/index.ts';
import { Store } from '../packages/storage/store.ts';
import { inspectTask } from '../packages/core/task-inspection.ts';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const index = await discoverCapabilities({});
// A controlled comparison of response shapes using the SAME current definitions.
// This is not a historical model usage/cost measurement.
const oldShape = { components: catalog.CAPABILITIES.map(({ name, category, description }) => ({ name, category, description })), domainTools: DOMAIN_TOOLS.map(({ name, description }) => ({ name, description })), softwareDevelopment: catalog.SOFTWARE_DEVELOPMENT_PACK, everyday: catalog.EVERYDAY_PACK, interactions: catalog.INTERACTION_PACK, exploration: catalog.EXPLORATION_PACK };
async function entry(directory: string) {
  // Older hashed assets stay available to open clients. Directory order cannot
  // identify the entry a fresh application actually loads.
  const html = await readFile(join(directory, '..', 'index.html'), 'utf8');
  const references = [...html.matchAll(/<script\b[^>]*\bsrc=["']\/assets\/(index-[A-Za-z0-9_-]+\.js)["']/g)];
  if (references.length !== 1) throw new Error('Expected one HTML-referenced application entry.');
  const filename = references[0]![1]!, value = await readFile(join(directory, filename));
  return { filename, bytes: value.byteLength, gzipBytes: gzipSync(value).byteLength };
}
const before = await entry(resolve('dist/desktop-release-0.2.0/win-unpacked/resources/host/dist/web/assets')), after = await entry(resolve('dist/web/assets'));
const temporary = await mkdtemp(join(tmpdir(), 'harness-context-measure-')), store = new Store(temporary);
let inspection;
try {
  store.internal('fixture', 'measurement', () => { for (let n = 0; n < 2000; n++) store.put('data', `record-${n}`, 'measurement', { id: `record-${n}`, threadId: 'measurement', revision: 1, provenance: 'p'.repeat(180), createdAt: '', value: { fixture: 'Synthetic retained data' } }); });
  const start = performance.now(), summary = inspectTask(store, { id: 'measurement' } as never, undefined, {});
  inspection = { syntheticRecords: 2000, durationMs: performance.now() - start, responseBytes: bytes(summary), truncated: summary.truncated };
} finally {
  store.close();
  if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('harness-context-measure-')) throw new Error('Refusing cleanup outside the owned measurement fixture.');
  await rm(temporary, { recursive: true, force: true });
}
const result = { measuredAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, osRelease: release(), cpu: cpus()[0]?.model }, bundle: { before, after, rawReductionPercent: (1 - after.bytes / before.bytes) * 100, gzipReductionPercent: (1 - after.gzipBytes / before.gzipBytes) * 100 }, discovery: { method: 'Controlled prior/default response-shape reconstruction with current definitions; excludes old widget extras, not measured tokens or billing.', beforeBytes: bytes(oldShape), afterBytes: bytes(index), byteReductionPercent: (1 - bytes(index) / bytes(oldShape)) * 100 }, inspection, limitations: 'Payload bytes and synthetic metadata processing only. No inference latency, live provider token cost, memory quota or physical-monitor performance claim.' };
const output = resolve(process.argv[2] ?? join('.harness-context-measurements', 'run-' + Date.now()));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'efficiency.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
