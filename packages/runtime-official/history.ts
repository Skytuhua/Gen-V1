import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { officialRuntimeEnvironment } from './environment.ts';
import { bounded, type HistoryReceipt } from './internal.ts';
import type { ManifestState } from './manifest.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';

/** SDK transcript helpers run in a separate isolated home, never with host process auth state. */
export async function claudeHistory(dataDir: string, manifest: ManifestState): Promise<HistoryReceipt[]> {
  const child = spawn(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, fileURLToPath(new URL('./history-command.ts', import.meta.url)), manifest.value.sessionId!, dirname(manifest.path), manifest.value.threadId], {
    cwd: dirname(manifest.path), env: officialRuntimeEnvironment(dataDir, 'claude-code'), stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32', windowsHide: true,
  });
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); if (output.length > 4 * 1024 * 1024) void terminateProcessTree(child); });
  try {
    await bounded(new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Official Claude Code history could not be read. Inputs with uncertain delivery remain unresolved.'))); }), 15_000, 'Official history reader timed out.');
    return JSON.parse(output) as HistoryReceipt[];
  } finally { await terminateProcessTree(child); }
}
