import type {Snapshot, Thread} from '../../../packages/contracts';
import {threadNavigationRevision, type ShellSettingsReadModel, type ThreadNavigationRow} from '../../../packages/contracts/shell-read-models';

/** Complete presentation metadata. Bodies and transfer references have separate owners. */
export type SettingsData = Omit<ShellSettingsReadModel, 'resourcePage' | 'learning'> & {
  learning?: ShellSettingsReadModel['learning'];
  archivedThreads: ThreadNavigationRow[];
};
const navigationRow = (thread: Thread): ThreadNavigationRow => {const {id,title,projectId,projectName,createdAt,updatedAt,status,runId,kind,parentThreadId,presentation,workspaceId,modelId,thinkingLevel}=thread;return {id,title,projectId,projectName,createdAt,updatedAt,status,runId,kind,parentThreadId,presentation,workspaceId,modelId,thinkingLevel,threadRevision:threadNavigationRevision(thread)};};

/** Existing conversation callers already own these records; never fetch a Snapshot here. */
export function settingsDataFromSnapshot(snapshot: Snapshot): SettingsData {
  return {
    sequence: snapshot.seq,
    settings: {theme: snapshot.settings.theme, modelId: snapshot.settings.modelId, selectedAccounts: snapshot.settings.selectedAccounts, preferences: snapshot.settings.preferences},
    accounts: snapshot.accounts ?? [], skills: snapshot.skills ?? [], skillProposals: snapshot.skillProposals ?? [], learning: snapshot.learning,
    projects: [...new Map([...snapshot.threads, ...(snapshot.archivedThreads ?? [])].filter(thread => thread.projectId).map(thread => [thread.projectId!, {id: thread.projectId!, name: thread.projectName ?? 'Project'}])).values()],
    resources: snapshot.resources.map(({id, threadId, kind, label, writable, path}) => ({id, threadId, kind, label, writable, path})),
    archivedThreads: (snapshot.archivedThreads ?? []).map(navigationRow),
    counts: {threads: snapshot.threads.length, archivedThreads: snapshot.archivedThreads?.length ?? 0, artifacts: snapshot.artifacts.length, resources: snapshot.resources.length, uncertainOperations: snapshot.operations.filter(item => item.status === 'unknown').length},
  };
}
