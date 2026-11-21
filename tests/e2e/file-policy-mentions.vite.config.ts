import { defineConfig } from "vite";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import isolated from "./vite.config";

const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
	...isolated,
	cacheDir: resolve(root, ".harness-file-policy/node_modules/.vite"),
	server: {
		...isolated.server,
		port: 5818,
		strictPort: true,
		fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] },
	},
});
