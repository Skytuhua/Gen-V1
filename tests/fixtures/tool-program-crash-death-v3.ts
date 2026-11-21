import { expect } from 'vitest';

/** Asserts the crash child really died at its requested boundary. POSIX
 *  reports code null + SIGKILL; Windows maps process.kill to TerminateProcess
 *  and reports code 1 + signal null (observed on CI job 135179485851). The
 *  fixture is silent on success, so '' output plus the persisted killedAt
 *  checkpoint (asserted by callers) distinguishes the intended death from a
 *  bootstrap failure, which would leave stderr noise or no checkpoint.
 *  Imported by test files only — never by tool-program-crash-v3.mts, the
 *  spawned child process, which cannot load vitest. */
export function assertCrashDeath(exit: { code: number | null; signal: NodeJS.Signals | null; output: string }) {
  if (process.platform === 'win32') {
    expect(exit, exit.output).toMatchObject({ code: 1, signal: null });
    expect(exit.output).toBe('');
  } else {
    expect(exit, exit.output).toMatchObject({ code: null, signal: 'SIGKILL' });
  }
}
