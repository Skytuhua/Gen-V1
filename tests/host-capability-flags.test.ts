import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { launchHost, readHostOptions, type HostFactories } from '../apps/server/host.ts';
import { capabilityEnabled, configureHostCapabilityFlags, readCapabilityFlagOverrides, registeredCapabilityFlags } from '../packages/core/capability-flags.ts';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.unstubAllEnvs(); });
const options = { dataDir: resolve('.harness-capability-unit-unused'), port: 4317, widgetPort: 4318, dev: false };
function fixture() {
  const profile = { dataDir: options.dataDir, close: vi.fn() }, store = { dataDir: options.dataDir, close: vi.fn() };
  const runtime = { dispose: vi.fn(async () => {}) }, service = { recover: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
  const app = { addHook: vi.fn(), listen: vi.fn(async () => {}), close: vi.fn(async () => {}), server: { address: () => ({ port: 4317 }) } };
  const widgets = { ...app, server: { address: () => ({ port: 4318 }) } };
  const factories = { acquireProfile: vi.fn(() => profile), createStore: vi.fn(() => store), createRuntime: vi.fn(() => runtime), createService: vi.fn(() => service),
    buildServer: vi.fn(async () => app), buildWidgetServer: vi.fn(async () => widgets), loadPlugins: vi.fn(async () => { throw Error('No plugins in this composition fixture'); }) } as unknown as HostFactories;
  return { runtime, service, factories };
}

it('reads only finite capability environment keys with the existing exact enablement values', () => {
  const configured = readHostOptions({ HARNESS_FLAG_MEMORY_PROJECT_V1: '1', HARNESS_FLAG_CONTEXT_COMPILER_V1: 'true', HARNESS_FLAG_TOOLS_DEFERRED_V1: 'TRUE', HARNESS_FLAG_MEMORY_EXTERNAL_RECALL_EXPERIMENT_V1: '0', HARNESS_FLAG_UNKNOWN: 'true' });
  expect(configured.capabilityFlags).toEqual({ 'memory.projectV1': true, 'context.compilerV1': true, 'tools.deferredV1': false, 'memory.externalRecallExperimentV1': false });
  expect(Object.isFrozen(configured.capabilityFlags)).toBe(true);
  expect(Object.values(registeredCapabilityFlags()).every(value => value === false)).toBe(true);
});

it('requires explicit environment input and never turns ambient environment into shared module state', () => {
  vi.stubEnv('HARNESS_FLAG_MEMORY_PROJECT_V1', 'true');
  expect(readCapabilityFlagOverrides({})).toEqual({});
  expect(readHostOptions({}).capabilityFlags).toBeUndefined();
  expect(capabilityEnabled('memory.projectV1')).toBe(false);
});

it('applies trusted host capabilities before runtime and Service construction and leaves omitted flags disabled', async () => {
  const f = fixture(), seen: Record<string, boolean>[] = [];
  vi.mocked(f.factories.createRuntime).mockImplementationOnce(() => { seen.push(registeredCapabilityFlags()); return f.runtime as never; });
  vi.mocked(f.factories.createService).mockImplementationOnce(() => { seen.push(registeredCapabilityFlags()); return f.service as never; });
  const host = await launchHost({ ...options, capabilityFlags: { 'memory.projectV1': true, 'context.compilerV1': true } }, f.factories); cleanup.push(() => host.close());
  expect(seen).toHaveLength(2);
  for (const flags of seen) {
    expect(flags['memory.projectV1']).toBe(true); expect(flags['context.compilerV1']).toBe(true);
    expect(Object.entries(flags).filter(([key, value]) => value && !['memory.projectV1', 'context.compilerV1'].includes(key))).toEqual([]);
  }
  await host.close(); expect(Object.values(registeredCapabilityFlags()).every(value => value === false)).toBe(true);
});

it('rejects unknown host capability overrides atomically before creating runtime or Store', async () => {
  cleanup.push(configureHostCapabilityFlags({ 'memory.projectV1': true }));
  const f = fixture();
  await expect(launchHost({ ...options, capabilityFlags: { 'memory.projectV1': false, 'unknown.capability': true } as never }, f.factories)).rejects.toMatchObject({ code: 'UNKNOWN_CAPABILITY_FLAG' });
  expect(capabilityEnabled('memory.projectV1')).toBe(true);
  expect(f.factories.createStore).not.toHaveBeenCalled(); expect(f.factories.createRuntime).not.toHaveBeenCalled();
});

it('rejects nonboolean host overrides before changing the current configuration', () => {
  const before = registeredCapabilityFlags();
  expect(() => configureHostCapabilityFlags({ 'memory.projectV1': 'true' } as never)).toThrowError('Capability flag must be boolean');
  expect(registeredCapabilityFlags()).toEqual(before);
});

it('prevents a competing host from changing live flags and retains an identical shared configuration until both owners close', () => {
  const first = configureHostCapabilityFlags({ 'memory.projectV1': true }); cleanup.push(first);
  expect(() => configureHostCapabilityFlags({})).toThrowError('Another host owns a different capability configuration');
  const second = configureHostCapabilityFlags({ 'memory.projectV1': true }); cleanup.push(second);
  first(); first(); expect(capabilityEnabled('memory.projectV1')).toBe(true);
  second(); expect(Object.values(registeredCapabilityFlags()).every(value => value === false)).toBe(true);
});

it('registers ui.testResultsV1 beside ui.sourceWorkbenchV1 with the default off', () => {
  expect(capabilityEnabled('ui.testResultsV1')).toBe(false);
  expect(capabilityEnabled('ui.sourceWorkbenchV1')).toBe(false);
});
