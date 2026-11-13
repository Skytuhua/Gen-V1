import { createRequire } from 'node:module';
import { HarnessError } from '../contracts/index.ts';
import type { LinuxCredentialReadBarrier } from './linux-path-guard.ts';

interface NativeLease { read(): Buffer; release(): void }
interface NativeModule { acquire(path: string): NativeLease }
const denied = () => new HarnessError('PI_CREDENTIAL_LEASE_UNAVAILABLE', 'Protected credential evidence is unavailable.');

/** The actual Node process owns the Win32 share-deny handles; no helper receipts grant authority. */
export function acquireWindowsCredentialReadBarrier(authPath: string, options: {signal: AbortSignal; maxHoldMs: number}): LinuxCredentialReadBarrier & {read(): Buffer} {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !options || !(options.signal instanceof AbortSignal)
    || !Number.isSafeInteger(options.maxHoldMs) || options.maxHoldMs < 1 || options.maxHoldMs > 300000) throw denied();
  options.signal.throwIfAborted();
  const started = performance.now(), expiresAt = Date.now() + options.maxHoldMs;
  let native: NativeLease;
  try {native = (createRequire(import.meta.url)('./windows-credential-lease.node') as NativeModule).acquire(authPath);}
  catch {throw denied();}
  const revoked = new AbortController();
  let releasePromise: Promise<void> | undefined;
  let resolveSettled!: () => void, rejectSettled!: (error: unknown) => void;
  const settled = new Promise<void>((done, fail) => {resolveSettled = done; rejectSettled = fail;}); void settled.catch(() => {});
  const revoke = () => {if (!revoked.signal.aborted) revoked.abort(denied());};
  const read = () => {
    if (revoked.signal.aborted || options.signal.aborted || performance.now() - started >= options.maxHoldMs || Date.now() >= expiresAt) {revoke(); throw denied();}
    try {return native.read();} catch {revoke(); throw denied();}
  };
  const timer = setTimeout(revoke, Math.max(0, options.maxHoldMs - (performance.now() - started))); timer.unref();
  options.signal.addEventListener('abort', revoke, {once: true});
  const release = () => {
    if (!releasePromise) {
      releasePromise = Promise.resolve().then(() => {try {native.release();} catch {throw new HarnessError('PI_CREDENTIAL_LEASE_RELEASE_UNCERTAIN', 'Credential evidence custody did not settle. Retain caller custody.');}});
      void releasePromise.then(resolveSettled, rejectSettled);
      revoke(); clearTimeout(timer); options.signal.removeEventListener('abort', revoke);
    }
    return releasePromise;
  };
  return Object.freeze({expiresAt, signal: revoked.signal, settled, read, assertCurrent() {read();}, release});
}
