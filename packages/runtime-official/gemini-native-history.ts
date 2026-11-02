import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { HarnessError } from '../contracts/index.ts';
import { officialRuntimeHome } from './environment.ts';
import type { HistoryReceipt } from './internal.ts';
import { within, type ManifestState } from './manifest.ts';
import { leadingReceipts } from './receipts.ts';

const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const mismatch = () => new HarnessError('OFFICIAL_SESSION_MISMATCH', 'Gemini native history does not belong to this canonical task and official session.');
async function boundedFile(root: string, path: string, maximum: number): Promise<string> {
  const actual = await realpath(path);
  if (!within(await realpath(root), actual)) throw mismatch();
  const info = await stat(actual);
  if (!info.isFile() || info.size > maximum) throw new HarnessError('OFFICIAL_HISTORY_LIMIT', 'Official Gemini history exceeds the bounded reader limit. Input delivery remains unresolved.');
  return readFile(actual, 'utf8');
}

/** Published 0.66 storage: projects.json maps normalized cwd to a .project_root-bound slug. */
export async function findGeminiNativeSession(dataDir: string, manifest: ManifestState): Promise<{ path: string; text: string } | null> {
  if (!manifest.value.sessionId) return null;
  const home = officialRuntimeHome(dataDir, 'gemini-cli');
  const taskDir = dirname(manifest.path);
  let registry: any;
  try { registry = JSON.parse(await boundedFile(home, join(home, '.gemini', 'projects.json'), 1024 * 1024)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const slug = registry?.projects?.[normalize(taskDir)];
  if (slug === undefined) return null;
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,200}$/.test(slug)) throw mismatch();
  const project = join(home, '.gemini', 'tmp', slug);
  const marker = await boundedFile(home, join(project, '.project_root'), 8192);
  if (normalize(marker.trim()) !== normalize(taskDir)) throw mismatch();
  const chats = join(project, 'chats');
  const actualChats = await realpath(chats);
  if (!within(await realpath(home), actualChats)) throw mismatch();
  const entries = await readdir(actualChats, { withFileTypes: true });
  if (entries.length > 4096) throw new HarnessError('OFFICIAL_HISTORY_LIMIT', 'Official Gemini history directory exceeds the bounded reader limit.');
  const suffix = `-${manifest.value.sessionId.slice(0, 8)}.jsonl`;
  const matches = entries.filter(entry => entry.name.startsWith('session-') && entry.name.endsWith(suffix));
  if (matches.length > 16) throw new HarnessError('OFFICIAL_HISTORY_LIMIT', 'Too many native Gemini sessions share this identifier prefix.');
  for (const entry of matches) {
    if (!entry.isFile()) throw mismatch();
    const path = join(actualChats, entry.name);
    const text = await boundedFile(actualChats, path, 32 * 1024 * 1024);
    let header: any;
    try { header = JSON.parse(text.slice(0, text.indexOf('\n') < 0 ? undefined : text.indexOf('\n'))); } catch { throw mismatch(); }
    if (header.sessionId !== manifest.value.sessionId) continue;
    if (header.projectHash !== createHash('sha256').update(taskDir).digest('hex')) throw mismatch();
    return { path, text };
  }
  return null;
}

export async function readGeminiNativeHistory(dataDir: string, manifest: ManifestState): Promise<HistoryReceipt[]> {
  const session = await findGeminiNativeSession(dataDir, manifest);
  if (!session) return [];
  const receipts = new Map<string, HistoryReceipt>();
  for (const line of session.text.split(/\r?\n/).slice(1)) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; /* A torn last append is not a receipt. */ }
    if (entry?.type !== 'user') continue;
    const text = typeof entry.content === 'string' ? entry.content : Array.isArray(entry.content) && typeof entry.content[0]?.text === 'string' ? entry.content[0].text : undefined;
    if (typeof text !== 'string') continue;
    for (const receipt of leadingReceipts(manifest, text)) receipts.set(receipt.uuid, receipt);
  }
  return [...receipts.values()];
}
