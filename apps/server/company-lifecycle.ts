import {timingSafeEqual} from 'node:crypto';

/** Shared process lifecycle; the caller supplies the trusted host composition. */
export async function runCompanyHost(start: () => Promise<{origin: string; pid: number; close(): Promise<void>}>) {
  const token = process.env.HARNESS_DESKTOP_LAUNCH_TOKEN;
  const validToken = token !== undefined && /^[a-f0-9]{32,128}$/i.test(token);
  const startupFailure = 'The company interface could not start. Check its separate profile, port and service configuration.';
  let host: Awaited<ReturnType<typeof start>> | undefined;
  let stopping: Promise<void> | undefined;
  let stopRequested = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function message(value: Record<string, unknown>): Promise<void> {
    return new Promise(resolve => {
      if (!process.send || !process.connected) {resolve(); return;}
      try {process.send(value, undefined, undefined, () => resolve());}
      catch {resolve();}
    });
  }
  const sameToken = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{32,128}$/i.test(value) && validToken && value.length === token!.length && timingSafeEqual(Buffer.from(value), Buffer.from(token!));
  function stop() {
    stopRequested = true;
    deadline ??= setTimeout(() => {
      process.stderr.write('The company interface shutdown exceeded its deadline.\n'); process.exit(1);
    }, 10000);
    if (!host) return;
    return stopping ??= (async () => {
      try {
        await host!.close();
        if (validToken) await message({type: 'harness.stopped', token});
        process.exit(0);
      } catch {
        process.stderr.write('The company interface could not close its local listener.\n'); process.exit(1);
      } finally {clearTimeout(deadline);}
    })();
  }
  process.on('SIGINT', () => {void stop();});
  process.on('SIGTERM', () => {void stop();});
  process.on('disconnect', () => {void stop();});
  process.on('message', (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length === 2 && input.type === 'harness.shutdown' && sameToken(input.token)) void stop();
  });
  try {
    if (token !== undefined && !validToken) throw new Error('Invalid native launch token.');
    host = await start();
    if (stopRequested) await stop();
    else {
      process.stdout.write(`Gen company interface: ${host.origin}/company/communications\nCompany owner interface; employee execution remains unavailable.\n`);
      if (validToken) await message({type: 'harness.ready', token, origin: host.origin, pid: host.pid});
    }
  } catch {
    // Configuration may contain credential material. Only a fixed startup failure
    // leaves this process; the typed library exposes sanitized errors to callers.
    clearTimeout(deadline);
    if (validToken) await message({type: 'harness.error', token, message: startupFailure});
    process.stderr.write(startupFailure + '\n'); process.exit(1);
  }
}
