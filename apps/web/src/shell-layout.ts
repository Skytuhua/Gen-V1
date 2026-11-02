import { useEffect, useState } from 'react';
import type { WorkspaceTab } from './workspace-context';

export interface ShellLayout { sidebarCollapsed: boolean; sidebarWidth: number; rightPanelOpen: boolean; rightPanelWidth: number; rightPanelMaximized: boolean; activeTab: WorkspaceTab; activeArtifactId: string | null; folded: Record<string, boolean> }
const defaults: ShellLayout = { sidebarCollapsed: false, sidebarWidth: 248, rightPanelOpen: false, rightPanelWidth: 520, rightPanelMaximized: false, activeTab: 'artifact', activeArtifactId: null, folded: {} };
export function readShellLayout(): ShellLayout {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('harness:shell-layout:v1') ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const value = saved as Partial<ShellLayout>;
    return { ...defaults, sidebarCollapsed: value.sidebarCollapsed === true, sidebarWidth: typeof value.sidebarWidth === 'number' && Number.isFinite(value.sidebarWidth) ? Math.max(200, Math.min(380, value.sidebarWidth)) : defaults.sidebarWidth,
      rightPanelOpen: value.rightPanelOpen === true, rightPanelWidth: typeof value.rightPanelWidth === 'number' && Number.isFinite(value.rightPanelWidth) ? Math.max(360, Math.min(960, value.rightPanelWidth)) : defaults.rightPanelWidth,
      rightPanelMaximized: value.rightPanelMaximized === true, activeTab: ['artifact', 'files', 'diff', 'output', 'usage'].includes(value.activeTab ?? '') ? value.activeTab! : 'artifact', activeArtifactId: typeof value.activeArtifactId === 'string' ? value.activeArtifactId : null,
      folded: value.folded && typeof value.folded === 'object' ? Object.fromEntries(Object.entries(value.folded).filter(([key, state]) => key.length < 220 && typeof state === 'boolean')) : {} };
  } catch { return defaults; }
}
export function useShellLayout() {
  const [layout, setLayout] = useState(readShellLayout);
  useEffect(() => { try { localStorage.setItem('harness:shell-layout:v1', JSON.stringify(layout)); } catch { /* Panel layout remains usable without local storage. */ } }, [layout]);
  return [layout, setLayout] as const;
}
export function matchesShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, shortcut: string) {
  const parts = shortcut.toLowerCase().split('+').map(part => part.trim());
  const rawKey = parts.at(-1);
  const key = rawKey === 'comma' ? ',' : rawKey === 'esc' ? 'escape' : rawKey;
  const mod = parts.includes('ctrl') || parts.includes('mod');
  return event.key.toLowerCase() === key && (mod ? event.ctrlKey || event.metaKey : parts.includes('meta') ? event.metaKey : !event.ctrlKey && !event.metaKey)
    && event.shiftKey === parts.includes('shift') && event.altKey === parts.includes('alt');
}
