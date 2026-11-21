import { randomUUID } from 'node:crypto';
import { HarnessError } from '../contracts/index.ts';
import {
  controlTargetCandidateV1Schema,
  targetObservationV1Schema,
  type ControlActionV1,
  type ControlMode,
  type ControlTargetCandidateV1,
  type ControlTargetIdentityV1,
  type TargetObservationV1,
} from '../contracts/interactive-control.ts';
import type { ControlDriverOperations } from './desktop-control.ts';

/** Backend half of the M16 control bridge. The real adapter runs in the
 * desktop main process (it owns the WebContents and the native handle); this
 * proxy forwards each driver operation over the private parent-IPC channel
 * with launch-token custody — the same custody as shutdown (R06). Errors come
 * back as {code,message} and are rethrown as HarnessError so DRIVER_UNAVAILABLE,
 * TARGET_MISMATCH and consent denials keep their exact codes. */

export interface SidecarSend {
  (value: Record<string, unknown>): Promise<void> | void;
}

interface PendingCall {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ControlSidecarChannel {
  request(op: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  /** Routes an incoming 'harness.control.result' to the pending call. */
  handleReply(value: Record<string, unknown>): boolean;
  /** Drops every pending call (backend/bridge teardown). */
  reset(): void;
}

export function createControlSidecarChannel(deps: { send: SidecarSend; token: string }): ControlSidecarChannel {
  const pending = new Map<string, PendingCall>();
  return {
    request(op, payload, timeoutMs = 15000) {
      const requestId = `control-${randomUUID()}`;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new HarnessError('DRIVER_UNAVAILABLE', `The control driver did not acknowledge ${op}.`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        Promise.resolve(deps.send({ type: 'harness.control.call', token: deps.token, requestId, op, payload })).catch(error => {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error instanceof Error ? error : new HarnessError('DRIVER_UNAVAILABLE', String(error)));
        });
      });
    },
    handleReply(value) {
      if (value.type !== 'harness.control.result' || typeof value.requestId !== 'string') return false;
      const entry = pending.get(value.requestId);
      if (!entry) return true;
      pending.delete(value.requestId);
      clearTimeout(entry.timer);
      if (value.error && typeof value.error === 'object') {
        const error = value.error as { code?: unknown; message?: unknown };
        entry.reject(new HarnessError(typeof error.code === 'string' && error.code ? error.code : 'DRIVER_ERROR', typeof error.message === 'string' ? error.message : 'The control driver operation failed.'));
      } else if (value.error) {
        entry.reject(new HarnessError('DRIVER_ERROR', String(value.error).slice(0, 500)));
      } else {
        entry.resolve((value.result ?? {}) as Record<string, unknown>);
      }
      return true;
    },
    reset() {
      for (const [id, entry] of pending) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.reject(new HarnessError('DRIVER_UNAVAILABLE', 'The control driver channel was reset.'));
      }
    },
  };
}

/** Re-throw the driver-transported error with its original HarnessError code
 * when present so contract decisions keep exact codes (D01/D03). */
function rethrow(error: unknown): never {
  if (error instanceof HarnessError) throw error;
  throw new HarnessError('DRIVER_ERROR', error instanceof Error ? error.message : String(error));
}

/** The backend-side ControlDriverOperations that delegates to the desktop
 * bridge over 'harness.control.call'. One registration per supported mode
 * protocol ('browser-tab' for tab targets, 'native-window' for the selected
 * desktop window) — the two entries share one artifact digest and one IPC
 * adapter, which is the single host-owned registration D02 requires. */
export function createSidecarControlDriver(channel: ControlSidecarChannel): ControlDriverOperations {
  const call = async <T>(op: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<T> => {
    try {
      return (await channel.request(op, payload, timeoutMs)) as unknown as T;
    } catch (error) {
      rethrow(error);
    }
  };
  return {
    async candidates(mode: ControlMode): Promise<ControlTargetCandidateV1[]> {
      const result = await call<{ candidates?: unknown[] }>('candidates', { mode });
      const list = Array.isArray(result.candidates) ? result.candidates : [];
      return list.map(item => controlTargetCandidateV1Schema.parse(item));
    },
    async pickTarget(mode: ControlMode): Promise<ControlTargetCandidateV1 | null> {
      // The OS picker's modal lifetime belongs to the user, not our timeout.
      const result = await call<{ candidate?: unknown }>('pickTarget', { mode }, 120000);
      return result.candidate == null ? null : controlTargetCandidateV1Schema.parse(result.candidate);
    },
    async observe(target: ControlTargetIdentityV1): Promise<TargetObservationV1> {
      const result = await call<{ observation?: unknown }>('observe', { target });
      return targetObservationV1Schema.parse(result.observation);
    },
    async capture(target: ControlTargetIdentityV1): Promise<{ data: Uint8Array; width: number; height: number; mimeType: 'image/png' }> {
      const result = await call<{ pngBase64?: string; width?: number; height?: number }>('capture', { target });
      if (typeof result.pngBase64 !== 'string' || typeof result.width !== 'number' || typeof result.height !== 'number') {
        throw new HarnessError('DRIVER_ERROR', 'The control driver returned an invalid capture frame.');
      }
      return { data: Buffer.from(result.pngBase64, 'base64'), width: result.width, height: result.height, mimeType: 'image/png' };
    },
    async dispatch(action: ControlActionV1): Promise<{ receipt: string }> {
      const result = await call<{ receipt?: unknown }>('dispatch', { action });
      return { receipt: typeof result.receipt === 'string' ? result.receipt : `driver-${action.actionId}` };
    },
    async cancelInput(target: ControlTargetIdentityV1): Promise<void> {
      await call('cancel', { target });
    },
  };
}
