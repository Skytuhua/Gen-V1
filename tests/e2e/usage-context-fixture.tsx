import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextInspector, type ContextCompactionReport } from '../../apps/web/src/ContextInspector';
import { UsageDialog } from '../../apps/web/src/UsageDialog';
import { UsageFooter } from '../../apps/web/src/UsageFooter';
import type { UsageProviderReport } from '../../apps/web/src/usage-presentation';
import type { ModelRequestObservationV1 } from '../../packages/contracts/model-request';
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
      if (['budget-known', 'budget-unavailable', 'budget-blocked'].includes(action)) setUsage(value => ({ ...value, inferenceBudget: {
        threadId, runId: 'fixture-run', epoch, budget: { version: 1, sequence: 2, promptBytes: action === 'budget-blocked' ? 16 * 1024 * 1024 + 1 : 220, maxPromptBytes: 16 * 1024 * 1024,
          measurement: 'BYTE_ONLY', byteAdmission: action === 'budget-blocked' ? 'BLOCKED' : 'WITHIN_LIMIT', tokenAdmission: 'UNAVAILABLE',
          sourceContinuity: action === 'budget-known' ? 'VERIFIED' : 'UNAVAILABLE', newSourceBytes: action === 'budget-known' ? 100 : null,
          newToolResultBytes: action === 'budget-known' ? 80 : null, newToolResults: action === 'budget-known' ? 1 : null,
          previousRequest: action === 'budget-known' ? { requestId: 'previous-request', sequence: 1, inputTokens: 12, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: null,
            reportedContextTokens: 5000, contextWindowTokens: 10000, usageConvention: 'provider-reported', contextMeasurement: 'UNSPECIFIED' } : null,
          normalizedInputTokens: null, newUnreportedToolTokens: null, reservedOutputTokens: null, requiredTokens: null, shouldConsiderCompaction: null,
          unknown: action === 'budget-known' ? ['NORMALIZED_INPUT', 'TOKENIZER', 'OUTPUT_RESERVE'] : ['NORMALIZED_INPUT', 'TOKENIZER', 'OUTPUT_RESERVE', 'CONTEXT_WINDOW', 'SOURCE_CONTINUITY'],
        },
      } }));
      if (action === 'request-proof' || action === 'request-schemas') setUsage(value => ({ ...value, lastRequest: { threadId, runId: 'fixture-run', epoch, sequence: 1, promptBytes: 13, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes', ...(action === 'request-schemas' ? {toolSnapshot:{count:7,schemaBytes:428,digest:'a'.repeat(64)}} : {}) }, hostProjection: { threadId, runId:'fixture-run', epoch, sourceCutDigest: 'fixture', measurement:'BYTE_ONLY', sources: [{category:'USER',revision:1,utf8Bytes:13,inclusionReason:'selected by host',tokens:null,measurement:'BYTE_ONLY',exclusionReason:null}], omittedSources:0 } }));
      if (action === 'request-relevance') setUsage(value => ({ ...value, lastRequest: { threadId, runId: 'fixture-run', epoch, sequence: 4, promptBytes: 1300, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes', relevance: {
        cutId: 'b'.repeat(64), observedAtSequence: 4, candidateIds: ['host-result:1'], estimatedSavingsBytes: 1200, inspectionBudgetBytes: 65536, inspectedResults: 1, protectedResults: 0, omittedResults: 2, source: 'HOST_READ_RESULTS', measurement: 'BYTE_ONLY',
      } } }));
      if (action === 'request-native-sources') setUsage(value => ({ ...value, lastRequest: { threadId, runId: 'fixture-run', epoch, sequence: 2, promptBytes: 120, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes', nativeSources: {
        source: 'ORIGINAL_ACP_MESSAGES', measurement: 'BYTE_ONLY', generation: 1, revisionDigest: 'e'.repeat(64), change: 'APPEND', sourceCount: 3, sourceBytes: 90,
        reusedSources: 2, compiledSources: 1, inspectedSources: 3, newToolResults: 1, newToolResultBytes: 40,
        sources: [{ category: 'SYSTEM', sourceId: 'native:1:0', sourceRevision: 1, utf8Bytes: 20, sha256: 'a'.repeat(64) }, { category: 'USER', sourceId: 'native:1:1', sourceRevision: 1, utf8Bytes: 30, sha256: 'b'.repeat(64) }, { category: 'TOOL', sourceId: 'native:1:2', sourceRevision: 1, utf8Bytes: 40, sha256: 'c'.repeat(64) }], omittedSources: 0,
      } } }));
      if (action === 'request-native-unavailable') setUsage(value => ({ ...value, lastRequest: { threadId, runId: 'fixture-run', epoch, sequence: 2, promptBytes: 120, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes', nativeSourcesUnavailable: 'SOURCE_LIMIT' } }));
      if (action === 'request-instructions') setUsage(value => ({ ...value, lastRequest: { threadId, runId: 'fixture-run', epoch, sequence: 1, promptBytes: 500, knownInputs: 1, visibility: 'OPAQUE_NATIVE_CONTEXT', source: 'hermes' }, hostProjection: {
        threadId, runId: 'fixture-run', epoch, sourceCutDigest: 'fixture', measurement: 'BYTE_ONLY', sources: [], omittedSources: 0,
        projectInstructions: { entries: [{ filename: 'AGENTS.md', resourceId: 'project', scope: 'approved-root', precedence: 0, digest: 'c'.repeat(64), utf8Bytes: 120 }], duplicates: [], overlaps: [{ scope: 'approved-root', filenames: ['AGENTS.md', 'CLAUDE.md'] }], exclusions: [{ filename: 'GEMINI.md', resourceId: 'project', reason: 'UNSUPPORTED_DIRECTIVE' }], omittedRoots: 0, precedence: 'Within each explicit scope: AGENTS.md, CLAUDE.md, GEMINI.md; later files take precedence. Host authorization always takes precedence.' },
      } }));
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
  const requests: ModelRequestObservationV1[] = query.has('requests') ? [
    { version: 1, requestId: 'fixture-request-1', owner: { threadId, runId: 'run-1', epoch, sequence: 1, inputIds: [], phase: 'foreground' },
      binding: { providerId: 'provider-a', modelId: 'openai/model', accountId: null }, measurementSource: 'hermes-broker',
      timings: { queued: Date.now(), acquired: 12, runtimeReady: 140, requestSent: 145, firstProviderDelta: 810, firstPublicDelta: 1980, settled: 1900, teardownConfirmed: 1950 },
      usage: { inputTokens: 1024, outputTokens: 256, cacheReadTokens: 512, cacheWriteTokens: null, cost: 0.0004321 }, usageConvention: 'provider-reported', outcome: 'completed' },
    { version: 1, requestId: 'fixture-request-2', owner: { threadId, runId: 'run-1', epoch, sequence: 2, inputIds: [], phase: 'background' },
      binding: { providerId: 'provider-b', modelId: 'gemini-cli/model', accountId: null }, measurementSource: 'hermes-broker',
      timings: { queued: Date.now(), acquired: null, runtimeReady: null, requestSent: null, firstProviderDelta: null, firstPublicDelta: null, settled: null, teardownConfirmed: null },
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null }, usageConvention: 'unreported', outcome: 'failed', error: 'Synthetic request failure.' },
    { version: 1, requestId: 'fixture-request-3', owner: { threadId, runId: 'run-2', epoch, sequence: 3, inputIds: [], phase: 'foreground' },
      binding: { providerId: 'provider-a', modelId: 'openai/model', accountId: null }, measurementSource: 'hermes-broker',
      timings: { queued: Date.now(), acquired: 10, runtimeReady: 120, requestSent: 125, firstProviderDelta: null, firstPublicDelta: null, settled: 900, teardownConfirmed: 910 },
      usage: { inputTokens: 128, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, cost: null }, usageConvention: 'provider-reported', outcome: 'cancelled' },
  ] : [];
  return <main style={{ padding: 12 }}><p>Synthetic usage/context fixture</p>
    <button onClick={() => setUsageOpen(true)}>Open Usage</button>
    <span className="context-anchor" style={{ position: 'fixed', top: 74, right: 12 }}>
      <button ref={anchor} aria-label="Inspect context" onClick={() => setOpen(value => !value)}>Context</button>
      {open && <ContextInspector anchor={anchor} usage={usage} thread={thread} compaction={compaction} close={() => setOpen(false)} refresh={async () => {}} />}
    </span>
    <UsageFooter usage={usage} visible onOpenUsage={() => setUsageOpen(true)} />
    <UsageDialog open={usageOpen} onClose={() => setUsageOpen(false)} reports={reports} requests={requests} loading={mode === 'loading'} error={mode === 'error' ? 'Synthetic provider failure. Refresh to retry.' : undefined}
      onRefresh={async () => { if (mode === 'refresh-error') throw Error('Synthetic refresh failure'); }} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
