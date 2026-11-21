import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Modal } from '../../../packages/ui-shell/Modal';
import { Select } from '../../../packages/ui-shell/Select';
import { ApiError } from './api.ts';
import { GitHubSignIn } from './GitHubSignIn.tsx';
import { journalRead, journalWrite } from './journal.ts';
import {
  PUBLISH_LIMITS,
  executePublish,
  publishRequestV1Schema,
  type PublishDraftV1,
  type PublishOperationV1,
  type PublishReviewOpen,
  type PublishStep,
} from './publish-api.ts';
import type { TimeFormat } from './time-format';
import './publish-review.css';

export interface PublishReviewProps {
  open: boolean;
  projectId: string;
  threadId: string;
  /** Outcome of the composer chip's draft probe. */
  initial: PublishReviewOpen;
  /** Re-probes the draft; used for Retry, post-sign-in reload and re-review. */
  loadDraft: (signal?: AbortSignal) => Promise<PublishReviewOpen>;
  onClose: () => void;
  timeFormat?: TimeFormat;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/i),
  oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
// Review edits survive reload under the panel journal, bounded like the wire
// contract; the saved basis must match the probed draft or the edits are dropped.
const reviewJournalSchema = z.object({
  version: z.literal(1),
  head: oid,
  revision: hash,
  branch: z.string().max(1024),
  base: z.string().max(151),
  commitMessage: z.string().max(PUBLISH_LIMITS.commitMessage),
  title: z.string().max(PUBLISH_LIMITS.title),
  body: z.string().max(PUBLISH_LIMITS.body),
  excluded: z.array(z.string().max(1024)).max(PUBLISH_LIMITS.files),
});
type ReviewJournal = z.infer<typeof reviewJournalSchema>;

interface ReviewForm {
  base: string;
  commitMessage: string;
  title: string;
  body: string;
  excluded: ReadonlySet<string>;
}

const emptyForm: ReviewForm = { base: '', commitMessage: '', title: '', body: '', excluded: new Set() };

const STEP_LABELS: [keyof PublishOperationV1['steps'], string][] = [
  ['commit', 'Commit'],
  ['push', 'Push'],
  ['pr', 'Open pull request'],
  ['link', 'Link to thread'],
];
const stepStateLabel = (step: PublishStep) =>
  step.state === 'confirmed' ? 'Done' : step.state === 'not-applied' ? 'Skipped' : step.state === 'uncertain' ? 'Uncertain' : 'Not started';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'The publish request failed. Try again.');

export function PublishReview({ open, projectId, threadId, initial, loadDraft, onClose, timeFormat }: PublishReviewProps) {
  const journalKey = `publish-review:${projectId}:${threadId}`;
  const [phase, setPhase] = useState<'loading' | 'form' | 'auth'>('loading');
  const [draft, setDraft] = useState<PublishDraftV1 | null>(null);
  const [form, setForm] = useState<ReviewForm>(emptyForm);
  const [operation, setOperation] = useState<PublishOperationV1 | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(true);

  const persist = (next: ReviewForm, basis: PublishDraftV1) => {
    if (!hydrated) return;
    const value: ReviewJournal = {
      version: 1,
      head: basis.head,
      revision: basis.revision,
      branch: basis.branch,
      base: next.base,
      commitMessage: next.commitMessage,
      title: next.title,
      body: next.body,
      excluded: [...next.excluded].sort(),
    };
    if (reviewJournalSchema.safeParse(value).success) void journalWrite(journalKey, value).catch(() => {});
  };

  const applyDraft = (next: PublishDraftV1) => {
    setHydrated(false);
    const prefill: ReviewForm = {
      base: next.base,
      commitMessage: next.commitMessage,
      title: next.title,
      body: next.body,
      excluded: new Set(),
    };
    void journalRead<unknown>(journalKey)
      .then((raw) => {
        const saved = reviewJournalSchema.safeParse(raw);
        const form = saved.success && saved.data.head === next.head && saved.data.revision === next.revision
          ? {
              base: saved.data.base || next.base,
              commitMessage: saved.data.commitMessage || next.commitMessage,
              title: saved.data.title || next.title,
              body: saved.data.body || next.body,
              excluded: new Set(saved.data.excluded.filter((path) => next.files.some((file) => file.path === path))),
            }
          : prefill;
        if (!mounted.current) return;
        setHydrated(true);
        setForm(form);
      })
      .catch(() => {
        if (!mounted.current) return;
        setHydrated(true);
        setForm(prefill);
      });
    setDraft(next);
    setForm(prefill);
  };

  const accept = (outcome: PublishReviewOpen) => {
    if (outcome.kind === 'draft') {
      applyDraft(outcome.draft);
      setPhase('form');
      setLoadError('');
    } else if (outcome.kind === 'auth') {
      setPhase('auth');
      setLoadError('');
    } else setLoadError('The publish review could not be loaded. Try again.');
  };

  const reload = async () => {
    setPhase('loading');
    setLoadError('');
    try {
      accept(await loadDraft());
    } catch {
      setLoadError('The publish review could not be loaded. Try again.');
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    setOperation(null);
    setError('');
    setRunning(false);
    accept(initial);
    // initial identifies the probe that opened the sheet; reload() is the
    // deliberate re-entry for Retry, sign-in and REVISION_CHANGED.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const update = (patch: Partial<ReviewForm>) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (draft) persist(next, draft);
      return next;
    });
  };

  const approve = async () => {
    if (!draft || running) return;
    const parsed = publishRequestV1Schema.safeParse({
      id: crypto.randomUUID(),
      threadId,
      head: draft.head,
      revision: draft.revision,
      selectedPaths: draft.files.filter((file) => !form.excluded.has(file.path)).map((file) => file.path),
      commitMessage: form.commitMessage,
      title: form.title,
      body: form.body,
      base: form.base,
    });
    if (!parsed.success) {
      setError('The review fields could not be sent. Check each field and try again.');
      return;
    }
    setError('');
    setRunning(true);
    setOperation(null);
    try {
      const result = await executePublish(projectId, parsed.data);
      if (!mounted.current) return;
      setOperation(result);
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof ApiError && cause.code === 'GITHUB_AUTH_REQUIRED') {
        setPhase('auth');
      } else if (cause instanceof ApiError && cause.code === 'REVISION_CHANGED') {
        setError('The working copy changed. Review the current revision before publishing.');
        void reload();
      } else setError(message(cause));
    } finally {
      if (mounted.current) setRunning(false);
    }
  };

  const baseOptions = [{ value: draft?.base ?? form.base, label: draft?.base ?? form.base }];
  if (form.base && !baseOptions.some((option) => option.value === form.base)) baseOptions.push({ value: form.base, label: form.base });
  const selected = draft ? draft.files.filter((file) => !form.excluded.has(file.path)).length : 0;

  return (
    <Modal open={open} title="Review before publishing" onClose={onClose} className="publish-review">
      {phase === 'loading' && <p role="status" className="publish-review-note">Loading the publish review…</p>}
      {loadError && phase !== 'loading' && (
        <p role="status" className="error-text">
          {loadError}{' '}
          <button type="button" className="quiet" onClick={() => void reload()}>
            Retry
          </button>
        </p>
      )}
      {phase === 'auth' && (
        <section className="publish-review-auth">
          <p className="publish-review-note">Sign in to GitHub to publish this working copy.</p>
          <GitHubSignIn active={open && phase === 'auth'} onAuthenticated={() => void reload()} timeFormat={timeFormat ?? 'system'} />
        </section>
      )}
      {phase === 'form' && draft && draft.files.length === 0 && !operation && (
        <p className="publish-review-note">Nothing to publish — the working copy is clean.</p>
      )}
      {phase === 'form' && draft && draft.files.length > 0 && !operation && (
        <form
          className="publish-review-form"
          onSubmit={(event) => {
            event.preventDefault();
            void approve();
          }}
        >
          <section className="publish-review-section" aria-label="Branch to push">
            <h3 className="publish-review-label">Branch to push</h3>
            <p className="publish-review-branch">
              <code>{draft.branch}</code> → origin
            </p>
          </section>
          <section className="publish-review-section" aria-label="Changed files">
            <h3 className="publish-review-label">Files · {selected} of {draft.files.length} selected</h3>
            <ul className="publish-review-files">
              {draft.files.map((file) => {
                const included = !form.excluded.has(file.path);
                return (
                  <li key={file.path} data-excluded={included ? undefined : 'true'}>
                    <input
                      type="checkbox"
                      checked={included}
                      aria-label={`Include ${file.path}`}
                      onChange={(event) => {
                        const excluded = new Set(form.excluded);
                        if (event.target.checked) excluded.delete(file.path);
                        else excluded.add(file.path);
                        update({ excluded });
                      }}
                    />
                    <span className="publish-review-path">{file.path}</span>
                    {file.untracked ? (
                      <small className="publish-review-pill">{included ? 'new' : 'untracked — excluded'}</small>
                    ) : (
                      <small className="publish-review-counts">
                        {file.added === null || file.removed === null ? (
                          'binary'
                        ) : (
                          <>
                            <span className="pr-add">+{file.added}</span> <span className="pr-del">−{file.removed}</span>
                          </>
                        )}
                      </small>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="publish-review-section">
            <h3 className="publish-review-label"><label htmlFor="publish-commit-message">Commit message</label></h3>
            <input
              id="publish-commit-message"
              className="publish-review-mono"
              required
              maxLength={PUBLISH_LIMITS.commitMessage}
              value={form.commitMessage}
              onChange={(event) => update({ commitMessage: event.target.value })}
            />
          </section>
          <section className="publish-review-section">
            <h3 className="publish-review-label"><label htmlFor="publish-pr-title">Pull request</label></h3>
            <input
              id="publish-pr-title"
              required
              maxLength={PUBLISH_LIMITS.title}
              aria-label="Pull request title"
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
            />
            <textarea
              aria-label="Pull request body"
              maxLength={PUBLISH_LIMITS.body}
              value={form.body}
              onChange={(event) => update({ body: event.target.value })}
            />
          </section>
          <section className="publish-review-section">
            <h3 className="publish-review-label">Base branch</h3>
            <Select aria-label="Base branch" value={form.base} options={baseOptions} onValueChange={(value) => update({ base: value })} />
            {draft.baseNote && <p className="publish-review-note">{draft.baseNote}</p>}
          </section>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="publish-review-actions">
            <button type="button" className="quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={running || !hydrated || selected === 0}>
              Commit, push and open draft PR
            </button>
          </div>
          {running && (
            <p role="status" className="publish-review-note">
              Publishing…
            </p>
          )}
        </form>
      )}
      {operation && (
        <section className="publish-review-result" aria-label="Publish result">
          <ul className="publish-review-steps" role="status">
            {STEP_LABELS.map(([key, label]) => (
              <li key={key} data-state={operation.steps[key].state}>
                <span>{label}</span>
                <small>{stepStateLabel(operation.steps[key])}</small>
                {operation.steps[key].error && <small className="error-text">{operation.steps[key].error!.message}</small>}
              </li>
            ))}
          </ul>
          {operation.result && (
            <p className="publish-review-done">
              Opened pull request #{operation.result.number}{' '}
              <a href={operation.result.url} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </p>
          )}
          {!operation.result && (
            <p className="publish-review-note">
              The publish did not complete. Review the step results before trying again.{' '}
              <button type="button" className="quiet" onClick={() => void reload()}>
                Retry
              </button>
            </p>
          )}
          <div className="publish-review-actions">
            <button type="button" className="quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}
