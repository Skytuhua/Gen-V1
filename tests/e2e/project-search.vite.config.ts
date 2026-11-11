import { defineConfig } from "vite";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import isolated from "./vite.config";

const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
	...isolated,
	cacheDir:resolve(process.env.GEN_BROWSER_OUTPUT_DIR??'/tmp/gen-wo5-project-search-results','node_modules/.vite'),
	server: {
		...isolated.server,
		proxy: undefined,
		port: 5521,
		strictPort: true,watch:{ignored:['**/.harness*/**']},
		fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] },
	},
});
