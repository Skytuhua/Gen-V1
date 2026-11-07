import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Resolve through the installed caller chain: a root minimatch can hide a stale
// copy used by universal during desktop packaging.
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const appBuilderRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const universalRequire = createRequire(appBuilderRequire.resolve("@electron/universal"));
const { minimatch } = universalRequire("minimatch");

describe("desktop builder minimatch compatibility", () => {
  it("keeps the patched override scoped to the universal parent", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.pnpm.overrides["@electron/universal@2.0.3>minimatch"]).toBe("11.0.1");
  });

  it("locks universal to the patched dependency edge", () => {
    const lock = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
    const snapshots = lock.slice(lock.indexOf("\nsnapshots:\n"));
    const universal = snapshots.split("\n  '@electron/universal@2.0.3':\n")[1]?.split(/\n  \S/)[0];
    expect(universal).toBeDefined();
    expect(universal).toMatch(/^      minimatch: 11\.0\.1$/m);
    expect(universal).not.toMatch(/^      minimatch: 9\.0\.9$/m);
  });

  it("loads the patched named CommonJS API from the actual builder caller", () => {
    expect(universalRequire("minimatch/package.json").version).toBe("11.0.1");
    expect(typeof minimatch).toBe("function");
  });

  it.each([
    ["Contents/MacOS/helper", "helper", true],
    ["Contents/MacOS/helper", "other", false],
    ["Contents/Frameworks/helper.dylib", "*.dylib", true],
    ["Contents/Resources/en.lproj/InfoPlist.strings", "InfoPlist.strings", true],
    ["Contents/Resources/a.txt", "*.plist", false],
    ["Contents/MacOS/helper", "Contents/MacOS/helper", true],
    ["Contents/MacOS/helper", "Contents/Resources/helper", false],
    ["Contents/Resources/icon.png", "*.{png,ico}", true],
    ["Contents/Resources/icon.txt", "*.{png,ico}", false],
  ])("preserves matchBase for %s against %s", (path, pattern, expected) => {
    expect(minimatch(path, pattern, { matchBase: true })).toBe(expected);
  });
});
