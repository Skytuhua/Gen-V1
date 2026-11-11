import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextInspector, type ContextCompactionReport } from '../../apps/web/src/ContextInspector';
import { UsageDialog } from '../../apps/web/src/UsageDialog';
import { UsageFooter } from '../../apps/web/src/UsageFooter';
import type { UsageProviderReport } from '../../apps/web/src/usage-presentation';
import { EMPTY_USAGE, type Thread } from '../../packages/contracts';
import type { ContextUsage } from '../../apps/web/src/ContextMeter';
import '../../apps/web/src/styles.css';

function Fixture() {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  const [usageOpen, setUsageOpen] = useState(false), [mode, setMode] = useState('reported');
  const [session, setSession] = useState('one'), [threadId, setThreadId] = useState('thread-one'), [epoch, setEpoch] = useState(1);
  const [usage, setUsage] = useState<ContextUsage>({ ...EMPTY_USAGE, contextTokens: 8000, contextWindow: 10000 });
  const [compaction, setCompaction] = useState<ContextCompactionReport>();
  const query = new URLSearchParams(location.search);
  const thread = { id: threadId, epoch, status: 'ready', modelId: query.has('unsupported') ? 'gemini-cli/model' : 'openai/model', runId: null, sessionPath: `/fixture/pi/tasks/${threadId}/sessions/${session}.jsonl` } as Thread;
  useEffect(() => {
    const update = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === 'decrease') setUsage(value => ({ ...value, contextTokens: 4000 }));
      if (action === 'unknown') setUsage({ ...EMPTY_USAGE });
      if (action === 'session') setSession('two');
      if (action === 'thread') setThreadId('thread-two');
      if (action === 'restart') { setEpoch(value => value + 1); setUsage(value => ({ ...value, activity: 'idle' })); }
      if (action === 'pending') setCompaction({ threadId, sessionPath: thread.sessionPath!, epoch, runId: 'compact-run', status: 'pending' });
      if (action === 'cancelled') setCompaction(value => value && { ...value, status: 'cancelled' });
      if (action === 'categories') setUsage(value => ({ ...value, contextTokens: 6000, contextWindow: 10000, contextBreakdown: [
        { label: 'System', tokens: 1000 }, { label: 'Tools & MCP', tokens: 500, subitems: [{ label: 'Reported tool instructions', tokens: 500 }] },
        { label: 'Skills', tokens: 500 }, { label: 'Messages', tokens: 4000 }, { label: 'Reserved', tokens: 1000 }, { label: 'Free', tokens: 3000 },
      ] }));
      if (action === 'accepted' || action === 'foreign' || action === 'unmeasured') {
        setUsage(value => ({ ...value, contextTokens: 4000, contextBreakdown: value.contextBreakdown?.map(item => item.label === 'Messages' ? { ...item, tokens: 2000 } : item.label === 'Free' ? { ...item, tokens: 5000 } : item) }));
        setCompaction({ threadId, sessionPath: thread.sessionPath!, epoch, runId: 'compact-run', status: 'accepted', receipt: {
          id: 'receipt-one', threadId: action === 'foreign' ? 'other-thread' : threadId, sessionPath: thread.sessionPath!, epoch, runId: 'compact-run',
          ...(action === 'unmeasured' ? {} : { beforeTokens: 8000, afterTokens: 4000, contextWindow: 10000 }),
        } });
      }
      if (['empty', 'loading', 'error', 'reported', 'refresh-error'].includes(action)) setMode(action);
    };
    document.documentElement.dataset.usageFixtureReady = 'true';
    window.addEventListener('usage-fixture', update); return () => window.removeEventListener('usage-fixture', update);
  }, [threadId, session, epoch]);
  const reports: UsageProviderReport[] = mode === 'empty' || mode === 'loading' ? [] : Array.from({ length: query.has('overflow') ? 60 : 2 }, (_, index) => ({
    id: `reported-${index}`, scopeId: index % 2 ? 'beta' : 'alpha', scopeLabel: index % 2 ? 'Synthetic Beta' : 'Synthetic Alpha',
    providerId: index % 2 ? 'provider-b' : 'provider-a', providerLabel: index % 2 ? 'Synthetic provider B' : 'Synthetic provider A',
    ...(index % 2 ? {} : { cost: { amount: 0.00123456, currency: 'USD' }, inputTokens: 0, outputTokens: 1234,
      limits: [{ id: 'session', label: 'Session limit', usedPercent: 23.456, reset: '2030-01-01T12:34:56Z' }] }),
  }));
  return <main style={{ padding: 12 }}><p>Synthetic usage/context fixture</p>
    <button onClick={() => setUsageOpen(true)}>Open Usage</button>
    <span className="context-anchor" style={{ position: 'fixed', top: 74, right: 12 }}>
      <button ref={anchor} aria-label="Inspect context" onClick={() => setOpen(value => !value)}>Context</button>
      {open && <ContextInspector anchor={anchor} usage={usage} thread={thread} compaction={compaction} close={() => setOpen(false)} refresh={async () => {}} />}
    </span>
    <UsageFooter usage={usage} visible onOpenUsage={() => setUsageOpen(true)} />
    <UsageDialog open={usageOpen} onClose={() => setUsageOpen(false)} reports={reports} loading={mode === 'loading'} error={mode === 'error' ? 'Synthetic provider failure. Refresh to retry.' : undefined}
      onRefresh={async () => { if (mode === 'refresh-error') throw Error('Synthetic refresh failure'); }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
