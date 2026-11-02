import { build } from "esbuild";

await build({
  entryPoints: ["packages/widgets/worker.ts", "packages/widgets/receiver.ts"],
  outdir: "dist/widget-runtime",
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
});
