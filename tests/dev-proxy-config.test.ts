import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

async function proxy(port?: string, fixtureMode = false, command: "serve" | "build" = "serve") {
  vi.resetModules();
  vi.stubEnv('HARNESS_PORT', port);
  vi.stubEnv('GEN_E2E', fixtureMode ? '1' : undefined);
  const config = (await import('../vite.config.ts')).default;
  return (typeof config === 'function' ? config({ command, mode: 'development' }) : config).server?.proxy;
}

it('uses the backend selected by HARNESS_PORT for both development proxy routes', async () => {
  const routes = await proxy('4417');
  expect(routes?.['/api']).toMatchObject({ target: 'http://127.0.0.1:4417' });
  expect(routes?.['/widget-runtime']).toMatchObject({ target: 'http://127.0.0.1:4417' });
});

it('preserves the default backend and keeps fixture browser tests unproxied', async () => {
  const routes = await proxy();
  expect(routes?.['/api']).toMatchObject({ target: 'http://127.0.0.1:4317' });
  expect(await proxy('4417', true)).toBeUndefined();
});

it('rejects an invalid backend port', async () => {
  await expect(proxy('4317junk')).rejects.toThrow(/HARNESS_PORT/);
});

it('does not read runtime ports when building static assets', async () => {
  expect(await proxy('4317junk', false, 'build')).toBeUndefined();
});
