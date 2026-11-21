import { describe, expect, it } from "vitest";
import { createLaunchRequestQueue, parseLaunchRequest } from "../apps/desktop/launch-requests.ts";
import { parseLaunchRequestDelivery } from "../packages/desktop-contract/index.ts";

describe("parseLaunchRequest", () => {
 it("parses new-thread", () => {
  expect(parseLaunchRequest(["Gen V1.exe", "--gen-jump=new-thread"]).request).toEqual({ type: "new-thread" });
 });
 it("parses open-project with a valid id", () => {
  expect(parseLaunchRequest(["--gen-jump=open-project", "--gen-project-id=proj:abc-123"]).request).toEqual({ type: "open-project-id", projectId: "proj:abc-123" });
 });
 it("ignores unrelated arguments and electron switches", () => {
  expect(parseLaunchRequest(["app", "--inspect-brk", "--open-project=/x", "--no-sandbox", "file.txt"]).request).toBeUndefined();
 });
 it("rejects repeats, unknown values and malformed pairs", () => {
  expect(parseLaunchRequest(["--gen-jump=new-thread", "--gen-jump=new-thread"])).toEqual({});
  expect(parseLaunchRequest(["--gen-jump=whatever"])).toEqual({});
  expect(parseLaunchRequest(["--gen-jump=new-thread", "--gen-project-id=a"]).request).toBeUndefined();
  expect(parseLaunchRequest(["--gen-jump=open-project"])).toMatchObject({ error: expect.any(String) });
  expect(parseLaunchRequest(["--gen-jump=open-project", "--gen-project-id=a", "--gen-project-id=b"])).toMatchObject({ error: expect.any(String) });
 });
 it("rejects path-like and dangerous project ids without leaking them", () => {
  for (const id of ["C:/temp", "..\\..\\x", "__proto__", "constructor", "a b", "a?b"]) {
   const { request, error } = parseLaunchRequest(["--gen-jump=open-project", `--gen-project-id=${id}`]);
   expect(request).toBeUndefined();
   expect(error).toBe("The requested project could not be identified.");
  }
 });
 it("bounds argv scanning", () => {
  const argv = Array.from({ length: 100 }, (_, index) => `--arg-${index}`);
  argv[99] = "--gen-jump=new-thread";
  expect(parseLaunchRequest(argv).request).toBeUndefined();
  expect(parseLaunchRequest([`--gen-project-id=${"a".repeat(9000)}`, "--gen-jump=open-project"]).request).toBeUndefined();
 });
});

describe("createLaunchRequestQueue", () => {
 const harness = () => {
  const delivered: unknown[] = []; let ids = 0, now = 0;
  const queue = createLaunchRequestQueue({ deliver: value => delivered.push(value), id: () => `request-${++ids}`, now: () => now });
  return { queue, delivered, tick: (ms: number) => { now += ms; } };
 };
 it("holds until ready, then delivers with a request id", () => {
  const { queue, delivered } = harness();
  queue.offer({ type: "new-thread" });
  expect(delivered).toHaveLength(0);
  queue.markReady();
  expect(delivered).toEqual([{ type: "new-thread", requestId: "request-1" }]);
 });
 it("delivers immediately when already ready", () => {
  const { queue, delivered } = harness();
  queue.markReady();
  queue.offer({ type: "open-project-id", projectId: "p1" });
  expect(delivered).toEqual([{ type: "open-project-id", projectId: "p1", requestId: "request-1" }]);
 });
 it("latest wins: a newer offer replaces the pending request", () => {
  const { queue, delivered } = harness();
  queue.offer({ type: "new-thread" });
  queue.offer({ type: "open-project-id", projectId: "p2" });
  queue.markReady();
  expect(delivered).toEqual([{ type: "open-project-id", projectId: "p2", requestId: "request-2" }]);
 });
 it("acknowledge clears only the matching pending request", () => {
  const { queue, delivered } = harness();
  queue.offer({ type: "new-thread" });
  queue.acknowledge("stale-id");
  queue.markReady();
  expect(delivered).toEqual([{ type: "new-thread", requestId: "request-1" }]);
  queue.acknowledge("request-1");
  queue.markNotReady(); queue.markReady();
  expect(delivered).toHaveLength(1);
 });
 it("redelivers after a renderer reload until acked", () => {
  const { queue, delivered } = harness();
  queue.markReady(); queue.offer({ type: "new-thread" });
  queue.markNotReady(); queue.markReady();
  expect(delivered).toHaveLength(2);
 });
 it("drops requests older than 60s when the renderer becomes ready", () => {
  const { queue, delivered, tick } = harness();
  queue.offer({ type: "new-thread" });
  tick(61000);
  queue.markReady();
  expect(delivered).toHaveLength(0);
  expect(queue.pendingId()).toBeUndefined();
 });
});

describe("parseLaunchRequestDelivery", () => {
 it("accepts well-formed deliveries and rejects everything else", () => {
  expect(parseLaunchRequestDelivery({ type: "new-thread", requestId: "r1" })).toEqual({ type: "new-thread", requestId: "r1" });
  expect(parseLaunchRequestDelivery({ type: "open-project-id", projectId: "p1", requestId: "r2" })).toEqual({ type: "open-project-id", projectId: "p1", requestId: "r2" });
  expect(parseLaunchRequestDelivery({ type: "new-thread", requestId: "r1", extra: true })).toBeNull();
  expect(parseLaunchRequestDelivery({ type: "open-project-id", projectId: "../x", requestId: "r2" })).toBeNull();
  expect(parseLaunchRequestDelivery("new-thread")).toBeNull();
  expect(parseLaunchRequestDelivery({ type: "unknown", requestId: "r1" })).toBeNull();
 });
});
