import { spawn, type ChildProcess } from 'node:child_process';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { HarnessError } from '../contracts/index.ts';
import type { AccountIdentity } from '../contracts/authentication.ts';
import { terminateProcessTree } from '../runtime-pi/process-tree.ts';
import { asyncQueue, bounded } from './internal.ts';
import { officialRuntimeCommand, officialRuntimeEnvironment, officialRuntimeHome } from './environment.ts';
import { secureDirectory } from './manifest.ts';
import { assertClaudeSubscription, type ClaudeSdk } from './claude.ts';
import { bindOfficialIdentity, claudeIdentity } from './account-identity.ts';

/** Query initialization only: the prompt stream remains empty and no tools exist. */
export async function claudeAccountStatus(dataDir: string, sdk?: ClaudeSdk): Promise<AccountIdentity> {
  sdk ??= await import('@anthropic-ai/claude-agent-sdk');
  const home = await secureDirectory(dataDir, officialRuntimeHome(dataDir, 'claude-code'));
  const children: ChildProcess[] = [], input = asyncQueue<SDKUserMessage>();
  let query: ReturnType<ClaudeSdk['query']> | undefined;
  try {
  query = sdk.query({ prompt: input, options: {
    cwd: home, env: officialRuntimeEnvironment(dataDir, 'claude-code'), pathToClaudeCodeExecutable: officialRuntimeCommand('claude-code').file,
    tools: [], mcpServers: {}, settingSources: [], strictMcpConfig: true, skills: [], plugins: [], agents: {}, persistSession: false,
    spawnClaudeCodeProcess(options) { const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' }); children.push(child); child.on('error', () => {}); child.stdin?.on('error', () => {}); child.stdout?.on('error', () => {}); child.stderr?.on('error', () => {}); child.stderr?.resume(); return child as ReturnType<NonNullable<import('@anthropic-ai/claude-agent-sdk').Options['spawnClaudeCodeProcess']>>; },
  } });
    const account = await bounded(query.accountInfo(), 15_000, 'Claude account check timed out.'); assertClaudeSubscription(account);
    const identity = claudeIdentity(account); await bindOfficialIdentity(dataDir, 'claude-code', identity); return identity;
  } finally {
    input.close();
    try { if (query) { await bounded(query.interrupt().catch(() => {}), 1000, 'Claude account check close grace elapsed.').catch(() => {}); query.close(); } }
    finally {
      const results = await Promise.allSettled(children.map(child => terminateProcessTree(child)));
      if (results.some(result => result.status === 'rejected')) throw new HarnessError('RUNTIME_TEARDOWN_FAILED', 'The native account check did not close completely. This account remains blocked.');
    }
  }
}
