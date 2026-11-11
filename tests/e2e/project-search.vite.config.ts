import { defineConfig } from "vite";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import isolated from "./vite.config";

const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
	...isolated,
	cacheDir: "/tmp/wo5-run-d/node_modules/.vite/project-search",
	server: {
		...isolated.server,
		proxy: undefined,
		port: 5521,
		strictPort: true,watch:{ignored:['**/.harness*/**']},
		fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] },
	},
});
