import { expect, it } from 'vitest';

const instructions = () => requireModule('../packages/core/instruction-manifest.ts', import.meta.glob('../packages/core/instruction-manifest.ts'));
const repoMap = () => requireModule('../packages/workspace/repo-map.ts', import.meta.glob('../packages/workspace/repo-map.ts'));
const tools = () => requireModule('../packages/core/context-tool-discovery.ts', import.meta.glob('../packages/core/context-tool-discovery.ts'));
async function requireModule(path: string, table: Record<string, () => Promise<unknown>>) {
  if (!table[path]) throw new Error('Missing M04 module: ' + path);
  return table[path]!();
}

it('reads an approved physical instruction file once and shows deterministic precedence', async () => {
  const { buildInstructionManifest } = await instructions() as typeof import('../packages/core/instruction-manifest.ts');
  const reads: string[] = [];
  const input = [
    { path: 'src/AGENTS.md', physicalId: 'nested', scope: 'src', precedence: 2 },
    { path: 'AGENTS.md', physicalId: 'root', scope: '', precedence: 1 },
    { path: 'src/CLAUDE.md', physicalId: 'nested', scope: 'src', precedence: 2 },
  ];
  const manifest = buildInstructionManifest(input, file => { reads.push(file.path); return 'Use fixtures.\n'; });
  expect(reads).toEqual(['AGENTS.md', 'src/AGENTS.md']);
  expect(manifest.entries.map(x => x.scope)).toEqual(['', 'src']);
  expect(manifest.entries.every(x => /^[a-f0-9]{64}$/.test(x.digest))).toBe(true);
  expect(manifest.duplicates).toEqual([{ path: 'src/CLAUDE.md', retainedPath: 'src/AGENTS.md' }]);
  expect(manifest.precedence).toBe('later overrides earlier within its recorded scope');
  expect(JSON.stringify(manifest)).not.toContain('Use fixtures.');
});

it('maps only granted source, reporting import edges and verified symbol lines', async () => {
  const { buildRepoMap } = await repoMap() as typeof import('../packages/workspace/repo-map.ts');
  const read: string[] = [];
  const map = buildRepoMap(['src/b.py', '.git/config', 'node_modules/ignore.ts', '.env.local', 'src/a.ts', '../outside.ts'],
    path => { read.push(path); return "import { next } from './next';\nexport function render() { return next(); }\n"; });
  expect(read).toEqual(['src/a.ts']);
  expect(map.files).toEqual([
    { path: 'src/a.ts', mode: 'PARSED', imports: ['./next'], exports: [{ name: 'render', line: 2 }] },
    { path: 'src/b.py', mode: 'FILE_LIST_ONLY', imports: [], exports: [] },
  ]);
});

it('ranks the repository map by requested path, referenced symbols, then normalized path and symbol', async () => {
  const { buildRepoMap, rankRepoMap } = await repoMap() as typeof import('../packages/workspace/repo-map.ts');
  const sources: Record<string, string> = {
    'src/zeta.ts': "export function zeta() {}\nexport function shared() {}\n",
    'src/alpha.ts': "export function alpha() {}\nexport function shared() {}\nexport function other() {}\n",
    'src/requested.ts': "export function requested() {}\n",
    'src/beta.ts': "export function shared() {}\n",
    'notes.py': 'print(1)\n',
  };
  const map = buildRepoMap(Object.keys(sources), path => sources[path]!);
  const ranked = rankRepoMap(map, { paths: ['src/requested.ts'], symbols: ['shared', 'alpha'] });
  expect(ranked.files.map(file => file.path)).toEqual(['src/requested.ts', 'src/alpha.ts', 'src/beta.ts', 'src/zeta.ts', 'notes.py']);
  expect(ranked.files[0]).toMatchObject({ requestedPath: true, referencedSymbols: 0 });
  expect(ranked.files[1]).toMatchObject({ requestedPath: false, referencedSymbols: 2 });
  expect(ranked.files[2]).toMatchObject({ referencedSymbols: 1 });
  expect(ranked.files[3]).toMatchObject({ referencedSymbols: 1 });
  const again = rankRepoMap(map, { paths: ['src/requested.ts'], symbols: ['shared', 'alpha'] });
  expect(again).toEqual(ranked);
  expect(map.files.map(file => file.path)).toEqual(['notes.py', 'src/alpha.ts', 'src/beta.ts', 'src/requested.ts', 'src/zeta.ts']);
  expect(rankRepoMap(map, {}).files.map(file => file.path)).toEqual(['notes.py', 'src/alpha.ts', 'src/beta.ts', 'src/requested.ts', 'src/zeta.ts']);
});

it.each([100, 500])('reveals schema on the next request without exposing denied tools, for %i tools', async count => {
  const { createContextToolDiscovery } = await tools() as typeof import('../packages/core/context-tool-discovery.ts');
  const entries = Array.from({ length: count }, (_, index) => ({
    name: 'fixture-' + index, description: 'Read synthetic context ' + index, schema: { type: 'object', description: 'a'.repeat(300) },
    exposure: index === 0 ? 'DIRECT' as const : index === 1 ? 'HIDDEN' as const : index === 2 ? 'SCRIPT_ONLY' as const : 'DEFERRED' as const,
  }));
  const catalog = createContextToolDiscovery(entries, name => name !== 'fixture-4');
  const first = catalog.freezeRequest([]);
  expect(first.tools.map(x => x.name)).toEqual(['fixture-0']);
  expect(first.schemaBytes).toBeLessThan(Buffer.byteLength(JSON.stringify(entries)));
  expect(catalog.discover('fixture-3').map(x => x.name)).toContain('fixture-3');
  expect(catalog.discover('fixture-1').map(x => x.name)).not.toContain('fixture-1');
  expect(catalog.describe('fixture-1')).toBeNull();
  expect(catalog.describe('fixture-2')).toBeNull();
  expect(catalog.describe('fixture-4')).toBeNull();
  const admitted = catalog.describe('fixture-3');
  expect(admitted?.schema).toEqual(entries[3]!.schema);
  expect(first.tools.map(x => x.name)).toEqual(['fixture-0']);
  const second = catalog.freezeRequest(['fixture-3', 'fixture-1', 'fixture-2', 'fixture-4']);
  expect(second.tools.map(x => x.name)).toEqual(['fixture-0', 'fixture-3']);
  expect(second.digest).not.toBe(first.digest);
});

it('permits a described tool only after a fresh request snapshot and rechecks admission at call time', async () => {
  const { createProgressiveToolSession } = await tools() as {
    createProgressiveToolSession: (rows: readonly { name: string; description: string; schema: object; exposure: 'DIRECT' | 'DEFERRED' | 'HIDDEN' | 'SCRIPT_ONLY' }[], admitted: (name: string) => boolean) => {
      capture(): { tools: readonly { name: string }[]; digest: string }; describe(name: string): unknown; canInvoke(name: string): boolean;
    };
  };
  let allowed = true;
  const session = createProgressiveToolSession([
    { name: 'direct', description: 'direct', schema: { type: 'object' }, exposure: 'DIRECT' },
    { name: 'deferred', description: 'deferred', schema: { type: 'object' }, exposure: 'DEFERRED' },
    { name: 'hidden', description: 'hidden', schema: { type: 'object' }, exposure: 'HIDDEN' },
    { name: 'script', description: 'script', schema: { type: 'object' }, exposure: 'SCRIPT_ONLY' },
  ], name => name !== 'deferred' || allowed);
  const before = session.capture();
  expect(before.tools.map(tool => tool.name)).toEqual(['direct']);
  expect(session.describe('deferred')).not.toBeNull();
  expect(session.canInvoke('deferred')).toBe(false);
  expect(session.describe('hidden')).toBeNull();
  expect(session.canInvoke('script')).toBe(false);
  expect(session.capture().digest).not.toBe(before.digest);
  expect(session.canInvoke('deferred')).toBe(true);
  allowed = false;
  expect(session.canInvoke('deferred')).toBe(false);
});


it('does not spend deferred discovery slots on already-direct tools', async () => {
  const { createProgressiveToolSession } = await tools() as typeof import('../packages/core/context-tool-discovery.ts');
  const direct = Array.from({ length: 64 }, (_, index) => ({
    name: 'direct-' + index, description: 'Direct tool', schema: {}, exposure: 'DIRECT' as const,
  }));
  const session = createProgressiveToolSession([
    ...direct, { name: 'deferred', description: 'Deferred tool', schema: {}, exposure: 'DEFERRED' },
  ], () => true);
  session.capture();
  for (const entry of direct) expect(session.describe(entry.name)).not.toBeNull();
  expect(session.describe('deferred')).not.toBeNull();
  expect(session.canInvoke('deferred')).toBe(false);
  expect(session.capture().tools.map(tool => tool.name)).toContain('deferred');
  expect(session.canInvoke('deferred')).toBe(true);
});


it('records explicit TypeScript import-type edges without treating runtime expressions as declarations', async () => {
  const { buildRepoMap } = await repoMap() as typeof import('../packages/workspace/repo-map.ts');
  const source = [
    "import type { Local } from './same';",
    "export type Shape = { next: import('./type-only').Shape; local: import('./same').Local };",
    "export type Factory = typeof import('./factory');",
    "const deferred = () => import('./runtime');",
  ].join('\n');
  const result = buildRepoMap(['src/input.ts'], () => source);
  expect(result.files[0]).toEqual({
    path: 'src/input.ts', mode: 'PARSED', imports: ['./factory', './same', './type-only'],
    exports: [{ name: 'Factory', line: 3 }, { name: 'Shape', line: 2 }],
  });
});

