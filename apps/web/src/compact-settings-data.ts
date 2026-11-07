import type {ShellPage, ShellResourceRow, ThreadNavigationRow} from '../../../packages/contracts/shell-read-models';
import {getShellArchive, getShellResources, getShellSettingsReadModel} from './shell-read-api';
import type {SettingsData} from './settings-data';

async function complete<T extends {id: string}>(first: ShellPage<T>, next: (cursor: string) => Promise<ShellPage<T>>, signal: AbortSignal): Promise<T[]> {
  const items = [...first.items], ids = new Set(items.map(item => item.id)), cursors = new Set<string>();
  let cursor = first.nextCursor;
  if (ids.size !== items.length) throw Error('Settings metadata repeated a record. Refresh to retry.');
  while (cursor !== null) {
    signal.throwIfAborted();
    if (cursors.has(cursor)) throw Error('Settings metadata repeated a page. Refresh to retry.');
    cursors.add(cursor);
    const page = await next(cursor); signal.throwIfAborted();
    if (page.total !== first.total) throw Error('Settings metadata changed while loading. Refresh to retry.');
    for (const item of page.items) {
      if (ids.has(item.id)) throw Error('Settings metadata repeated a record. Refresh to retry.');
      ids.add(item.id); items.push(item);
    }
    if (!page.items.length && page.nextCursor !== null) throw Error('Settings metadata is incomplete. Refresh to retry.');
    cursor = page.nextCursor;
  }
  signal.throwIfAborted();
  if (items.length !== first.total) throw Error('Settings metadata is incomplete. Refresh to retry.');
  return items;
}

export async function loadCompactSettings(signal: AbortSignal): Promise<SettingsData> {
  signal.throwIfAborted();
  const model = await getShellSettingsReadModel(signal); signal.throwIfAborted();
  const [resources, archivedThreads] = await Promise.all([
    complete<ShellResourceRow>({sequence: model.sequence, total: model.resourcePage.total, items: model.resources, nextCursor: model.resourcePage.nextCursor}, cursor => getShellResources({limit: 100, cursor}, signal), signal),
    getShellArchive({limit: 100}, signal).then(page => complete<ThreadNavigationRow>(page, cursor => getShellArchive({limit: 100, cursor}, signal), signal)),
  ]);
  signal.throwIfAborted();
  if (resources.length !== model.counts.resources || archivedThreads.length !== model.counts.archivedThreads) throw Error('Settings metadata changed while loading. Refresh to retry.');
  return {sequence: model.sequence, settings: model.settings, accounts: model.accounts, skills: model.skills, skillProposals: model.skillProposals, learning: model.learning, projects: model.projects, resources, archivedThreads, counts: model.counts};
}
