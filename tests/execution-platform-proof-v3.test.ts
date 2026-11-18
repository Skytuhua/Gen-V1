import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKSPACE_EXECUTE_NO_NETWORK, type ExecutionProfileV1 } from '../packages/contracts/execution-profile.ts';
import { DebugRegistry, type DebugAdapter } from '../packages/core/debug-session.ts';
import {
  assertProvenBackend, digestFileSha256, evaluateExecution, type ExecutionBackend,
} from '../packages/core/execution-policy.ts';
import { createProjectTrust } from '../packages/core/project-trust.ts';

const roots: string[] = [];
const foreignPlatform = process.platform === 'win32' ? 'linux' : 'win32';
const flags = {
  HARNESS_FLAG_SECURITY_EXECUTION_PROFILES_V1: '1',
  HARNESS_FLAG_SECURITY_PROJECT_TRUST_V1: '1',
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

// These doubles test admission only. They do not certify a native launcher.
function backend(platform: string, proofPlatform: string): ExecutionBackend {
  return {
    backendId: 'fixture-backend', platform, installed: true, approved: true,
    proof: {
      platformProofRef: 'fixture-proof', platform: proofPlatform, status: 'PASS',
      recordedAt: '2026-11-17T00:00:00.000Z',
    },
    launch: async () => ({ id: 'fixture-handle', terminate: async () => {} }),
  };
}
const debugAdapter = (): DebugAdapter => ({
  launch: async () => 'fixture-debug-process',
  send: async () => ({}), inspect: async () => ({}),
  state: () => 'PAUSED', terminate: async () => {},
});
const recipe = {
  recipeId: 'fixture-recipe', executableDigest: 'a'.repeat(64),
  confinementProfile: WORKSPACE_EXECUTE_NO_NETWORK,
};

async function evaluate(candidate: ExecutionBackend) {
  const root = await mkdtemp(join(tmpdir(), 'platform-proof-'));
  roots.push(root);
  const executable = join(root, 'fixture-tool.txt');
  await writeFile(executable, 'fixture executable bytes');
  const trust = await createProjectTrust({
    trustId: 'fixture-trust', rootPath: root,
    approvedFiles: [{ path: 'fixture-tool.txt', kind: 'executable' }],
    scope: { read: true, write: false, network: 'none' }, decision: 'trusted',
  });
  const profile: ExecutionProfileV1 = {
    profileId: WORKSPACE_EXECUTE_NO_NETWORK, version: 1,
    backendId: 'fixture-backend', capabilities: ['process.execute', 'fs.read'],
    readRoots: [root], writeRoots: [], networkPolicy: { mode: 'none' }, secretRefs: [],
    executableAllowlist: [{ executableSha256: await digestFileSha256(executable), argv: [] }],
    platformProofRef: 'fixture-proof',
  };
  return evaluateExecution({
    profile, request: { kind: 'executable', executable, argv: [], cwd: root },
    trust, trustRootPath: root, approvedBackendId: 'fixture-backend',
    backends: [candidate], env: flags,
  });
}

const mismatches = [
  { name: 'proof belongs to a different platform', backendPlatform: process.platform, proofPlatform: foreignPlatform },
  { name: 'backend and proof belong to a different host platform', backendPlatform: foreignPlatform, proofPlatform: foreignPlatform },
  { name: 'backend belongs to a different platform', backendPlatform: foreignPlatform, proofPlatform: process.platform },
];

describe('M03 platform proof binding at execution boundaries', () => {
  for (const mismatch of mismatches) {
    it(`blocks an execution decision when the ${mismatch.name}`, async () => {
      const result = await evaluate(backend(mismatch.backendPlatform, mismatch.proofPlatform));
      expect(result).toMatchObject({ status: 'BLOCKED', code: 'PLATFORM_PROOF_REQUIRED' });
    });

    it(`blocks debugger launch when the ${mismatch.name}`, async () => {
      const registry = new DebugRegistry(
        [backend(mismatch.backendPlatform, mismatch.proofPlatform)],
        'fixture-backend', debugAdapter,
      );
      await expect(registry.launch({
        owner: 'fixture-owner', recipe, signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    });
  }

  it('preserves matching host platform admission without claiming native isolation', async () => {
    expect((await evaluate(backend(process.platform, process.platform))).status).toBe('ALLOW');
  });

  it('preserves matching debugger admission without claiming a real native launch', async () => {
    const registry = new DebugRegistry(
      [backend(process.platform, process.platform)], 'fixture-backend', debugAdapter,
    );
    const session = await registry.launch({
      owner: 'fixture-owner', recipe, signal: new AbortController().signal,
    });
    expect(session.state).toBe('PAUSED');
    expect(session.processIdentity).toBe('fixture-debug-process');
  });
});

describe('M03 language-server launch proof binding', () => {
  it('refuses a real language-server launch under a proof from another platform', () => {
    expect(() => assertProvenBackend([backend(process.platform, foreignPlatform)], 'fixture-backend'))
      .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }));
    expect(() => assertProvenBackend([backend(process.platform, process.platform)], 'fixture-backend'))
      .not.toThrow();
  });
});
