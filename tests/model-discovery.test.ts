import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import * as fileSystem from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelInfo } from "../packages/contracts/index.ts";
import type { Service } from "../packages/core/service.ts";
import { createPiRuntime } from "../packages/runtime-pi/index.ts";
import * as processTree from "../packages/runtime-pi/process-tree.ts";
import { buildServer } from "../apps/server/server.ts";
import { getModels } from "../apps/web/src/api.ts";
import {Store} from '../packages/storage/store';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

vi.mock("node:child_process", async original => ({ ...await original<typeof import("node:child_process")>() }));
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>() }));

const catalog: ModelInfo[] = [{ id: "openai/test-model", provider: "openai", name: "Subscription model", thinkingLevels: ["low", "high"] }];
const updated: ModelInfo[] = [{ id: "openai/new-model", provider: "openai", name: "New subscription model" }];
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});

function mockDiscovery(automatic = false) {
  const children: Array<EventEmitter & { connected: boolean; exitCode: number | null; signalCode: null }> = [];
  const requests: Array<{ resolve(value: ModelInfo[]): void; reject(): void }> = [];
  vi.spyOn(fileSystem, "mkdir").mockResolvedValue(undefined);
  const spawn = vi.spyOn(childProcess, "spawn").mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      connected: true, exitCode: null as number | null, signalCode: null,
      send(message: any, callback: (error: Error | null) => void) {
        if (message.command === "models") {
          requests.push({
            resolve: value => child.emit("message", { type: "response", requestId: message.requestId, value }),
            reject: () => child.emit("message", { type: "response", requestId: message.requestId, code: "PI_AUTH_REQUIRED", error: "Sign in again" }),
          });
          if (automatic) queueMicrotask(() => child.emit("message", { type: "response", requestId: message.requestId, value: structuredClone(catalog) }));
        }
        else queueMicrotask(() => child.emit("message", { type: "response", requestId: message.requestId, value: null }));
        callback(null);
        return true;
      },
    });
    children.push(child);
    return child as never;
  });
  const terminate = vi.spyOn(processTree, "terminateProcessTree").mockImplementation(async child => {
    Object.assign(child, { connected: false, exitCode: 0 });
    child.emit("exit", 0, null);
  });
  const runtime = createPiRuntime({ dataDir: "mock-model-discovery" });
  cleanups.push(() => runtime.dispose());
  async function request(index: number) {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(index));
    return requests[index];
  }
  async function discover() {
    const index = requests.length;
    const result = runtime.models();
    (await request(index)).resolve(structuredClone(catalog));
    return result;
  }
  return { runtime, requests, children, spawn, terminate, request, discover };
}

describe("Pi model discovery cache", () => {
  it("reuses successful discovery without leaving a discovery worker alive", async () => {
    const fixture = mockDiscovery(true);
    expect(await fixture.discover()).toEqual(catalog);
    expect(await fixture.runtime.models()).toEqual(catalog);
    expect(await fixture.runtime.models()).toEqual(catalog);
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
    expect(fixture.terminate).toHaveBeenCalledTimes(1);
    expect(fixture.children.every(child => !child.connected && child.exitCode === 0)).toBe(true);
  });

  it("returns copies of cached models and their thinking levels", async () => {
    const fixture = mockDiscovery(true);
    const first = await fixture.discover();
    first[0].name = "Changed by caller";
    first[0].thinkingLevels!.push("invalid");
    first.push({ id: "forged/model", provider: "forged", name: "Forged" });
    expect(await fixture.runtime.models()).toEqual(catalog);
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight discovery and returns independent copies to callers", async () => {
    const fixture = mockDiscovery();
    const pending = [fixture.runtime.models(), fixture.runtime.models(), fixture.runtime.models()];
    await fixture.request(0);
    fixture.requests.forEach(request => request.resolve(structuredClone(catalog)));
    const results = await Promise.all(pending);
    results[0][0].thinkingLevels!.push("invalid");
    expect(results[1]).toEqual(catalog);
    expect(results[2]).toEqual(catalog);
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
    expect(fixture.terminate).toHaveBeenCalledTimes(1);
  });

  it("shares one fresh request for explicit refresh and callers arriving during refresh", async () => {
    const fixture = mockDiscovery();
    await fixture.discover();
    const pending = [fixture.runtime.models({ refresh: true }), fixture.runtime.models({ refresh: true }), fixture.runtime.models()];
    await fixture.request(1);
    fixture.requests.slice(1).forEach(request => request.resolve(updated));
    expect(await Promise.all(pending)).toEqual([updated, updated, updated]);
    expect(fixture.spawn).toHaveBeenCalledTimes(2);
    expect(await fixture.runtime.models()).toEqual(updated);
    expect(fixture.spawn).toHaveBeenCalledTimes(2);
    expect(fixture.terminate).toHaveBeenCalledTimes(2);
    expect(fixture.children.every(child => !child.connected && child.exitCode === 0)).toBe(true);
  });

  it.each(["error", "exit"] as const)("retries a failed %s without caching it and cleans its worker", async failure => {
    const fixture = mockDiscovery();
    const pending = [fixture.runtime.models(), fixture.runtime.models()];
    const outcomes = pending.map(result => expect(result).rejects.toMatchObject({ code: failure === "error" ? "PI_AUTH_REQUIRED" : "PI_WORKER_EXITED" }));
    await fixture.request(0);
    if (failure === "error") fixture.requests.forEach(request => request.reject());
    else {
      for (const child of fixture.children) {
        Object.assign(child, { connected: false, exitCode: 1 });
        child.emit("exit", 1, null);
      }
    }
    await Promise.all(outcomes);
    expect(await fixture.discover()).toEqual(catalog);
    expect(fixture.spawn).toHaveBeenCalledTimes(2);
    expect(fixture.children.every(child => !child.connected)).toBe(true);
  });

  it("retries after failed refresh instead of serving the previous successful catalog", async () => {
    const fixture = mockDiscovery();
    await fixture.discover();
    const refreshing = fixture.runtime.models({ refresh: true });
    const rejection = expect(refreshing).rejects.toMatchObject({ code: "PI_AUTH_REQUIRED" });
    (await fixture.request(1)).reject();
    await rejection;
    const retry = fixture.runtime.models();
    (await fixture.request(2)).resolve(updated);
    expect(await retry).toEqual(updated);
    expect(fixture.spawn).toHaveBeenCalledTimes(3);
    expect(fixture.terminate).toHaveBeenCalledTimes(3);
  });

  it("disposes a pending shared discovery and rejects future requests", async () => {
    const fixture = mockDiscovery();
    const pending = [fixture.runtime.models(), fixture.runtime.models()];
    const outcomes = pending.map(result => expect(result).rejects.toMatchObject({ code: "PI_WORKER_EXITED" }));
    await fixture.request(0);
    await fixture.runtime.dispose();
    await Promise.all(outcomes);
    await expect(fixture.runtime.models()).rejects.toMatchObject({ code: "PI_DISPOSED" });
    await expect(fixture.runtime.models({ refresh: true })).rejects.toMatchObject({ code: "PI_DISPOSED" });
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
    expect(fixture.terminate).toHaveBeenCalledTimes(1);
    expect(fixture.children.every(child => !child.connected)).toBe(true);
  });

  it("rejects cached discovery after disposal", async () => {
    const fixture = mockDiscovery();
    await fixture.discover();
    await fixture.runtime.dispose();
    await expect(fixture.runtime.models()).rejects.toMatchObject({ code: "PI_DISPOSED" });
    expect(fixture.spawn).toHaveBeenCalledTimes(1);
  });
});

async function modelServer() {
  const models = vi.fn(async (_options?: { refresh?: boolean; threadId?: string }) => catalog);
  const path=mkdtempSync(join(tmpdir(),'model-server-')),store=new Store(path);
  cleanups.push(async()=>{store.close();rmSync(path,{recursive:true,force:true});});
  const app = await buildServer({ models,store } as unknown as Service, { port: 4317, dev: true });
  cleanups.push(() => app.close());
  const boot = await app.inject({ url: "/api/bootstrap", headers: { host: "127.0.0.1:4317" } });
  const headers = { host: "127.0.0.1:4317", cookie: String(boot.headers["set-cookie"]).split(";")[0] };
  return { app, models, headers };
}

describe("model refresh API", () => {
  it.each(["1", "true"])("accepts refresh=%s and forwards explicit refresh", async value => {
    const { app, models, headers } = await modelServer();
    const response = await app.inject({ url: `/api/models?refresh=${value}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ models: catalog });
    expect(models).toHaveBeenCalledExactlyOnceWith({ refresh: true, threadId: undefined });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("uses cached discovery by default and preserves useful discovery errors", async () => {
    const { app, models, headers } = await modelServer();
    models.mockRejectedValueOnce(new Error("Sign in again"));
    const response = await app.inject({ url: "/api/models", headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ models: [], error: "Sign in again" });
    expect(models).toHaveBeenCalledExactlyOnceWith({ refresh: false, threadId: undefined });
  });

  it('forwards the owning thread with an explicit catalog refresh', async () => {
    const { app, models, headers } = await modelServer();
    const response = await app.inject({url: '/api/models?refresh=1&threadId=saved-thread', headers});
    expect(response.json()).toEqual({models: catalog});
    expect(models).toHaveBeenCalledExactlyOnceWith({refresh: true, threadId: 'saved-thread'});
  });

  it.each(["", "false", "0", "yes", "1&refresh=true"])("rejects invalid refresh=%s before discovery", async value => {
    const { app, models, headers } = await modelServer();
    const response = await app.inject({ url: `/api/models?refresh=${value}`, headers });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(models).not.toHaveBeenCalled();
  });

  it("lets browser startup reuse discovery and the refresh action request a fresh catalog", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      expect(options.credentials).toBe("same-origin");
      if (url === "/api/bootstrap") return Response.json({ csrfToken: "test-session" });
      urls.push(url);
      expect(options.cache).toBe("no-store");
      return Response.json({ models: url === "/api/models?refresh=1" ? updated : catalog });
    });
    expect(await getModels()).toEqual({ models: catalog });
    expect(await getModels(true)).toEqual({ models: updated });
    expect(urls).toEqual(["/api/models", "/api/models?refresh=1"]);
  });
});
