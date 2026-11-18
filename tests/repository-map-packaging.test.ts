import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { REQUIRED_RUNTIME_FILES, runtimeSourceAllowed, stageRuntimeInstall } from '../scripts/desktop-assets';

it('stages the already-pinned compiler as a production dependency with the exact repository-map runtime sources', async () => {
  const host = await mkdtemp(join(tmpdir(), 'm04-repo-map-package-'));
  try {
    await stageRuntimeInstall(resolve('.'), host);
    const pkg = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
    expect(pkg.dependencies.typescript).toBe('5.9.3'); expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(await readFile(join(host, 'pnpm-lock.yaml'), 'utf8')).toBe(await readFile('pnpm-lock.yaml', 'utf8'));
    expect(REQUIRED_RUNTIME_FILES).toEqual(expect.arrayContaining(['host/node_modules/typescript/lib/typescript.js', 'host/node_modules/typescript/package.json']));
    for (const path of ['packages/core/repository-map-tool.ts', 'packages/core/repository-map-host.ts', 'packages/workspace/repo-map.ts']) expect(runtimeSourceAllowed(path)).toBe(true);
  } finally { await rm(host, { recursive: true, force: true, maxRetries: 5 }); }
});
