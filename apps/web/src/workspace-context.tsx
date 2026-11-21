import { createContext, useContext, type ReactNode } from 'react';

export type WorkspaceTab = 'artifact' | 'plan' | 'files' | 'diff' | 'notes' | 'output' | 'usage' | 'terminal' | 'pull-request' | 'linked-pull-requests';
export type DocumentWindowPlacement = 'docked' | 'floating';
export interface OpenDocumentWindow { id:string; placement:DocumentWindowPlacement }
export interface WorkspaceContextValue {
  activeArtifactId: string | null;
  requestOpenArtifact: (id: string) => void;
  closeArtifact: () => void;
  rightPanelOpen: boolean;
  activeTab: WorkspaceTab;
  setActiveTab: (tab: WorkspaceTab) => void;
  openTabs?: WorkspaceTab[];
  openTab?: (tab: WorkspaceTab) => void;
  closeTab?: (tab: WorkspaceTab) => void;
  documentWindow?: OpenDocumentWindow | null;
  requestOpenDocument?: (id:string) => void;
  closeDocument?: (id:string) => void;
  placeDocument?: (id:string,placement:DocumentWindowPlacement) => void;
  openSurface?: (id:string) => void | Promise<void>;
  surfaceAvailability?: Record<string,string|undefined>;
}
const WorkspaceContext = createContext<WorkspaceContextValue>({ activeArtifactId: null, requestOpenArtifact: () => {}, closeArtifact: () => {}, rightPanelOpen: false, activeTab: 'artifact', setActiveTab: () => {} });
export function WorkspaceProvider({ value, children }: { value: WorkspaceContextValue; children: ReactNode }) { return <WorkspaceContext value={value}>{children}</WorkspaceContext>; }
export function useWorkspace() { return useContext(WorkspaceContext); }
