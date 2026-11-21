import {useLayoutEffect, type RefObject} from 'react';
import {ArrowDown, ArrowUp, X} from 'lucide-react';
import './terminal-find.css';

export interface TerminalFindProps {
  id: string;
  query: string;
  caseSensitive: boolean;
  result: {index: number; count: number} | null;
  limit: number;
  onQuery(value: string): void;
  onCaseSensitive(value: boolean): void;
  onNext(): void;
  onPrevious(): void;
  onClose(): void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function terminalFindCounter(result: {index: number; count: number} | null, limit: number): string {
  if (!result) return '';
  if (result.count === 0) return 'No results';
  if (result.index === -1) return `${result.count} results`;
  return result.count >= limit ? `${result.index + 1} of ${limit}+` : `${result.index + 1} of ${result.count}`;
}

export function TerminalFind({id, query, caseSensitive, result, limit, onQuery, onCaseSensitive, onNext, onPrevious, onClose, inputRef}: TerminalFindProps) {
  useLayoutEffect(() => {inputRef.current?.focus(); inputRef.current?.select();}, [inputRef]);
  const empty = !result || result.count === 0;
  const noResults = query !== '' && result?.count === 0;
  return <div className="terminal-find" id={id} role="search" aria-label="Find in terminal">
    <input ref={inputRef} className={noResults ? 'no-results' : ''} aria-label="Find in terminal" placeholder="Find in output" value={query} onChange={event => onQuery(event.target.value)}
      onKeyDown={event => {
        if (!event.nativeEvent.isComposing && event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); event.stopPropagation(); onNext(); return;}
        if (!event.nativeEvent.isComposing && event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); event.stopPropagation(); onPrevious(); return;}
        if (!event.nativeEvent.isComposing && event.key === 'Escape' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); event.stopPropagation(); onClose(); return;}
      }}/>
    <span className={`terminal-find-counter${noResults ? ' no-results' : ''}`} role="status" aria-live="polite">{terminalFindCounter(result, limit)}</span>
    <button type="button" className="terminal-find-case" aria-label="Match case" aria-pressed={caseSensitive} onClick={() => onCaseSensitive(!caseSensitive)}>Aa</button>
    <button type="button" className="quiet" aria-label="Previous match" disabled={empty} onClick={onPrevious}><ArrowUp size={14}/></button>
    <button type="button" className="quiet" aria-label="Next match" disabled={empty} onClick={onNext}><ArrowDown size={14}/></button>
    <button type="button" className="quiet" aria-label="Close find" onClick={onClose}><X size={14}/></button>
  </div>;
}
