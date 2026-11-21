// Native turn-cut custody (#1532 T01): an immutable pre-turn cut is a copy of
// the sealed `hermes-source-session-v1` session file; a generation is a fresh
// session namespace hydrated from that cut. The session file name is
// sha256(threadId[ + ':' + sessionGeneration]).json — worker.py computes the
// same formula; keep both sides in sync.

import {createHash} from 'node:crypto';

export const SESSION_GENERATION_PATTERN = /^g[0-9a-f]{16}$/;
export const TURN_CUT_PATTERN = /^c[0-9a-f]{16}$/;
const HERMES_SOURCE_COMMIT = 'c627ec84664d43e0b18b95d9d86d8963747d56c7';
const SESSION_FORMAT = 'hermes-source-session-v1';

export function validateSessionGeneration(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !SESSION_GENERATION_PATTERN.test(value)) throw new Error('The native session generation is invalid.');
}

export function sessionFileName(input: { threadId: string; sessionGeneration?: string | null }): string {
  if (input.sessionGeneration !== undefined && input.sessionGeneration !== null) validateSessionGeneration(input.sessionGeneration);
  const seed = input.sessionGeneration ? `${input.threadId}:${input.sessionGeneration}` : input.threadId;
  return createHash('sha256').update(seed).digest('hex') + '.json';
}

export function turnCutId(content: string | Buffer): string {
  return 'c' + createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export interface HermesSessionFile {
  format: string;
  sourceCommit: string;
  ownership?: { threadId: string; accountId: string | null; sessionPath: string; sourceCommit: string; sessionGeneration?: string | null };
  identity?: string;
  sessionId?: string | null;
  messages: unknown[];
}

/** Parse and structurally validate a sealed session file (or an immutable cut of one). */
export function parseSessionFile(raw: unknown): HermesSessionFile {
  const saved = raw as HermesSessionFile;
  if (!saved || typeof saved !== 'object' || saved.format !== SESSION_FORMAT || saved.sourceCommit !== HERMES_SOURCE_COMMIT) throw new Error('Not a pinned Hermes source session.');
  if (!saved.ownership || typeof saved.ownership.threadId !== 'string' || !saved.ownership.threadId || typeof saved.ownership.sessionPath !== 'string') throw new Error('The source session ownership is missing.');
  if (saved.ownership.sourceCommit !== HERMES_SOURCE_COMMIT) throw new Error('The source session belongs to another engine.');
  if (saved.ownership.sessionGeneration !== undefined && saved.ownership.sessionGeneration !== null && !SESSION_GENERATION_PATTERN.test(saved.ownership.sessionGeneration)) throw new Error('The source session generation is invalid.');
  if (!Array.isArray(saved.messages)) throw new Error('The source session has no message history.');
  return saved;
}

/**
 * Rebind an immutable cut to a fresh generation namespace. Returns a new
 * session-file object whose ownership names the generation path; the cut
 * itself is never mutated. `sessionId` is dropped: the hydrated generation
 * must start a new native session, not continue the old one.
 */
export function hydrateGeneration(cut: HermesSessionFile, generationPath: string, generationId: string): HermesSessionFile {
  validateSessionGeneration(generationId);
  const parsed = parseSessionFile(cut);
  return {
    format: parsed.format,
    sourceCommit: parsed.sourceCommit,
    identity: parsed.identity,
    sessionId: null,
    ownership: {
      threadId: parsed.ownership!.threadId,
      accountId: parsed.ownership!.accountId ?? null,
      sessionPath: generationPath,
      sourceCommit: HERMES_SOURCE_COMMIT,
      sessionGeneration: generationId,
    },
    messages: parsed.messages,
  };
}
