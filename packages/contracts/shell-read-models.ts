import type {Thread, Snapshot, ResourceGrant, LearningStatus} from './index.ts';
import type {ConnectionAccount} from './accounts.ts';
import type {SkillSummary, SkillProposalSummary} from './skills.ts';

export type ThreadNavigationRow = Pick<Thread, 'id' | 'title' | 'projectId' | 'projectName' | 'createdAt' | 'updatedAt' | 'status' | 'runId' | 'kind' | 'parentThreadId' | 'presentation'>;
export interface ShellPage<T> {sequence: number; total: number; items: T[]; nextCursor: string | null}
export interface NavigationPage extends ShellPage<ThreadNavigationRow> {
  order: 'created-desc';
  stats: {pinned: number; working: number; waiting: number; settled: number; minOrder: number; maxOrder: number};
}
export type ShellResourceRow = Pick<ResourceGrant, 'id' | 'threadId' | 'kind' | 'label' | 'writable' | 'path'>;
export interface ShellSettingsReadModel {
  sequence: number;
  settings: Snapshot['settings'];
  accounts: ConnectionAccount[];
  skills: SkillSummary[];
  skillProposals: SkillProposalSummary[];
  learning: LearningStatus;
  projects: {id: string; name: string}[];
  resources: ShellResourceRow[];
  resourcePage: {total: number; nextCursor: string | null};
  counts: {threads: number; archivedThreads: number; artifacts: number; resources: number; uncertainOperations: number};
}
/** Only reference validation metadata, never a fake Snapshot or artifact values. */
export interface DraftTransferReferences {
  threads: {id: string}[];
  skills: {name: string; revision: number}[];
  userStates: {id: string; revision: number}[];
  requests: {id: string; revision: number; presentation?: unknown; responseSchema: Record<string, unknown>}[];
}
