import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// Windows runners can expose TEMP through an 8.3 alias; fixtures use canonical paths.
if (process.platform === "win32") process.env.TEMP = process.env.TMP = realpathSync.native(tmpdir());

// Host-spawning suites contend for CPU/git/python workers; at default
// maxWorkers (~logical CPUs) a rotating subset times out under load on
// modest runners. Half the cores keeps full-suite runs deterministic.
export default defineConfig({ test: { include: ["tests/**/*.test.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"], exclude: ["tests/plugin-api-package.test.mjs"], testTimeout: 240000, hookTimeout: 120000, maxWorkers: "50%" } });
