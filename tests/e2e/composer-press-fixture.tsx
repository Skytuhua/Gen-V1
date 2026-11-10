import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ComposerToolbar, ComposerTaskActions } from '../../apps/web/src/ComposerToolbar';
import '../../apps/web/src/styles.css';
import '../../apps/web/src/shell.css';
import '../../apps/web/src/appearance.css';

const root = createRoot(document.getElementById('root')!);
const calls: string[] = [];
function Fixture() {
  const separate = new URLSearchParams(location.search).has('separate');
  const [disabled, setDisabled] = useState(false);
  Object.assign(window, { composerPressFixture: { calls, setDisabled, unmount: () => root.unmount() } });
  const actions = { onChanges: () => { calls.push('changes'); }, onCreatePR: () => { calls.push('pr'); }, disabled };
  return <main className="app-shell">
    <section className="composer" style={{ width: 'min(100%,760px)', margin: 'auto', padding: 12 }}>
      <textarea aria-label="Draft" defaultValue="Keep this draft" />
      {separate && <ComposerTaskActions {...actions} />}
      <ComposerToolbar {...actions} models={[{ id: 'test/model', provider: 'test', name: 'Fixture model', thinkingLevels: ['low', 'high'] }]}
        modelId="test/model" thinkingLevel="high" onModelChange={() => {}} onThinkingChange={() => {}}
        onProject={() => { calls.push('project'); }} onTranscript={() => {}} separateActions={separate}
        leading={<button type="button" className="composer-tool attach-button" aria-label="Attach files" disabled={disabled} onClick={() => calls.push('attach')}>+</button>}
        context={<label className="composer-select">Effort<select aria-label="Fixture effort" disabled={disabled}><option>High</option><option>Low</option></select></label>} />
    </section>
  </main>;
}
root.render(<Fixture />);
