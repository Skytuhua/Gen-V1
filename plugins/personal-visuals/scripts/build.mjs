import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
	lstat,
	mkdir,
	readFile,
	readdir,
	rename,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	args = process.argv.slice(2);
function argument(name) {
	const at = args.indexOf(name);
	if (at < 0) return undefined;
	if (!args[at + 1] || args[at + 1].startsWith("--"))
		throw Error(name + " requires a value.");
	return args[at + 1];
}
const harnessRoot = argument("--harness-root"),
	require = createRequire(
		join(harnessRoot ? resolve(harnessRoot) : pluginRoot, "package.json"),
	),
	{ build } = require("esbuild");
const sdk = harnessRoot
		? resolve(harnessRoot, "dist/plugin-api/index.mjs")
		: require.resolve("@gen-v1/plugin-api"),
	utility = harnessRoot
		? resolve(harnessRoot, "dist/plugin-api/host-utilities.mjs")
		: require.resolve("@gen-v1/plugin-api/host-utilities");
const { pluginManifestSchema } = await import(pathToFileURL(sdk).href),
	manifest = pluginManifestSchema.parse(
		JSON.parse(await readFile(join(pluginRoot, "plugin.json"), "utf8")),
	);
const dist = join(pluginRoot, "dist"),
	output = resolve(pluginRoot, argument("--output-root") ?? "dist/package"),
	part = relative(dist, output);
if (
	!part ||
	isAbsolute(part) ||
	part === ".." ||
	part.startsWith("../") ||
	part.startsWith("..\\")
)
	throw Error("Use a new child of this plug-in dist directory.");
try {
	await lstat(output);
	throw Error(
		"Package output already exists. Preserve it and choose --output-root dist/package-<new-attempt>.",
	);
} catch (cause) {
	if (cause.code !== "ENOENT") throw cause;
}
await mkdir(dist, { recursive: true });
const stage = join(dist, "package-stage-" + Date.now());
await mkdir(stage);
const host = await build({
	absWorkingDir: pluginRoot,
	entryPoints: ["src/host.ts"],
	outfile: join(stage, "host/main.mjs"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node24",
	sourcemap: false,
	metafile: true,
	nodePaths: [
		join(pluginRoot, "node_modules"),
		...(harnessRoot ? [join(resolve(harnessRoot), "node_modules")] : []),
	],
	plugins: [
		{
			name: "pinned-sdk-host-utility",
			setup(builder) {
				builder.onResolve(
					{ filter: /^@gen-v1\/plugin-api\/host-utilities$/ },
					() => ({ path: utility }),
				);
			},
		},
	],
});
const frontend = await build({
	absWorkingDir: pluginRoot,
	entryPoints: ["src/frontend.tsx"],
	outfile: join(stage, "frontend/main.js"),
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	minify: true,
	sourcemap: false,
	metafile: true,
	nodePaths: [join(pluginRoot, "node_modules")],
	plugins: [
		{
			name: "shared-gen-presentation",
			setup(builder) {
				builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (args) => ({
					path: join(
						pluginRoot,
						args.path === "react" ? "src/react.ts" : "src/jsx-runtime.ts",
					),
				}));
			},
		},
	],
});
const inputs = Object.keys(frontend.metafile.inputs);
if (
	inputs.some((path) =>
		/(?:^|[\\/])(?:apps[\\/]web|node_modules[\\/]react[\\/])/.test(path),
	)
)
	throw Error(
		"The visual plug-in must use the shared Gen presentation runtime, not copy the shell.",
	);
await writeFile(
	join(stage, "frontend/index.html"),
	'<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="gen-plugin-id" content="personal-visuals"><title>Personal Visuals</title><link rel="stylesheet" href="./main.css"></head><body><div id="root"></div><script src="./main.js" defer></script></body></html>\n',
	{ flag: "wx" },
);
await writeFile(
	join(stage, "plugin.json"),
	JSON.stringify(manifest, null, 2) + "\n",
	{ flag: "wx" },
);
const files = [];
async function inventory(directory, prefix = "") {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) throw Error("Package links are not supported.");
		const name = prefix + entry.name,
			path = join(directory, entry.name);
		if (entry.isDirectory()) await inventory(path, name + "/");
		else {
			const bytes = await readFile(path);
			if (bytes.length > 16 * 1024 * 1024)
				throw Error("A package file exceeds the public API limit.");
			files.push({
				path: name,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		}
	}
}
await inventory(stage);
files.sort((a, b) => a.path.localeCompare(b.path));
const inventoryBytes = Buffer.from(
		JSON.stringify({ version: 1, files }, null, 2) + "\n",
	),
	digest = createHash("sha256").update(inventoryBytes).digest("hex");
await writeFile(join(stage, "plugin-files.json"), inventoryBytes, {
	flag: "wx",
});
await rename(stage, output);
const receipt = {
	createdAtUTC: new Date().toISOString(),
	output,
	manifest,
	inventorySHA256: digest,
	files,
	sourceInputs: {
		host: Object.keys(host.metafile.inputs).sort(),
		frontend: inputs.sort(),
	},
	scope:
		"Standalone package build only; no installation, native, model or network acceptance.",
};
await writeFile(
	join(dist, "package-build-" + Date.now() + ".json"),
	JSON.stringify(receipt, null, 2) + "\n",
	{ flag: "wx" },
);
console.log(
	JSON.stringify(
		{
			output,
			inventorySHA256: digest,
			files: files.length,
			bytes: files.reduce((sum, file) => sum + file.bytes, 0),
		},
		null,
		2,
	),
);
