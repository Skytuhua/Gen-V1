import {describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareInstalledNativeSave, readInstalledNativeSave, parseInstalledNativeSaveTranscript, installedNativeSaveCommand} from '../scripts/installed-native-save.ts';

const pid = 4821, ticks = '638988400000000000';
const stages = ['ready', 'dialog-found', 'file-name-set', 'save-invoked', 'dialog-closed', 'target-released'];
const transcript = () => stages.map((phase, index) => ({phase, pid, processStartTicks: ticks, dialogHandle: index ? '123456' : null, elapsedMs: index * 100}));
const lines = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');

describe('installed native Save proof custody', () => {
  it('keeps the complete fixed PowerShell command below the real Windows argv limit without a policy override', () => {
    const command = installedNativeSaveCommand('C:\\Windows');
    const complete = '"' + command.file + '" ' + command.args.join(' ') + '\0';
    expect(command.commandLineCharacters).toBe(complete.length);
    expect(complete.length).toBeLessThan(32767);
    expect(command.args).not.toContain('-ExecutionPolicy');
    const script = Buffer.from(command.args.at(-1)!, 'base64').toString('utf16le');
    expect(script).toContain('[Console]::In.ReadLine()');
    expect(script).not.toContain('C:\\Windows');
    for (const path of ['relative', 'C:\\Windows\n', 'C:\\"Windows', 'C:\\' + 'x'.repeat(300)]) expect(() => installedNativeSaveCommand(path)).toThrow();
  });

  it('uses one absent fixed file in the verified evidence directory and reads only that completed regular file', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'native-save-')));
    try {
      const target = await prepareInstalledNativeSave(root);
      expect(target.path).toBe(join(root, 'installed-memory-redacted-export.json'));
      await expect(readInstalledNativeSave(target)).rejects.toThrow();
      await expect(readInstalledNativeSave({...target, path: join(root, 'unowned.json')})).rejects.toThrow(/fixed|target/i);
      const bytes = Buffer.from('{"redacted":true}\n');
      await writeFile(target.path, bytes, {flag: 'wx'});
      expect(await readInstalledNativeSave(target)).toEqual(bytes);
      await expect(prepareInstalledNativeSave(root)).rejects.toThrow(/already|absent/i);
      expect(await readFile(target.path)).toEqual(bytes);
    } finally {await rm(root, {recursive: true, force: true});}
  });

  it('refuses a redirected evidence directory and preserves an existing redirected output', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'native-save-link-')));
    try {
      const real = join(root, 'real'), redirected = join(root, 'redirected');
      await mkdir(real); await symlink(real, redirected, 'junction');
      await expect(prepareInstalledNativeSave(redirected)).rejects.toThrow(/ordinary|canonical|redirect/i);
      const outside = join(root, 'private.json'); await writeFile(outside, 'DO_NOT_READ_OR_OVERWRITE');
      const target = await prepareInstalledNativeSave(real);
      await symlink(outside, target.path, 'file');
      await expect(prepareInstalledNativeSave(real)).rejects.toThrow(/already|absent/i);
      await expect(readInstalledNativeSave(target)).rejects.toThrow(/regular|redirect/i);
      expect(await readFile(outside, 'utf8')).toBe('DO_NOT_READ_OR_OVERWRITE');
    } finally {await rm(root, {recursive: true, force: true});}
  });

  it('refuses a replaced evidence directory and empty or oversized saved files', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'native-save-replaced-')));
    try {
      const directory = join(root, 'owned'); await mkdir(directory);
      const target = await prepareInstalledNativeSave(directory);
      await writeFile(target.path, '');
      await expect(readInstalledNativeSave(target)).rejects.toThrow(/bound|empty|size/i);
      await writeFile(target.path, Buffer.alloc(1024 * 1024 + 1, 65));
      await expect(readInstalledNativeSave(target)).rejects.toThrow(/bound|size/i);
      await rename(directory, join(root, 'original')); await mkdir(directory);
      await writeFile(target.path, '{"redacted":true}');
      await expect(readInstalledNativeSave(target)).rejects.toThrow(/identity|changed/i);
    } finally {await rm(root, {recursive: true, force: true});}
  });

  it('admits only the ordered native dialog lifecycle for the same process and dialog', () => {
    const output = parseInstalledNativeSaveTranscript(lines(transcript()), pid);
    expect(output).toMatchObject({status: 'completed', pid, processStartTicks: ticks, dialogHandle: '123456'});
    expect(output.events.map(event => event.phase)).toEqual(stages);
    expect(parseInstalledNativeSaveTranscript(lines(transcript().slice(0, 1)), pid).status).toBe('running');
  });

  it('rejects another process, process reuse, replacement dialogs, missing stages and forged fields', () => {
    const changedPid = transcript(); changedPid[2]!.pid++;
    const reused = transcript(); reused[2]!.processStartTicks = '638988400000000001';
    const newDialog = transcript(); newDialog[2]!.dialogHandle = '654321';
    const backwards = transcript(); backwards[3]!.elapsedMs = 50;
    for (const input of [changedPid, reused, newDialog, backwards, transcript().filter((_event, i) => i !== 2), [...transcript(), transcript()[4]], [...transcript().slice(0, 1), {...transcript()[1], secret: 'PRIVATE_VALUE'}]]) {
      expect(() => parseInstalledNativeSaveTranscript(lines(input), pid)).toThrow(/native|dialog|process|observation/i);
    }
  });

  it('preserves bounded fixed failure metadata without accepting completion or unrelated control text', () => {
    const failure = {phase: 'failed', pid, processStartTicks: ticks, dialogHandle: '123456', elapsedMs: 250, reason: 'unknown-controls', controls: [{controlType: 'edit', automationId: '1001', name: '<other>', className: 'Edit', pid, enabled: true}]};
    const result = parseInstalledNativeSaveTranscript(lines([...transcript().slice(0, 2), failure]), pid);
    expect(result).toMatchObject({status: 'failed', failure: 'unknown-controls'});
    expect(() => parseInstalledNativeSaveTranscript(lines([...transcript().slice(0, 2), {...failure, controls: [{...failure.controls[0], name: 'PRIVATE_FILE_CONTENT'}]}]), pid)).toThrow();
    expect(() => parseInstalledNativeSaveTranscript(lines([...transcript().slice(0, 2), {...failure, controls: [{...failure.controls[0], pid: pid + 1}]}]), pid)).toThrow();
    expect(() => parseInstalledNativeSaveTranscript(lines([...transcript(), failure]), pid)).toThrow();
    expect(() => parseInstalledNativeSaveTranscript('x'.repeat(32769), pid)).toThrow(/bound|native/i);
  });
});
