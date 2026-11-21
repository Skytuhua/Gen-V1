import {useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref, type RefObject} from 'react';
import {FileText, LoaderCircle, Search, X} from 'lucide-react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import {mentionToken, replaceMentionToken} from './composer-mentions';
import {fetchFileSuggestions, type FileSuggestionsResponse} from './files/file-suggestions-api';
import './composer-commands.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

export interface ComposerMentionsHandle {keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean; open: boolean}
interface Props {
  ref?: Ref<ComposerMentionsHandle>; input: RefObject<HTMLTextAreaElement | null>; draft: string;
  owner?: {projectId: string; threadId: string}; disabled?: boolean;
  onDraft(text: string): void;
  onSelect(path: string): void;
  onOpenChange?(open: boolean): void;
}
type Item = FileSuggestionsResponse['items'][number];

/** @-mention file picker: same shell and keyboard contract as ComposerCommands. */
export function ComposerMentions({ref, input, draft, owner, disabled = false, onDraft, onSelect, onOpenChange}: Props) {
  const id = useId(), content = useRef<HTMLDivElement>(null), request = useRef(0), flagOff = useRef('');
  const [position, setPosition] = useState({caret: 0, end: 0, focused: false, composing: false});
  const [dismissed, setDismissed] = useState(''), [response, setResponse] = useState<{key: string; value: FileSuggestionsResponse} | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [active, setActive] = useState(''), [reload, setReload] = useState(0);
  const token = position.focused && !position.composing && !disabled ? mentionToken(draft, position.caret, position.end) : null;
  const ownerKey = owner ? `${owner.projectId}:${owner.threadId}` : '';
  const signature = token ? `${ownerKey}:${token.start}:${token.end}:${token.query}` : '';
  const open = Boolean(token && signature !== dismissed && !(owner && flagOff.current === ownerKey));
  const page = response?.key === `${ownerKey}:${token?.query ?? ''}` ? response.value : null;
  const items: Item[] = page?.items ?? [];
  const selected = items.find(item => item.path === active) ?? items[0];
  const close = () => setDismissed(signature);
  useEffect(() => {setDismissed(previous => previous && previous !== signature ? '' : previous);}, [signature]);
  useEffect(() => {onOpenChange?.(open);}, [open, onOpenChange]);
  useLayoutEffect(() => {
    const element = input.current; if (!element) return;
    const update = () => setPosition(previous => {
      const next = {...previous, caret: element.selectionStart, end: element.selectionEnd, focused: element.ownerDocument.activeElement === element};
      return Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next;
    });
    const start = () => setPosition(previous => ({...previous, composing: true}));
    const finish = () => {setPosition(previous => ({...previous, composing: false})); update();};
    const focus = () => {setDismissed(''); update();};
    for (const name of ['select', 'click', 'keyup', 'input']) element.addEventListener(name, update);
    element.addEventListener('focus', focus);
    element.addEventListener('compositionstart', start); element.addEventListener('compositionend', finish); update();
    return () => {for (const name of ['select', 'click', 'keyup', 'input']) element.removeEventListener(name, update); element.removeEventListener('focus', focus); element.removeEventListener('compositionstart', start); element.removeEventListener('compositionend', finish);};
  }, [input]);
  useLayoutEffect(() => {const element = input.current; if (element) setPosition(previous => ({...previous, caret: element.selectionStart, end: element.selectionEnd, focused: element.ownerDocument.activeElement === element}));}, [draft, input]);
  const query = token?.query ?? '';
  useEffect(() => {
    const generation = ++request.current, controller = new AbortController();
    setResponse(null); setError('');
    if (!open || !owner) {setLoading(false); return () => controller.abort();}
    setLoading(true);
    const timer = window.setTimeout(() => {void fetchFileSuggestions({projectId: owner.projectId, threadId: owner.threadId, q: query, limit: 20}, controller.signal).then(value => {
      if (generation === request.current && !controller.signal.aborted) {
        if (!value.enabled) {flagOff.current = ownerKey; setDismissed(signature); setLoading(false); return;}
        setResponse({key: `${ownerKey}:${query}`, value}); setLoading(false);
      }
    }).catch(cause => {if (generation === request.current && !controller.signal.aborted) {setError(cause instanceof Error ? cause.message : 'Files could not load.'); setLoading(false);}});}, 80);
    return () => {controller.abort(); window.clearTimeout(timer); request.current++;};
  }, [open, query, ownerKey, owner, reload, signature]);
  const choose = async (item: Item) => {
    const element = input.current;
    if (!element || disabled) return;
    const current = mentionToken(element.value, element.selectionStart, element.selectionEnd); if (!current) return;
    close(); setError('');
    try {
      if (element.value !== draft) return;
      const replacement = replaceMentionToken(element.value, current, item.path); onDraft(replacement.text);
      await new Promise<void>(resolve => requestAnimationFrame(() => {if (element.isConnected) {element.focus(); element.setSelectionRange(replacement.caret, replacement.caret);} resolve();}));
      onSelect(item.path);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'The file could not be mentioned.');}
  };
  useImperativeHandle(ref, () => ({open, keyDown(event) {
    if (!open || isComposing(event)) return false;
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(); return true;}
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (items.length) {const index = items.findIndex(item => item.path === selected?.path); setActive(items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].path);}
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); if (selected) void choose(selected); return true;}
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); return true;}
    return false;
  }}));
  useEffect(() => {
    if (open && selected) content.current?.ownerDocument.getElementById(id + '-' + selected.path)?.scrollIntoView({block: 'nearest'});
    const element = input.current; if (!element || !open) return;
    element.setAttribute('aria-controls', id); element.setAttribute('aria-autocomplete', 'list');
    if (selected) element.setAttribute('aria-activedescendant', id + '-' + selected.path); else element.removeAttribute('aria-activedescendant');
    return () => {element.removeAttribute('aria-controls'); element.removeAttribute('aria-autocomplete'); element.removeAttribute('aria-activedescendant');};
  }, [open, selected?.path, id, input]);
  return <>
    <Popover anchor={input} contentRef={content} open={open} width={600} height={Math.min(352, Math.max(110, items.length * 42 + 44))} preferredSide="above" align="start" onDismiss={close} className="composer-command-popover composer-mention-popover">
      <div id={id} role="listbox" aria-label="Project files" className="composer-command-list">
        {items.map(item => <div key={item.path} id={id + '-' + item.path} role="option" aria-selected={selected?.path === item.path} className="composer-command-option" onPointerMove={() => setActive(item.path)} onPointerDown={event => event.preventDefault()} onClick={() => void choose(item)}>
          <FileText size={13} aria-hidden="true"/><span className="composer-command-name">{item.name}</span><span className="composer-command-description">{item.directory}</span>
        </div>)}
      </div>
      {loading && <div role="status" className="composer-command-status"><LoaderCircle size={13} className="spinning"/>Searching files…</div>}
      {error ? <ErrorState className="composer-command-status" message={error} retryLabel="Retry" onRetry={() => {setReload(value => value + 1);}}/> : null}
      {!loading && !error && !owner && <div role="status" className="composer-command-status"><Search size={14}/>Connect a project to mention files.</div>}
      {!loading && !error && owner && page && !items.length && <div role="status" className="composer-command-status"><Search size={14}/>No matching files</div>}
      {!loading && !error && Boolean(items.length) && <div role="status" className="composer-command-status">{page && !page.complete ? 'Showing first results; keep typing to narrow' : `${items.length} file${items.length === 1 ? '' : 's'}`}</div>}
      <div className="composer-command-hint" aria-hidden="true">↑ ↓ Navigate <span>Enter Select · Esc Close</span></div>
    </Popover>
    {!open && error && <div role="status" className="composer-command-error">{error}<button type="button" aria-label="Dismiss mention error" onClick={() => setError('')}><X size={13}/></button></div>}
  </>;
}
