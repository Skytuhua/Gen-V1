// Ambient declarations for the probe globals the browser tests install on
// `window` (widget-runtime harness, playback fixtures, instrumentation).
// Ambient script file — `interface Window` merges with lib.dom.
interface Window {
	// Widget-runtime harness counters and state.
	accepted?: string[];
	actionOwner?: string;
	actions?: string[];
	commitC(): void;
	completeCheckpoint(): void;
	failCheckpoint(): void;
	holdAction: boolean;
	rejectLease(): void;
	releaseAction(): void;
	startB(): void;
	switchBack(): void;
	commands: { type?: string; payload?: unknown }[];
	currentLayout: unknown;
	flushRejected: boolean;
	threadDrops?: number;
	runtimeCount: number;
	runtimeArtifact: string;
	runtimeReady: boolean;
	runtime: { post(message: unknown): void };
	ends: number;
	actions: unknown[];
	accepted: unknown[];
	holdAction: boolean;
	releaseFinished: boolean;
	sendDirty(): void;
	sendAction(): void;
	sendCheckpoint(): void;
	releaseLease(): void;
	releaseWidget(): Promise<void>;
	releaseAction(): void;
	rejectAction(): void;
	rejectLease(): void;
	releaseMigration(): void;
	rejectOld(): void;
	rejectTransfer(): void;
	completeCheckpoint(): void;
	failCheckpoint(): void;
	switchOwner(): void;
	switchBack(): void;
	switchWindow(id: string): void;
	startB(): void;
	commitC(): void;
	actionOwner: string;
	accept(): void;
	acceptA(): void;
	reject(): void;
	rejectA(): void;
	oldAccept(): void;
	oldReject(): void;
	selectProject(id: string): void;
	mount(): void;
	dispose(): void;
	hideDocument(): void;
	hideWindow(): void;
	revealWindow(): void;
	suspendWindow(): void;
	escaped: number;
	failures: unknown[];
	bridge: { payload?: { actionId?: unknown; payload?: unknown }; type?: string }[];
	posts: { type?: string; inputs?: { value?: unknown } }[];
	widgetActions: unknown[];
	widgetDirty: boolean;
	widgetHandle: { current: { releaseLease(): void } };
	mountedFrame: HTMLIFrameElement;
	bRendered: boolean;
	renderedB: boolean;
	speculativeRendered: boolean;
	updates: unknown;
	saved: unknown;
	store: { get(...args: string[]): unknown; getSnapshot(): unknown };

	// Instrumentation and counters.
	regionCloses: number;
	documentClosed: number;
	popupClosed: number;
	placeCalls: number;
	__portCloses: number;
	__genWidgetLeaseHeartbeatMs: number;
	productionReady: boolean;
	deferEditorChoice: boolean;
	delayReads: boolean;
	emptyMain: boolean;
	failReads: boolean;
	failWrites: boolean;
	__PV_FAIL_COMMIT: boolean;
	calls: { operation?: string }[];
	mounts: unknown;
	editorChoices: unknown[];
	dockFrames: unknown[];
	pendingReads: unknown[];
	compositionKeys: { isTrusted?: boolean; key?: string; isComposing?: boolean; keyCode?: number }[];
	__readyOwners: unknown[];
	fixtureJournal: { reads: number; rejects: number; resolves: number };

	// Personal-visuals harness.
	__PV_READY: unknown;
	__PV_PRESENTATION: unknown;
	__PV_REGISTRATION: { manifest: { workspaces: unknown } };
	__PV_STATE: { attempts: { requestId?: string }[]; calls: unknown[]; document?: { title?: string }; draft?: unknown; receipts?: Record<string, unknown>; revision?: unknown };
	__PV_FLUSH(): void;

	// Plugin-frame custody probes.
	__hide(): void;
	__reveal(): void;
	__speculate(): void;
	__unmount(): void;
	__afterReveal: unknown;
	__duringHide: unknown;
	__blockedMode: unknown;
	__committedMode: unknown;
	client: {
		pluginReady(): unknown;
		isPluginActive(): boolean;
		pluginRequest(method: string, payload?: unknown): Promise<{ private?: unknown }>;
	};
	GenPluginUI: { pluginFlush(): Promise<unknown> };

	// Editor and misc.
	retainedEditor: Element;
	__originalFrame: Element;
	finishEditorChoice(): void;
	setToolsOpen(value: boolean): void;
	setToolsMinimizeOnly(value: boolean): void;
	setToolsExpandRequest(value: number): void;
	widgetHtmlOverride?: string;
	visualReady: boolean;
}
