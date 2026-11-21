import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, rm, symlink, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {capturePersonalInstructions, personalInstructionsPath, readPersonalInstructions, writePersonalInstructions} from '../packages/core/personal-instructions.ts';
import {resolveGrant} from '../packages/core/security.ts';
import type {ResourceGrant} from '../packages/contracts/index.ts';

const dirs: string[] = [];
const dir = async () => { const value = await mkdtemp(join(tmpdir(), 'pi-test-')); dirs.push(value); return value; };
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, {recursive: true, force: true}); });

describe('personal instructions storage', () => {
  it('writes then reads a round trip with a stable digest', async () => {
    const dataDir = await dir();
    const view = await writePersonalInstructions(dataDir, 'Prefer pnpm.\r\nAsk first.\r\n', null);
    expect(view.status).toBe('OK');
    expect(view.text).toBe('Prefer pnpm.\nAsk first.');
    const reread = await readPersonalInstructions(dataDir);
    expect(reread.digest).toBe(view.digest);
    expect(reread.bytes).toBe(Buffer.byteLength(view.text));
  });
  it('trims the text and deletes the file when empty after trim', async () => {
    const dataDir = await dir();
    await writePersonalInstructions(dataDir, '  hello  ', null);
    expect((await readPersonalInstructions(dataDir)).text).toBe('hello');
    const cleared = await writePersonalInstructions(dataDir, '   ', (await readPersonalInstructions(dataDir)).digest);
    expect(cleared.status).toBe('ABSENT');
  });
  it('reports ABSENT for a missing file', async () => {
    expect((await readPersonalInstructions(await dir())).status).toBe('ABSENT');
  });
  it('refuses text over 16 KiB on save', async () => {
    await expect(writePersonalInstructions(await dir(), 'x'.repeat(17 * 1024), null)).rejects.toThrow('under 16 KB');
  });
  it('refuses NUL and directives on save', async () => {
    const dataDir = await dir();
    await expect(writePersonalInstructions(dataDir, 'a\0b', null)).rejects.toThrow('UTF-8');
    await expect(writePersonalInstructions(dataDir, '!include ./x.md', null)).rejects.toThrow('Includes and hooks');
    await expect(writePersonalInstructions(dataDir, 'pre_tool_hook: run', null)).rejects.toThrow('Includes and hooks');
    await expect(writePersonalInstructions(dataDir, '@/shared/rules.md', null)).rejects.toThrow('Includes and hooks');
  });
  it('excludes invalid UTF-8 and NUL found in a hand-edited file', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'personal-instructions'), {recursive: true});
    await writeFile(personalInstructionsPath(dataDir), Buffer.from([0xff, 0xfe, 0x41]));
    expect((await readPersonalInstructions(dataDir)).reason).toBe('SOURCE_NOT_TEXT');
    await writeFile(personalInstructionsPath(dataDir), 'ok\0bad');
    expect((await readPersonalInstructions(dataDir)).reason).toBe('SOURCE_NOT_TEXT');
    await writeFile(personalInstructionsPath(dataDir), '!include secrets.md');
    const directive = await readPersonalInstructions(dataDir);
    expect(directive.reason).toBe('UNSUPPORTED_DIRECTIVE');
    expect(directive.text).toContain('!include'); // returned for repair, never sent
  });
  it('excludes oversize files without reading more than needed', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'personal-instructions'), {recursive: true});
    await writeFile(personalInstructionsPath(dataDir), 'x'.repeat(17 * 1024));
    expect((await readPersonalInstructions(dataDir)).reason).toBe('SOURCE_TOO_LARGE');
  });
  it('excludes a symlink file as UNAVAILABLE_SOURCE', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'personal-instructions'), {recursive: true});
    await writeFile(join(dataDir, 'real.md'), 'text');
    await symlink(join(dataDir, 'real.md'), personalInstructionsPath(dataDir));
    expect((await readPersonalInstructions(dataDir)).reason).toBe('UNAVAILABLE_SOURCE');
  });
  it('rejects a stale baseDigest on save', async () => {
    const dataDir = await dir();
    await writePersonalInstructions(dataDir, 'v1', null);
    await writeFile(personalInstructionsPath(dataDir), 'v2');
    await expect(writePersonalInstructions(dataDir, 'v3', (await readPersonalInstructions(dataDir)).digest && 'stale'))
      .rejects.toThrow('changed on disk');
  });
  it('capture returns nothing when off, absent or excluded', async () => {
    const dataDir = await dir();
    await writePersonalInstructions(dataDir, 'rules', null);
    expect(await capturePersonalInstructions(dataDir, true)).toMatchObject({text: 'rules'});
    expect(await capturePersonalInstructions(dataDir, false)).toBeUndefined();
    expect(await capturePersonalInstructions(await dir(), true)).toBeUndefined();
    await writeFile(personalInstructionsPath(dataDir), '!include x');
    expect(await capturePersonalInstructions(dataDir, true)).toBeUndefined();
  });
  it('grants cannot reach the protected personal-instructions folder', async () => {
    const dataDir = await dir();
    await mkdir(join(dataDir, 'personal-instructions'), {recursive: true});
    const grant: ResourceGrant = {id: 'g1', threadId: 't1', kind: 'project', path: dataDir, writable: false} as ResourceGrant;
    await expect(resolveGrant(grant, 'personal-instructions/AGENTS.md', false, dataDir)).rejects.toThrow();
  });
});

describe('prompt framing', () => {
  it('withPersonalInstructions appends the framed block after the host prompt', async () => {
    const {withPersonalInstructions} = await import('../packages/runtime-pi/tool-definitions.ts');
    const personal = {text: 'Answer in French.', digest: 'abc123'};
    const wrapped = withPersonalInstructions('HOST', personal);
    expect(wrapped.startsWith('HOST')).toBe(true);
    expect(wrapped).toContain('personal instructions');
    expect(wrapped).toContain('"source":"personal-instructions"');
    expect(wrapped).toContain('"digest":"abc123"');
    expect(wrapped).toContain('precedence over these personal instructions');
    expect(withPersonalInstructions('HOST', undefined)).toBe('HOST');
    expect(withPersonalInstructions('HOST')).toBe('HOST');
  });
  it('the project header names personal instructions as lower precedence', async () => {
    const source = await import('node:fs/promises').then(fs => fs.readFile('packages/core/approved-project-context.ts', 'utf8'));
    expect(source).toContain("Project instructions take precedence over the user\\'s personal instructions.");
  });
});
