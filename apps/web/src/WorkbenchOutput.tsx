import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {
  captureOutputAnchor, fullOutputText, readAuthorizedOutput, restoreOutputAnchor, sameOutputIdentity, searchOutputRows, windowWorkbenchItems,
  type AuthorizedOutputReader, type OutputScrollAnchor, type OutputSearchMatch, type WorkbenchOutputIdentity, type WorkbenchOutputRow,
} from './workbench-window';
import './workbench-output.css';

type WorkbenchOutputState = 'ready' | 'loading' | 'empty' | 'denied' | 'offline' | 'stale' | 'partial' | 'unsupported';
export interface WorkbenchOutputProps {
  identity: WorkbenchOutputIdentity;
  rows: readonly WorkbenchOutputRow[];
  state?: WorkbenchOutputState;
  readFull?: AuthorizedOutputReader;
  initialAnchor?: OutputScrollAnchor | null;
  onAnchorChange?: (anchor: OutputScrollAnchor | null) => void;
  rowHeight?: number;
  label?: string;
}

const stateText: Record<Exclude<WorkbenchOutputState, 'ready'>, string> = {
  loading: 'Loading retained output.', empty: 'No retained output.', denied: 'Access to this output was denied.',
  offline: 'Host disconnected. Retained rows remain visible; full-result reads are unavailable.',
  stale: 'Historical output revision. Full-result actions read this exact revision.',
  partial: 'Partial output. The complete result is unavailable.', unsupported: 'This source does not provide an output read contract.',
};
const sourceKey = (identity: WorkbenchOutputIdentity) => JSON.stringify([identity.logicalOwner, identity.sourceId]);

/** A changed source owner remounts the presentation, while appended revisions of
 * the same source retain the logical scroll anchor. */
export function WorkbenchOutput(props: WorkbenchOutputProps) {
  return <OutputBody key={sourceKey(props.identity)} {...props}/>;
}

function OutputBody({identity, rows, state = 'ready', readFull, initialAnchor, onAnchorChange, rowHeight = 22, label = 'Retained tool output'}: WorkbenchOutputProps) {
  const viewport = useRef<HTMLDivElement>(null), anchor = useRef(initialAnchor ?? null);
  const [scrollTop, setScrollTop] = useState(() => restoreOutputAnchor(rows, initialAnchor, rowHeight));
  const [viewportHeight, setViewportHeight] = useState(360);
  const [query, setQuery] = useState(''), [matches, setMatches] = useState<OutputSearchMatch[] | null>(null), [matchIndex, setMatchIndex] = useState(0);
  const [busy, setBusy] = useState<'copy' | 'search' | null>(null), [status, setStatus] = useState('');
  const currentIdentity = useRef(identity), currentAnchorChange = useRef(onAnchorChange), pendingRead = useRef<AbortController | null>(null), scrollFrame = useRef<number | null>(null);
  currentIdentity.current = identity; currentAnchorChange.current = onAnchorChange;
  const identityRevision = JSON.stringify(identity);
  const available = (state === 'ready' || state === 'stale') && Boolean(readFull);
  const currentAvailable = useRef(available); currentAvailable.current = available;
  const showRows = state === 'ready' || state === 'stale' || state === 'offline' || state === 'partial';
  const presentedRows = showRows ? rows : [];
  const shown = windowWorkbenchItems(presentedRows, {scrollTop, viewportHeight, rowHeight});

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !showRows) return;
    const top = restoreOutputAnchor(rows, anchor.current, rowHeight, scrollTop);
    element.scrollTop = top;
    setScrollTop(element.scrollTop);
    anchor.current = captureOutputAnchor(rows, element.scrollTop, rowHeight);
  }, [rows, rowHeight, showRows]); // A scroll event already owns the current anchor.

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    pendingRead.current?.abort(); setBusy(null); setStatus(''); setMatches(null);
    return () => pendingRead.current?.abort();
  }, [identityRevision, state, readFull]);
  useEffect(() => () => {if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);}, []);

  const scroll = (top: number) => {
    if (!showRows) return;
    anchor.current = captureOutputAnchor(rows, top, rowHeight);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null; setScrollTop(top); currentAnchorChange.current?.(anchor.current);
    });
  };
  const jump = (match: OutputSearchMatch) => {
    const element = viewport.current;
    if (!element) return;
    const index = rows.findIndex(row => row.id === match.itemId);
    if (index < 0) {setStatus('The matching line is outside the available presentation. Reload this exact source revision.'); return;}
    element.scrollTop = index * rowHeight;
    scroll(element.scrollTop);
  };
  const read = async (action: 'copy' | 'search') => {
    if (!available || !readFull) return;
    if (action === 'search' && !query) {setMatches(null); setStatus(''); return;}
    pendingRead.current?.abort();
    const controller = new AbortController(), capturedIdentity = identity;
    pendingRead.current = controller; setBusy(action); setStatus('');
    const stillCurrent = () => currentAvailable.current && !controller.signal.aborted && pendingRead.current === controller && sameOutputIdentity(currentIdentity.current, capturedIdentity);
    try {
      const model = await readAuthorizedOutput(capturedIdentity, readFull, controller.signal);
      if (!stillCurrent()) return;
      if (action === 'copy') {
        await navigator.clipboard.writeText(fullOutputText(model));
        if (stillCurrent()) setStatus('Copied full result.');
      } else {
        const found = searchOutputRows(model, query);
        if (!stillCurrent()) return;
        setMatches(found); setMatchIndex(0);
        if (found.length) jump(found[0]);
      }
    } catch (cause) {
      if (stillCurrent()) setStatus(cause instanceof Error ? cause.message : 'The authorized full result could not be read.');
    } finally {if (stillCurrent()) setBusy(null);}
  };
  const moveMatch = (delta: number) => {
    if (!matches?.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next); jump(matches[next]);
  };

  return <section className="workbench-output" aria-label={label} data-output-source-id={identity.sourceId} data-output-revision={identity.sourceRevision}>
    <div className="workbench-output-actions">
      <button type="button" className="quiet" disabled={!available || busy !== null} onClick={() => void read('copy')}>{busy === 'copy' ? 'Copying full result…' : 'Copy full result'}</button>
      <form role="search" aria-label="Search full output" onSubmit={event => {event.preventDefault(); void read('search');}} onKeyDown={event => {if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();}}>
        <input aria-label="Search full result" type="search" value={query} disabled={!available} onChange={event => {
          if (busy === 'search') {pendingRead.current?.abort(); setBusy(null);}
          setQuery(event.target.value); setMatches(null); setStatus('');
        }}/>
        <button type="submit" className="quiet" disabled={!available || busy !== null || !query}>{busy === 'search' ? 'Searching…' : 'Search full result'}</button>
      </form>
    </div>
    {state !== 'ready' && <p className="workbench-output-state" role="status">{stateText[state]}</p>}
    {state === 'ready' && !rows.length && <p className="workbench-output-state">No retained output.</p>}
    {!readFull && (state === 'ready' || state === 'stale') && <p className="workbench-output-state">Full-result access is unavailable for this source.</p>}
    {matches !== null && <div className="workbench-output-search-result" role="status">
      <span>{matches.length ? `${matchIndex + 1} of ${matches.length} matching lines` : 'No matching lines in the full result.'}</span>
      {matches.length > 0 && <><button type="button" className="quiet" onClick={() => moveMatch(-1)}>Previous match</button><button type="button" className="quiet" onClick={() => moveMatch(1)}>Next match</button></>}
    </div>}
    {status && <p role="status" className="workbench-output-state">{status}</p>}
    <div ref={viewport} className="workbench-output-viewport" data-output-viewport tabIndex={0} role="region" aria-label={`${label}, scrollable rows`} onScroll={event => scroll(event.currentTarget.scrollTop)} style={{'--workbench-row-height': `${rowHeight}px`} as CSSProperties}>
      <div aria-hidden="true" style={{height: shown.topSpacer}}/>
      <div role="list" aria-label={`${presentedRows.length} retained lines`}>
        {shown.items.map((row, index) => <div key={row.id} className="workbench-output-row" data-output-row-id={row.id} role="listitem" aria-posinset={shown.start + index + 1} aria-setsize={presentedRows.length}>{row.text || '\u00a0'}</div>)}
      </div>
      <div aria-hidden="true" style={{height: shown.bottomSpacer}}/>
    </div>
  </section>;
}
