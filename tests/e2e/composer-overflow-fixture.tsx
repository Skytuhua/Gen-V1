import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ComposerToolbar, ComposerTaskActions } from '../../apps/web/src/ComposerToolbar';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/appearance.css';
import '../../apps/web/src/composer-entry.css';

const root = createRoot(document.getElementById('root')!);
const calls: string[] = [];
function Fixture() {
  const [disabled, setDisabled] = useState(false);
  const anchor = useRef<HTMLElement>(null);
  Object.assign(window, { composerOverflowFixture: { calls, setDisabled, unmount: () => root.unmount() } });
  const actions = { onChanges: () => { calls.push('changes'); }, onCreatePR: () => { calls.push('pr'); }, disabled };
  return <main className="app-shell">
    <section className="composer" style={{ width: 'min(100% - 32px,760px)', margin: 'auto' }}>
      <div className="composer-entry-row">
        <div className="composer-input"><textarea aria-label="Message" defaultValue="Keep this draft" /></div>
        <ComposerTaskActions {...actions} />
      </div>
      <ComposerToolbar {...actions} models={[{ id: 'test/model', provider: 'test', name: 'Fixture model', thinkingLevels: ['low', 'high'] }]}
        modelId="test/model" thinkingLevel="high" onModelChange={() => {}} onThinkingChange={() => {}}
        onProject={() => { calls.push('project'); }} onTranscript={() => {}} separateActions
        overflowAnchor={anchor}
        overflowItems={[
          { id: 'saved-drafts', label: 'Saved drafts', title: 'Open your saved drafts', onSelect: () => calls.push('drafts') },
          { id: 'changes', label: 'Changes', accessibleLabel: 'Inspect changes', title: 'Inspect recorded changes', disabled, onSelect: () => calls.push('changes') },
          { id: 'create-pr', label: 'Create PR', accessibleLabel: 'Create PR', title: 'Ask the agent to prepare a pull request', disabled, onSelect: () => calls.push('pr') },
          { id: 'usage', label: 'Live usage', accessibleLabel: 'Show live usage', title: 'Show live usage', onSelect: () => calls.push('usage') },
          { id: 'context', label: 'Context usage', accessibleLabel: 'Inspect context usage', onSelect: () => calls.push('context') },
        ]}
        leading={<><button type="button" className="quiet saved-drafts-trigger" disabled={disabled} onClick={() => calls.push('drafts')}>Saved drafts</button><button type="button" className="icon-button attach-button" aria-label="Attach files" disabled={disabled} onClick={() => calls.push('attach')}>+</button></>}
        runtime={<><span className="pill runtime-pill" title="Local workspace">Local</span><button type="button" className="mode-toggle" aria-label="Task mode" disabled={disabled} onClick={() => calls.push('mode')}>Build</button><button type="button" className="composer-tool composer-usage-launcher" aria-label="Show live usage" title="Show live usage" disabled={disabled} onClick={() => calls.push('usage')}>U</button></>}
        context={<span className="context-anchor"><button type="button" className="icon-button context-button" aria-label="Inspect context usage" disabled={disabled} onClick={() => calls.push('context')}>C</button></span>}
        trailing={<button className="send-button" aria-label="Send message" disabled={disabled} onClick={() => calls.push('send')}>↑</button>} />
    </section>
  </main>;
}
root.render(<Fixture />);
