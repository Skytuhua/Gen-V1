interface Runtime {
	React: typeof import("react");
	ReactDOMClient: typeof import("react-dom/client");
	JSXRuntime: typeof import("react/jsx-runtime");
	pluginRequest<T = unknown>(
		operation: string,
		input: unknown,
		signal?: AbortSignal,
	): Promise<T>;
	registerPlugin(manifest: unknown, registration: unknown): unknown;
	registerEditorHandoff(id: string, guard: () => Promise<void>): () => void;
	pluginReady(): void;
	pluginPresentation(): { introDismissed: boolean };
	onPluginPresentation(
		listener: (presentation: { introDismissed: boolean }) => void,
	): () => void;
}
export const runtime = (
	globalThis as typeof globalThis & { GenPluginUI?: Runtime }
).GenPluginUI;
if (
	!runtime?.React ||
	!runtime.ReactDOMClient ||
	typeof runtime.pluginRequest !== "function"
)
	throw Error("Open Personal Visuals from Gen 0.6.5 or newer.");
