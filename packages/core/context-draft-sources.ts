export interface ContextSourceCapture {
  readonly sourceId: string;
  readonly revision: string;
  readonly owner: string;
  readonly kind: 'FILE' | 'MESSAGE' | 'SESSION';
  readonly previewBytes: number;
  readonly label: string;
}
export interface ContextSourceDraft {
  readonly owner: string;
  readonly revision: number;
  readonly sources: readonly ContextSourceCapture[];
}
type Action = { type: 'select' | 'refresh'; capture: ContextSourceCapture } | { type: 'remove'; sourceId: string };
const previewCap = 64 * 1024;
const valid = (entry: ContextSourceCapture) =>
  Boolean(entry.sourceId && entry.sourceId.length <= 512 && entry.revision && entry.revision.length <= 512 && entry.label && entry.label.length <= 200) &&
  ['FILE', 'MESSAGE', 'SESSION'].includes(entry.kind) && Number.isSafeInteger(entry.previewBytes) && entry.previewBytes >= 0 &&
  entry.previewBytes <= previewCap;
const matches = (a: ContextSourceCapture, b: ContextSourceCapture) =>
  a.sourceId === b.sourceId && a.kind === b.kind && a.owner === b.owner;
function assertDraft(draft: ContextSourceDraft) {
  if (!draft.owner || !Number.isSafeInteger(draft.revision) || draft.revision < 0 || draft.revision >= Number.MAX_SAFE_INTEGER)
    throw new Error('Invalid context draft owner or revision');
  if (draft.sources.length > 8) throw new Error('Choose at most eight context references');
  if (new Set(draft.sources.map(entry => entry.sourceId)).size !== draft.sources.length ||
    draft.sources.some(entry => entry.owner !== draft.owner || !valid(entry))) throw new Error('Invalid context reference or scope');
  if (draft.sources.reduce((bytes, entry) => bytes + entry.previewBytes, 0) > previewCap)
    throw new Error('Combined context preview exceeds 64 KiB');
}
const copy = (entry: ContextSourceCapture): ContextSourceCapture => Object.freeze({
  sourceId: entry.sourceId, revision: entry.revision, owner: entry.owner, kind: entry.kind,
  previewBytes: entry.previewBytes, label: entry.label,
});

/** Immutable next-draft state only. Selection is not the authority to read a source. */
export function updateDraftSource(draft: ContextSourceDraft, action: Action): ContextSourceDraft {
  assertDraft(draft);
  let sources: readonly ContextSourceCapture[];
  if (action.type === 'remove') {
    sources = draft.sources.filter(entry => entry.sourceId !== action.sourceId);
    if (sources.length === draft.sources.length) return draft;
  } else {
    const capture = action.capture;
    if (capture.owner !== draft.owner || !valid(capture)) throw new Error('Invalid context reference or scope');
    const prior = draft.sources.find(entry => entry.sourceId === capture.sourceId);
    if (action.type === 'refresh') {
      if (!prior || !matches(prior, capture)) throw new Error('Refresh must preserve the captured source identity');
      sources = draft.sources.map(entry => entry === prior ? copy(capture) : entry);
    } else {
      if (prior) throw new Error('Use Refresh or Keep to resolve an existing capture');
      sources = [...draft.sources, copy(capture)];
    }
  }
  const next = { owner: draft.owner, revision: draft.revision + 1, sources: Object.freeze(sources.map(copy)) };
  assertDraft(next);
  return Object.freeze(next);
}

/** The host must re-resolve the grant and captured version; keeping is not a bypass. */
export function checkDraftSources(draft: ContextSourceDraft, options: {
  current(source: ContextSourceCapture): (ContextSourceCapture & { canRetainCaptured: boolean }) | null;
}, keep: readonly string[]) {
  assertDraft(draft);
  const needsDecision: string[] = [];
  const kept = new Set(keep.slice(0, 8));
  for (const capture of draft.sources) {
    let current: ReturnType<typeof options.current>;
    try { current = options.current(capture); } catch { current = null; }
    if (!current || !valid(current) || !matches(capture, current))
      return { status: 'UNAVAILABLE' as const, sources: [], needsDecision: [] };
    if (current.revision !== capture.revision && !(kept.has(capture.sourceId) && current.canRetainCaptured === true))
      needsDecision.push(capture.sourceId);
  }
  return needsDecision.length ? { status: 'NEEDS_DECISION' as const, sources: [], needsDecision } :
    { status: 'READY' as const, sources: Object.freeze(draft.sources.map(copy)), needsDecision: [] };
}
