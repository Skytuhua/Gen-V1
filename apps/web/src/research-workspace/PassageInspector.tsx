import {useEffect, useState} from 'react';
import type {ResearchPassage, ResearchProvider, ResearchSource} from '../../../../packages/contracts/research';
import {LoadingState} from '../LoadingState';
import {ApiError} from '../api';
import {researchClient, researchError, type ResearchSelection} from './client';
import {SourceIdentity} from './SourceReader';

export function PassageInspector({selection, passage, onClose}: {selection: ResearchSelection; passage: ResearchPassage; onClose: () => void}) {
  const [result, setResult] = useState<{source: ResearchSource; passage: ReturnType<ResearchProvider['passage']>}>();
  const [pending, setPending] = useState(true), [error, setError] = useState(''), [status, setStatus] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined); setPending(true); setError(''); setStatus('');
    void Promise.all([researchClient.source(selection, passage.sourceId, passage.revision, controller.signal), researchClient.passage(selection, passage, controller.signal)])
      .then(([source, result]) => {if (!controller.signal.aborted) setResult({source, passage: result});})
      .catch(cause => {if (!controller.signal.aborted) {setStatus(cause instanceof ApiError && cause.code === 'CAPABILITY_DENIED' ? 'Access revoked or denied' : cause instanceof ApiError && cause.code === 'NOT_FOUND' ? 'Missing revision' : 'Unverified passage'); setError(researchError(cause));}})
      .finally(() => {if (!controller.signal.aborted) setPending(false);});
    const clear = () => {controller.abort(); setResult(undefined); setStatus('Unverified passage'); setError('Recheck access to read this passage.'); setPending(false);};
    window.addEventListener('blur', clear);
    return () => {controller.abort(); window.removeEventListener('blur', clear);};
  }, [selection, passage, retry]);
  return <section className="research-inspector" aria-label="Passage inspector"><header className="research-actions"><h3>Captured passage</h3><button onClick={onClose}>Close passage</button></header>
    <LoadingState pending={pending} hasContent={Boolean(result)} label="Checking passage access…">
      {result && <><SourceIdentity source={result.source} /><p className="research-meta">{result.passage.status === 'stale' ? 'Stale capture' : 'Current capture'} · live source unverified · bytes {passage.start}–{passage.end}</p><blockquote>{result.passage.text}</blockquote></>}
    </LoadingState>
    {error && <div role="alert"><strong>{status}</strong><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry passage</button></div>}
  </section>;
}
