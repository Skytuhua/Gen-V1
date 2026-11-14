import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { officialRuntimeEnvironment } from './environment.ts';
import { bounded, type HistoryReceipt } from './internal.ts';
import type { ManifestState } from './manifest.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { HarnessError } from '../contracts/index.ts';

/** SDK transcript helpers run in a separate isolated home, never with host process auth state. */
export async function claudeHistory(dataDir: string, manifest: ManifestState, spawnProcess: typeof spawn = spawn): Promise<HistoryReceipt[]> {
  const child = spawnProcess(process.execPath, ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, fileURLToPath(new URL('./history-command.ts', import.meta.url)), manifest.value.sessionId!, dirname(manifest.path), manifest.value.threadId], {
    cwd: dirname(manifest.path), env: officialRuntimeEnvironment(dataDir, 'claude-code'), stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32', windowsHide: true,
  });
  let output = '';
  const finished = new Promise<void>((resolve, reject) => {
    const failed = () => reject(new HarnessError('OFFICIAL_PROCESS_IO_FAILED', 'The native Claude history connection closed unexpectedly. Input delivery remains unresolved.'));
    child.on('error', failed); child.stdout?.on('error', failed);
    child.stdout?.on('data', chunk => { output += chunk.toString(); if (output.length > 4 * 1024 * 1024) void terminateProcessTree(child); });
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Official Claude Code history could not be read. Inputs with uncertain delivery remain unresolved.')));
  });
  try {
    await bounded(finished, 15_000, 'Official history reader timed out.');
    return JSON.parse(output) as HistoryReceipt[];
  } finally { await terminateProcessTree(child); }
}
