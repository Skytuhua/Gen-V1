import { describe, expect, it } from "vitest";
import { createTaskbarRefresher, failureOverlayBitmap, sameNativeState, taskbarNativeState, type NativeTaskbarState } from "../apps/desktop/taskbar-policy.ts";
import type { TaskbarStatus } from "../packages/desktop-contract/index.ts";

const status = (partial: Partial<TaskbarStatus>): TaskbarStatus => ({ enabled: true, mode: "none", progress: null, failed: false, ...partial });
const result = (taskbar: TaskbarStatus) => ({ taskbar, jumpList: { enabled: true, projects: [] } });

describe("taskbarNativeState", () => {
 it("clears when disabled, missing, or mode none", () => {
  for (const value of [undefined, status({ enabled: false, mode: "error", progress: 1 }), status({})])
   expect(taskbarNativeState(value)).toEqual({ progress: -1, mode: "none", overlay: false });
 });
 it("maps indeterminate, determinate, paused and error", () => {
  expect(taskbarNativeState(status({ mode: "indeterminate" }))).toEqual({ progress: 2, mode: "indeterminate", overlay: false });
  expect(taskbarNativeState(status({ mode: "normal", progress: 0.5 }))).toEqual({ progress: 0.5, mode: "normal", overlay: false });
  expect(taskbarNativeState(status({ mode: "paused", progress: 0.3 }))).toEqual({ progress: 0.3, mode: "paused", overlay: false });
  expect(taskbarNativeState(status({ mode: "paused" }))).toEqual({ progress: 1, mode: "paused", overlay: false });
  expect(taskbarNativeState(status({ mode: "error" }))).toEqual({ progress: 1, mode: "error", overlay: true });
  expect(taskbarNativeState(status({ mode: "error", progress: 0.4 }))).toEqual({ progress: 0.4, mode: "error", overlay: true });
 });
 it("clamps out-of-range determinate values", () => {
  expect(taskbarNativeState(status({ mode: "normal", progress: 1.4 })).progress).toBe(0.98);
  expect(taskbarNativeState(status({ mode: "normal", progress: -0.4 })).progress).toBe(0.02);
 });
 it("diff treats 0.505 and 0.509 as equal", () => {
  expect(sameNativeState({ progress: 0.505, mode: "normal", overlay: false }, { progress: 0.509, mode: "normal", overlay: false })).toBe(true);
  expect(sameNativeState({ progress: 0.505, mode: "normal", overlay: false }, { progress: 0.516, mode: "normal", overlay: false })).toBe(false);
 });
});

describe("failureOverlayBitmap", () => {
 const pixel = (bitmap: Uint8Array, scale: number, x: number, y: number) => { const size = Math.round(16 * scale), o = (y * size + x) * 4; return [bitmap[o], bitmap[o + 1], bitmap[o + 2], bitmap[o + 3]]; };
 it("draws the red circle, dark ring and white exclamation", () => {
  const bitmap = failureOverlayBitmap(1);
  expect(pixel(bitmap, 1, 8, 8)).toEqual([0xE5, 0x48, 0x4D, 255]);
  expect(pixel(bitmap, 1, 15, 8)).toEqual([0x0F, 0x0F, 0x0F, 255]);
  expect(pixel(bitmap, 1, 11, 9)).toEqual([255, 255, 255, 255]);
  expect(pixel(bitmap, 1, 11, 13)).toEqual([255, 255, 255, 255]);
  expect(pixel(bitmap, 1, 11, 12)).toEqual([0xE5, 0x48, 0x4D, 255]);
  expect(pixel(bitmap, 1, 0, 0)).toEqual([0, 0, 0, 0]);
 });
 it("scales to 32x32 at scale 2", () => {
  const bitmap = failureOverlayBitmap(2);
  expect(bitmap.length).toBe(32 * 32 * 4);
  expect(pixel(bitmap, 2, 18, 17)).toEqual([0xE5, 0x48, 0x4D, 255]);
 });
});

describe("createTaskbarRefresher", () => {
 const harness = () => {
  const applied: NativeTaskbarState[] = []; const timers: { callback: () => void; ms: number }[] = [];
  const responses: Promise<ReturnType<typeof result>>[] = [];
  const refresher = createTaskbarRefresher({ read: () => responses.shift() ?? Promise.resolve(result(status({}))), apply: value => applied.push(value), setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => { timers.splice(timers.findIndex(timer => timer.callback === callback), 1); }; } });
  return { refresher, applied, timers, responses };
 };
 it("applies only changed states and polls while non-none", async () => {
  const { refresher, applied, timers } = harness();
  refresher.refresh(); await Promise.resolve(); await Promise.resolve();
  expect(applied).toEqual([]);
  expect(timers).toHaveLength(0);
 });
 it("applies a new state, arms the 15s poll, and clears on two failures", async () => {
  const applied: NativeTaskbarState[] = []; const timers: { callback: () => void; ms: number }[] = [];
  let response = result(status({ mode: "normal", progress: 0.5 }));
  const refresher = createTaskbarRefresher({ read: () => Promise.resolve(response), apply: value => applied.push(value), setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => {}; } });
  refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(applied).toEqual([{ progress: 0.5, mode: "normal", overlay: false }]);
  expect(timers.at(-1)?.ms).toBe(15000);
  response = result(status({ mode: "none" }));
  timers.at(-1)!.callback(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(applied.at(-1)).toEqual({ progress: -1, mode: "none", overlay: false });
 });
 it("never regresses determinate progress while normal", async () => {
  const applied: NativeTaskbarState[] = [];
  let response = result(status({ mode: "normal", progress: 0.6 }));
  const refresher = createTaskbarRefresher({ read: () => Promise.resolve(response), apply: value => applied.push(value), setTimer: () => () => {} });
  refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  response = result(status({ mode: "normal", progress: 0.4 }));
  refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(applied).toEqual([{ progress: 0.6, mode: "normal", overlay: false }]);
 });
 it("clears to none after two consecutive read failures", async () => {
  const applied: NativeTaskbarState[] = [];
  let fail = false, response = result(status({ mode: "normal", progress: 0.5 }));
  const refresher = createTaskbarRefresher({ read: () => fail ? Promise.reject(Error("backend")) : Promise.resolve(response), apply: value => applied.push(value), setTimer: () => () => {} });
  refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  fail = true; refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  refresher.refresh(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(applied.at(-1)).toEqual({ progress: -1, mode: "none", overlay: false });
 });
 it("coalesces into one in-flight read plus a trailing read at 250ms", async () => {
  const timers: { callback: () => void; ms: number }[] = []; const reads: number[] = [];
  let resolveRead: ((value: ReturnType<typeof result>) => void) | undefined;
  const refresher = createTaskbarRefresher({ read: () => { reads.push(1); return new Promise<ReturnType<typeof result>>(resolve => { resolveRead = resolve; }); }, apply: () => {}, setTimer: (callback, ms) => { timers.push({ callback, ms }); return () => {}; } });
  refresher.refresh(); refresher.refresh(); refresher.refresh();
  expect(reads).toHaveLength(1);
  resolveRead!(result(status({ mode: "normal", progress: 0.5 }))); await new Promise(resolve => setTimeout(resolve, 0));
  expect(timers.some(timer => timer.ms === 250)).toBe(true);
  timers.find(timer => timer.ms === 250)!.callback(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(reads).toHaveLength(2);
 });
});
