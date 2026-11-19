import type {WorkspaceTab} from './workspace-context';

/** Canonical ordered surface list shared by the empty-panel launcher and the plus menu (T04/R05). */
export interface WorkspaceSurfaceEntry {
 id: string;
 label: string;
 description: string;
 shortcut?: string;
 tab?: WorkspaceTab;
 disabled?: string;
}

export const WORKSPACE_SURFACES: readonly WorkspaceSurfaceEntry[] = [
 {id:'browser',label:'Browser',description:'Docked browser window',shortcut:'b'},
 {id:'terminal',label:'Terminal',description:'Interactive host session',shortcut:'t',tab:'terminal'},
 {id:'files',label:'Files',description:'Granted resources',shortcut:'f',tab:'files'},
 {id:'diff',label:'Diff',description:'Prepared changes',shortcut:'d',tab:'diff'},
 {id:'pull-request',label:'Pull request',description:'Project pull requests',shortcut:'p',tab:'pull-request'},
 {id:'linked-pull-requests',label:'Linked pull requests',description:'Connected reviews',shortcut:'l',tab:'linked-pull-requests'},
 {id:'device',label:'Device',description:'Phone and device automation',shortcut:'m'},
 {id:'side-chat',label:'Side chat',description:'A conversation beside the main task',shortcut:'s'},
 {id:'artifact',label:'Artifact',description:'Generated interfaces',tab:'artifact'},
 {id:'plan',label:'Plan',description:'Task plan',tab:'plan'},
 {id:'notes',label:'Notes',description:'Workspace notes',tab:'notes'},
 {id:'output',label:'Output',description:'Recorded operations',tab:'output'},
 {id:'usage',label:'Usage',description:'Runtime reports',tab:'usage'},
];

/** Resolved availability: id -> reason when the surface cannot open on this host. */
export type SurfaceAvailability = Record<string, string | undefined>;
