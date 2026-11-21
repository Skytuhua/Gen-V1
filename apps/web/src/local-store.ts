// Central registry of every browser localStorage key in the web app.
// All helpers swallow storage errors the way the call sites did before,
// so every read/write keeps working when storage is unavailable.
export const storageKeys = {
  selectedThread: 'harness:selected-thread',
  workspaceModeV3: 'harness:workspace-mode:v3',
  workspaceModeV2: 'harness:workspace-mode:v2',
  shellLayoutV1: 'harness:shell-layout:v1',
  workbenchDevice: 'harness:workbench-device',
  modelFavoritesV1: 'harness:model-favorites:v1',
  planCollapseV2: 'harness:plan-collapse:v2',
  signatureAssetsPrefixV1: 'harness:signature-assets:v1:',
  signatureAssetsCorruptPrefixV1: 'harness:signature-assets-corrupt:v1:',
} as const;

export const storageKeyFor = {
  pluginUi: (pluginId: string) => `harness:plugin-ui:${pluginId}`,
  sideSelected: (threadId: string) => `harness:side-selected:${threadId}`,
  documentView: (threadId: string, artifactId: string, suffix: string) => `harness:document-view:${threadId}:${artifactId}:${suffix}`,
  terminal: (projectId: string, threadId: string | null | undefined, terminalId: string | null | undefined) => `gen-terminal:${projectId}:${threadId ?? 'project'}:${terminalId ?? 'default'}`,
  journalPending: (key: string) => `harness:journal-pending:${encodeURIComponent(key)}`,
  floatingLayout: (id: string) => `harness:floating:${id}:v1`,
};

export function readString(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
}
export function writeString(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function writeJson(key: string, value: unknown): boolean {
  return writeString(key, JSON.stringify(value));
}
export function remove(key: string): boolean {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
export function keysWithPrefix(prefix: string): string[] {
  try {
    const out: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) out.push(key);
    }
    return out;
  } catch { return []; }
}

// Reads the persisted workspace mode, promoting a surviving v2 value to v3
// once and deleting the legacy key. Unknown or absent values read as 'chat'.
export function readWorkspaceMode(): 'chat' | 'split' | 'retained-canvas' {
  const saved = readString(storageKeys.workspaceModeV3);
  if (saved !== null) return saved === 'split' || saved === 'retained-canvas' ? saved : 'chat';
  const legacy = readString(storageKeys.workspaceModeV2);
  if (legacy !== null) {
    writeString(storageKeys.workspaceModeV3, legacy);
    remove(storageKeys.workspaceModeV2);
    return legacy === 'split' || legacy === 'retained-canvas' ? legacy : 'chat';
  }
  return 'chat';
}
