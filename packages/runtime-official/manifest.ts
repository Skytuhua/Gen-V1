import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { isOfficialRuntimeProviderId } from '../contracts/connections.ts';
import type { OfficialProvider } from './environment.ts';

export interface InputReceipt { inputIds: string[]; runId: string; epoch: number; observed: boolean }
export interface Manifest { version: 1; provider: OfficialProvider; threadId: string; sessionId: string | null; inputs: Record<string, InputReceipt> }
export interface ManifestState { path: string; value: Manifest; dataDir: string; write?: Promise<void> }
const mismatch = () => new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Official session does not belong to this provider and task storage.');
const writes = new Map<string, Promise<void>>();
export const threadDirectory = (dataDir: string, provider: OfficialProvider, threadId: string) => resolve(dataDir, 'official', provider, 'tasks', createHash('sha256').update(threadId).digest('hex'));
export function within(root: string, target: string): boolean { const part = relative(root, target); return part !== '' && !part.startsWith('..') && !isAbsolute(part); }

export async function secureDirectory(dataDir: string, target: string): Promise<string> {
  const root = resolve(dataDir);
  if (!within(root, resolve(target))) throw mismatch();
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Check every existing ancestor before mkdir, avoiding writes through an escaped junction.
  let ancestor = resolve(target);
  while (ancestor !== root) {
    try { const actual = await realpath(ancestor); if (!within(await realpath(root), actual)) throw mismatch(); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; ancestor = dirname(ancestor); }
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  const actual = await realpath(target);
  if (!within(await realpath(root), actual)) throw mismatch();
  return actual;
}

export async function readManifest(dataDir: string, sessionPath: string, provider?: OfficialProvider, threadId?: string): Promise<ManifestState> {
  const root = resolve(dataDir, 'official');
  const file = resolve(sessionPath);
  if (!within(root, file) || !file.endsWith(`${process.platform === 'win32' ? '\\' : '/'}session.json`)) throw mismatch();
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]);
  if (!within(realRoot, realFile) || !(await stat(realFile)).isFile()) throw mismatch();
  let value: Manifest;
  try { value = JSON.parse(await readFile(realFile, 'utf8')); } catch { throw mismatch(); }
  if (value?.version !== 1 || !isOfficialRuntimeProviderId(value.provider) || typeof value.threadId !== 'string' || !value.threadId || (value.sessionId !== null && (typeof value.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.sessionId))) || !value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs)) throw mismatch();
  if ((provider && provider !== value.provider) || (threadId && threadId !== value.threadId)) throw mismatch();
  const expected = join(threadDirectory(dataDir, value.provider, value.threadId), 'session.json');
  if (resolve(expected) !== file || await realpath(dirname(expected)) !== dirname(realFile)) throw mismatch();
  for (const [uuid, receipt] of Object.entries(value.inputs)) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(uuid) || !receipt || !Array.isArray(receipt.inputIds) || !receipt.inputIds.length || receipt.inputIds.some(id => typeof id !== 'string' || !id) || typeof receipt.runId !== 'string' || !Number.isSafeInteger(receipt.epoch) || typeof receipt.observed !== 'boolean') throw mismatch();
  }
  return { path: realFile, value, dataDir };
}

export async function openManifest(dataDir: string, provider: OfficialProvider, threadId: string, sessionPath: string | null,fresh=false): Promise<ManifestState> {
  if (sessionPath) return readManifest(dataDir, sessionPath, provider, threadId);
  const taskDir = await secureDirectory(dataDir, threadDirectory(dataDir, provider, threadId));
  const path = join(taskDir, 'session.json');
  if(fresh){
    const state:ManifestState={path,dataDir,value:{version:1,provider,threadId,sessionId:null,inputs:{}}};
    try{await writeFile(path,JSON.stringify(state.value),{flag:'wx',mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new HarnessError('PREDICTION_SESSION_UNSUPPORTED','Predictions require a fresh conversation.');throw error;}
    return state;
  }
  try { return await readManifest(dataDir, path, provider, threadId); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const state: ManifestState = { path, dataDir, value: { version: 1, provider, threadId, sessionId: null, inputs: {} } };
  await saveManifest(state);
  return state;
}

export function saveManifest(state: ManifestState): Promise<void> {
  const snapshot = structuredClone(state.value);
  const next = (writes.get(state.path) ?? Promise.resolve()).catch(() => {}).then(async () => {
    await secureDirectory(state.dataDir, dirname(state.path));
    try {
      const previous = JSON.parse(await readFile(state.path, 'utf8')) as Manifest;
      if (previous.version !== snapshot.version || previous.provider !== snapshot.provider || previous.threadId !== snapshot.threadId || (previous.sessionId && snapshot.sessionId && previous.sessionId !== snapshot.sessionId)) throw mismatch();
      snapshot.sessionId ??= previous.sessionId;
      for (const [uuid, receipt] of Object.entries(previous.inputs)) {
        const selected = snapshot.inputs[uuid];
        if (selected) {
          if (selected.runId !== receipt.runId || selected.epoch !== receipt.epoch || JSON.stringify(selected.inputIds) !== JSON.stringify(receipt.inputIds)) throw mismatch();
          selected.observed ||= receipt.observed;
          if (state.value.inputs[uuid]) state.value.inputs[uuid].observed ||= receipt.observed;
        } else snapshot.inputs[uuid] = receipt;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = join(dirname(state.path), `.session-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
    await rename(temporary, state.path);
  });
  state.write = next;
  writes.set(state.path, next);
  void next.finally(() => { if (writes.get(state.path) === next) writes.delete(state.path); }).catch(() => {});
  return next;
}
