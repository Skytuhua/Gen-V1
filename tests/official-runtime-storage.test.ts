import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { officialRuntimeEnvironment, officialRuntimeHome, officialRuntimeCommand } from '../packages/runtime-official/environment.ts';
import { openManifest, readManifest, saveManifest } from '../packages/runtime-official/manifest.ts';

describe('official runtime storage and subprocess isolation', () => {
  it('uses published commands and isolated homes without inheriting provider or Node injection variables', () => {
    const original = { ...process.env };
    try {
      process.env.ANTHROPIC_API_KEY = 'do-not-forward';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'do-not-forward';
      process.env.GEMINI_API_KEY = 'do-not-forward';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = 'do-not-forward';
      process.env.NODE_OPTIONS = '--require hostile.js';
      process.env.HTTPS_PROXY = 'https://hostile.invalid';
      for (const name of ['CURSOR_API_KEY','CURSOR_BACKEND_URL','CURSOR_WEBSITE_URL','CURSOR_AGENT','NODE_PATH','HTTP_PROXY','ALL_PROXY','OPENAI_API_KEY','XDG_STATE_HOME','XDG_CACHE_HOME']) process.env[name]='do-not-forward';
      for (const provider of ['claude-code', 'gemini-cli', 'cursor-sdk'] as const) {
        const env = officialRuntimeEnvironment('C:/data', provider);
        expect(env.HOME).toBe(officialRuntimeHome('C:/data', provider));
        expect(env.USERPROFILE).toBe(env.HOME);
        for (const name of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GEMINI_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','CURSOR_API_KEY','CURSOR_BACKEND_URL','CURSOR_WEBSITE_URL','CURSOR_AGENT','OPENAI_API_KEY']) expect(env[name]).toBeUndefined();
        if(provider==='cursor-sdk'){
          for(const name of ['APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_STATE_HOME','XDG_CACHE_HOME'])expect(env[name]).toMatch(new RegExp(officialRuntimeHome('C:/data',provider).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
          expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();expect(env.GEMINI_CLI_HOME).toBeUndefined();
        }
      }
      expect(officialRuntimeCommand('claude-code').file).toMatch(/claude(?:\.exe)?$/);
      expect(officialRuntimeCommand('gemini-cli').args[0]).toMatch(/bundle[\\/]gemini\.js$/);
      expect(officialRuntimeCommand('cursor-sdk')).toMatchObject({file:process.execPath,args:['--import',expect.stringMatching(/^file:/),expect.stringMatching(/runtime-official[\\/]cursor-worker\.ts$/)]});
    } finally { process.env = original; }
  });

  it('parses canonical Cursor manifests without treating pending availability as storage ownership', async () => {
    const dataDir=await mkdtemp(join(tmpdir(),'official-cursor-storage-'));
    const state=await openManifest(dataDir,'cursor-sdk','thread-a',null);
    state.value.sessionId='cursor-native-session';await saveManifest(state);
    expect((await readManifest(dataDir,state.path)).value.provider).toBe('cursor-sdk');
    await expect(openManifest(dataDir,'gemini-cli','thread-a',state.path)).rejects.toMatchObject({code:'OFFICIAL_SESSION_MISMATCH'});
    await expect(openManifest(dataDir,'cursor-sdk','thread-b',state.path)).rejects.toMatchObject({code:'OFFICIAL_SESSION_MISMATCH'});
  });

  it('binds durable input UUID receipts to one provider and thread', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'official-storage-'));
    const state = await openManifest(dataDir, 'claude-code', 'thread-a', null);
    state.value.sessionId = 'official-session';
    state.value.inputs['client-uuid'] = { inputIds: ['input-a'], runId: 'run-a', epoch: 1, observed: true };
    await saveManifest(state);
    expect((await readManifest(dataDir, state.path)).value.inputs['client-uuid'].observed).toBe(true);
    await expect(openManifest(dataDir, 'gemini-cli', 'thread-a', state.path)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
    await expect(openManifest(dataDir, 'claude-code', 'thread-b', state.path)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
    expect(JSON.parse(await readFile(state.path, 'utf8')).provider).toBe('claude-code');
  });

  it('rejects edited identity and paths outside canonical task storage', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'official-storage-'));
    const state = await openManifest(dataDir, 'claude-code', 'thread-a', null);
    const escaped = join(dataDir, 'session.json');
    await writeFile(escaped, JSON.stringify(state.value));
    await expect(readManifest(dataDir, escaped)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
    state.value.threadId = 'thread-b';
    await writeFile(state.path, JSON.stringify(state.value));
    await expect(readManifest(dataDir, state.path)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
    const outside = await mkdtemp(join(tmpdir(), 'official-outside-'));
    const other = await mkdtemp(join(tmpdir(), 'official-link-'));
    await mkdir(join(other, 'official'), { recursive: true });
    await symlink(outside, join(other, 'official', 'claude-code'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(openManifest(other, 'claude-code', 'thread-a', null)).rejects.toMatchObject({ code: 'OFFICIAL_SESSION_MISMATCH' });
  });

  it('keeps receipts when history reconciliation and active input append save concurrently', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'official-storage-'));
    const active = await openManifest(dataDir, 'claude-code', 'thread-a', null);
    active.value.inputs['uuid-a'] = { inputIds: ['a'], runId: 'run-a', epoch: 1, observed: false };
    await saveManifest(active);
    const history = await readManifest(dataDir, active.path);
    history.value.inputs['uuid-a'].observed = true;
    active.value.inputs['uuid-b'] = { inputIds: ['b'], runId: 'run-a', epoch: 1, observed: false };
    await Promise.all([saveManifest(history), saveManifest(active)]);
    const saved = (await readManifest(dataDir, active.path)).value;
    expect(saved.inputs['uuid-a'].observed).toBe(true);
    expect(saved.inputs['uuid-b'].inputIds).toEqual(['b']);
  });
});
