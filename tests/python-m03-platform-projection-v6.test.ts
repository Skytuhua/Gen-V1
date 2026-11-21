import { describe, expect, it } from 'vitest';
import { hasCurrentPlatformProof, type ExecutionBackend, type PlatformProof } from '../packages/core/execution-policy.ts';
import { pythonExecutionBackend, pythonM03PlatformProjection, type PythonRuntimeConfiguration } from '../packages/runtime/python-program-worker.ts';

// The Python proof is linux-x64 specific while the shared M03 check compares
// with Node's process.platform. Only the exact linux-x64 PASS on an actual
// Linux x64 host projects to M03; everything else exposes no current proof.
const LINUX_X64 = { platform: 'linux', arch: 'x64' } as const;
const proof: PlatformProof = Object.freeze({
  platformProofRef: 'm12-python-native-test-matrix', platform: 'linux-x64', status: 'PASS',
  recordedAt: '2026-11-15T00:00:00.000Z', evidenceRef: 'tests/python-program-backend-v3.test.ts',
});
const backendWith = (projection: { platform: string; proof: PlatformProof | null }): ExecutionBackend => ({
  backendId: 'm12-linux-bwrap-python-v1', platform: projection.platform, installed: true, approved: true, proof: projection.proof,
  launch: async () => { throw new Error('not launched in this test'); },
});
const hostIsLinux = process.platform === 'linux';

describe('M12 Python adapter projection for the shared M03 platform-proof check', () => {
  it('projects the exact linux-x64 PASS to a linux host proof without changing its identity fields', () => {
    const before = structuredClone(proof);
    const projection = pythonM03PlatformProjection(proof, LINUX_X64);
    expect(projection).toEqual({ platform: 'linux', proof: { platformProofRef: proof.platformProofRef, platform: 'linux', status: 'PASS',
      recordedAt: proof.recordedAt, evidenceRef: proof.evidenceRef } });
    expect(Object.isFrozen(projection.proof)).toBe(true);
    expect(proof).toEqual(before);
    // The shared check itself is unchanged: it accepts the projection only on a Linux Node host.
    expect(hasCurrentPlatformProof(backendWith(projection))).toBe(hostIsLinux);
  });

  it.each([
    ['linux arm64 host', { platform: 'linux', arch: 'arm64' }, proof],
    ['win32 x64 host', { platform: 'win32', arch: 'x64' }, proof],
    ['darwin x64 host', { platform: 'darwin', arch: 'x64' }, proof],
    ['missing proof', LINUX_X64, null],
    ['OS-only proof platform', LINUX_X64, { ...proof, platform: 'linux' }],
    ['wrong-architecture proof', LINUX_X64, { ...proof, platform: 'linux-arm64' }],
    ['win32 proof', LINUX_X64, { ...proof, platform: 'win32' }],
    ['FAIL proof', LINUX_X64, { ...proof, status: 'FAIL' as const }],
    ['BLOCKED proof', LINUX_X64, { ...proof, status: 'BLOCKED' as const }],
    ['UNTESTED proof', LINUX_X64, { ...proof, status: 'UNTESTED' as const }],
    ['empty reference', LINUX_X64, { ...proof, platformProofRef: '' }],
    ['blank reference', LINUX_X64, { ...proof, platformProofRef: '  ' }],
    ['missing evidence', LINUX_X64, { ...proof, evidenceRef: undefined }],
    ['empty evidence', LINUX_X64, { ...proof, evidenceRef: '' }],
  ] as const)('exposes no current proof for %s', (_label, host, input) => {
    const projection = pythonM03PlatformProjection(input as PlatformProof | null, host);
    expect(projection).toEqual({ platform: 'linux-x64', proof: null });
    expect(hasCurrentPlatformProof(backendWith(projection))).toBe(false);
  });

  it('keeps the original proof for the worker and metadata and projects only for the actual host', () => {
    const runtime = { backendId: 'm12-linux-bwrap-python-v1', bwrap: { path: '/nonexistent/bwrap' }, interpreter: { path: '/nonexistent/python3.13' },
      stdlib: { path: '/nonexistent/stdlib' } } as unknown as PythonRuntimeConfiguration;
    const backend = pythonExecutionBackend({ runtime, generation: 1, platformProof: proof, approved: true });
    expect(backend.pythonPlatform).toBe('linux-x64');
    expect(backend.pythonPlatformProof).toBe(proof);
    expect(backend.approved).toBe(true);
    expect(backend.installed).toBe(false);
    const actualLinuxX64 = process.platform === 'linux' && process.arch === 'x64';
    expect({ platform: backend.platform, proof: backend.proof }).toEqual(pythonM03PlatformProjection(proof));
    expect(backend.platform).toBe(actualLinuxX64 ? 'linux' : 'linux-x64');
    expect(backend.proof === null).toBe(!actualLinuxX64);
    expect(hasCurrentPlatformProof(backend)).toBe(actualLinuxX64);
  });

  it('never projects a non-PASS or wrong-architecture proof through the real backend', () => {
    const runtime = { backendId: 'm12-linux-bwrap-python-v1', bwrap: { path: '/nonexistent/bwrap' }, interpreter: { path: '/nonexistent/python3.13' },
      stdlib: { path: '/nonexistent/stdlib' } } as unknown as PythonRuntimeConfiguration;
    for (const input of [{ ...proof, status: 'UNTESTED' as const }, { ...proof, platform: 'linux' }, { ...proof, platform: 'linux-arm64' }]) {
      const backend = pythonExecutionBackend({ runtime, generation: 1, platformProof: input, approved: true });
      expect(backend.proof).toBeNull();
      expect(backend.pythonPlatformProof).toBe(input);
      expect(hasCurrentPlatformProof(backend)).toBe(false);
    }
  });
});
