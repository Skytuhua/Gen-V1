import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ComposerTaskActions } from '../../apps/web/src/ComposerToolbar';
import { PublishReview } from '../../apps/web/src/PublishReview';
import { probePublishDraft, type PublishReviewOpen } from '../../apps/web/src/publish-api';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/appearance.css';

const root = createRoot(document.getElementById('root')!);
const PROJECT = 'project-one';
const THREAD = 'thread-one';
const INTENT = 'Create a pull request for the current changes.';

function Fixture() {
  const [review, setReview] = useState<PublishReviewOpen | null>(null);
  const [draftText, setDraftText] = useState('');
  Object.assign(window, { publishFixture: { unmount: () => root.unmount() } });
  // Mirrors App.tsx preparePR: probe the draft endpoint, open the review on a
  // usable response, keep the legacy prompt insert otherwise.
  const onCreatePR = async () => {
    const outcome = await probePublishDraft(PROJECT, THREAD);
    if (outcome.kind === 'unavailable') {
      setDraftText((current) => (current.startsWith(INTENT) ? current : INTENT + (current.trim() ? '\n\n' + current : '')));
      return;
    }
    setReview(outcome);
  };
  return (
    <main className="app-shell">
      <section className="composer" style={{ width: 'min(100%,760px)', margin: 'auto', padding: 12 }}>
        <textarea aria-label="Message" value={draftText} onChange={(event) => setDraftText(event.target.value)} />
        <ComposerTaskActions onChanges={() => {}} onCreatePR={onCreatePR} />
        {review && (
          <PublishReview
            open
            projectId={PROJECT}
            threadId={THREAD}
            initial={review}
            loadDraft={(signal) => probePublishDraft(PROJECT, THREAD, signal)}
            onClose={() => setReview(null)}
          />
        )}
      </section>
    </main>
  );
}
root.render(<Fixture />);
