import { defineConfig } from "vite";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import isolated from "./vite.config";

const root = resolve(import.meta.dirname, "../..");
export default defineConfig({
	...isolated,
	cacheDir: "/tmp/gen-wo5-project-search-vite",
	server: {
		...isolated.server,
		proxy: undefined,
		port: 5521,
		strictPort: true,
		fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] },
	},
});
