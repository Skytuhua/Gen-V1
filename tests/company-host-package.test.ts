import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {bundleCompanyHost, collectCompanyDependencies, packageCompanyHost, reserveCompanyPackage, validateCompanyNodeArchive, COMPANY_NODE_VERSION} from '../scripts/package-company-host.ts';

describe('headless company package', () => {
  it('compiles the existing default entry without initializing or packaging a second manager', async () => {
    const bundle = await bundleCompanyHost(resolve('.'));
    expect(bundle.inputs.some(input => input.path === 'apps/server/company-main.ts')).toBe(true);
    expect(bundle.inputs.some(input => input.path === 'apps/server/company-mode.ts')).toBe(true);
    expect(bundle.inputs.some(input => /runtime-hermes|company-manager\/runtime|apps\/server\/service/.test(input.path))).toBe(false);
    expect(bundle.externalPackages).toEqual(['ajv', 'fastify', 'zod']);
    expect(bundle.code).toContain('SIGTERM');
    expect(bundle.code).toContain('../../dist/web/');
    expect(bundle.inputs.every(input => input.bytes > 0 && /^[a-f0-9]{64}$/.test(input.sha256))).toBe(true);
  });

  it('retains exact installed production dependencies and no Windows runtime or dev dependencies', async () => {
    const dependencies = await collectCompanyDependencies();
    for (const [name, version] of Object.entries({fastify: '5.12.7', ajv: '8.18.0', zod: '4.6.6'})) {
      expect(dependencies.find(dependency => dependency.name === name)?.version).toBe(version);
    }
    expect(dependencies.some(dependency => /electron|tsx|esbuild|win32|claude|cursor/.test(dependency.name))).toBe(false);
    expect(new Set(dependencies.map(dependency => dependency.installPath)).size).toBe(dependencies.length);
    expect(new Set(dependencies.filter(dependency => dependency.name === 'fast-uri').map(dependency => dependency.version)).size).toBe(2);
  });

  it('never overwrites an existing package destination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gen-company-package-'));
    const output = await reserveCompanyPackage(root, '0.6.3');
    await writeFile(join(output, 'preserved.txt'), 'keep');
    await expect(reserveCompanyPackage(root, '0.6.3')).rejects.toThrow(/exists/);
    expect(await readFile(join(output, 'preserved.txt'), 'utf8')).toBe('keep');
    await expect(reserveCompanyPackage(root, '../escape')).rejects.toThrow(/version/);
    const archiveRoot = await mkdtemp(join(tmpdir(), 'gen-company-archive-'));
    const archive = join(archiveRoot, 'gen-v1-company-host-0.6.3-linux-x64.tar.gz');
    await writeFile(archive, 'preserve old archive');
    await expect(reserveCompanyPackage(archiveRoot, '0.6.3')).rejects.toThrow(/exists/);
    expect(await readFile(archive, 'utf8')).toBe('preserve old archive');
  });

  it('rejects a replaced source file or an unchecked Node archive', async () => {
    expect(COMPANY_NODE_VERSION).toBe('24.22.2');
    expect(() => validateCompanyNodeArchive(Buffer.from('wrong archive'))).toThrow(/checksum/);
    const root = await mkdtemp(join(tmpdir(), 'gen-company-source-'));
    await mkdir(join(root, 'apps/server'), {recursive: true});
    await writeFile(join(root, 'apps/server/company-main.ts'), "import '../../../outside.ts';");
    await expect(bundleCompanyHost(root)).rejects.toThrow();
  });

  it('rejects output inside its source tree before creating or copying anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gen-company-output-'));
    await expect(packageCompanyHost(root, join(root, 'dist/web/output'), '/missing-archive')).rejects.toThrow(/outside.*source/i);
  });
});
