import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// Windows runners can expose TEMP through an 8.3 alias; fixtures use canonical paths.
if (process.platform === "win32") process.env.TEMP = process.env.TMP = realpathSync(tmpdir());

export default defineConfig({ test: { include: ["tests/**/*.test.ts"], testTimeout: 15000 } });
