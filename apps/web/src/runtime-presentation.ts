import type { Thread } from '../../../packages/contracts';

/** Presentation only: the host still validates the session, runtime and action. */
export function unavailableCompaction(thread: Thread | undefined): { status: string; reason: string } | undefined {
  const path = thread?.sessionPath?.replaceAll('\\', '/') ?? '';
  // Official manifests have this exact suffix. Do not mistake an earlier
  // directory name in the user's chosen data root for the owning runtime.
  const official = /(?:^|\/)official\/([^/]+)\/tasks\/[^/]+\/session\.json$/i.exec(path);
  const pi = /(?:^|\/)pi\/tasks\/[^/]+\/sessions\/[^/]+\.jsonl$/i.test(path);
  const provider = official?.[1].toLowerCase() ?? (pi ? 'pi' : thread?.modelId?.split('/')[0]);
  const name = provider === 'gemini-cli' ? 'Gemini' : provider === 'cursor-sdk' ? 'Cursor' : undefined;
  return name ? {
    status: `${name} compaction unavailable`,
    reason: `${name} does not support context compaction. Start a new thread for fresh context.`,
  } : undefined;
}
