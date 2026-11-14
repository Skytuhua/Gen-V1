import { expect, it, vi } from 'vitest';
import { finishBackendStartup } from '../apps/desktop/backend-policy';

const deferred = () => {
  let complete!: () => void;
  const promise = new Promise<void>(resolve => { complete = resolve; });
  return { promise, complete };
};

it.each([{ exitCode: 7, signalCode: null }, { exitCode: null, signalCode: 'SIGTERM' as const }])(
  'does not activate a backend that stops while the old relay closes (%j)',
  async stopped => {
    const drain = deferred(), activate = vi.fn();
    const child: { exitCode: number | null; signalCode: NodeJS.Signals | null } = { exitCode: null, signalCode: null };
    const result = finishBackendStartup(child, drain.promise, () => 'backend diagnostic', activate);
    const rejection = expect(result).rejects.toThrow(/stopped during startup.*backend diagnostic/);
    Object.assign(child, stopped);
    drain.complete();
    await rejection;
    expect(activate).not.toHaveBeenCalled();
  }
);

it('activates a live backend only after the old relay is closed', async () => {
  const drain = deferred(), activate = vi.fn();
  const result = finishBackendStartup({ exitCode: null, signalCode: null }, drain.promise, () => '', activate);
  expect(activate).not.toHaveBeenCalled();
  drain.complete();
  await result;
  expect(activate).toHaveBeenCalledOnce();
});
