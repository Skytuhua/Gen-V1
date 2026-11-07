import { createRequire } from "node:module";
import { expect, it } from "vitest";

// Resolve from the actual Electron builder, so a patched root copy cannot hide
// a vulnerable version used by the packaged application.
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve("electron-builder"));
const appBuilder = createRequire(builder.resolve("app-builder-lib"));
const universal = createRequire(appBuilder.resolve("@electron/universal"));

it("uses patched minimatch with Electron's expected matchBase behavior", () => {
  expect(universal("minimatch/package.json").version).toBe("11.0.1");
  const { minimatch } = universal("minimatch");
  expect(minimatch("Contents/Resources/icon.png", "*.{png,ico}", { matchBase: true })).toBe(true);
  expect(minimatch("Contents/Resources/icon.txt", "*.{png,ico}", { matchBase: true })).toBe(false);
});
