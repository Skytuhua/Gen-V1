import {useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref, type RefObject} from 'react';
import {Bot, LoaderCircle, Search, X} from 'lucide-react';
import {Popover} from '../../../packages/ui-shell/Popover';
import {isComposing} from '../../../packages/ui-shell/list-navigation';
import type {SkillCatalogEntry, SkillCatalogPage} from '../../../packages/contracts/skill-catalog';
import {commandToken, replaceCommandToken, type SkillBinding} from './composer-commands';
import {getSkillCatalog, mergeSkillCatalogPages} from './skill-catalog-api';
import './composer-commands.css';
import {ErrorState} from '../../../packages/ui-shell/Feedback';

export interface ComposerCommandsHandle {keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean}
interface Props {
  ref?: Ref<ComposerCommandsHandle>; input: RefObject<HTMLTextAreaElement | null>; draft: string;
  threadId?: string; projectId?: string; disabled?: boolean;
  onDraft(text: string): void;
  onModel(): void | Promise<void>; onMode(mode: 'plan' | 'build'): void | Promise<void>;
}
type Builtin = {id: 'model' | 'plan' | 'default'; description: string};
const builtins: Builtin[] = [{id: 'model', description: 'Choose a model'}, {id: 'plan', description: 'Switch to Plan'}, {id: 'default', description: 'Switch to Build'}];
type Option = {id: string; builtin: Builtin} | {id: string; skill: SkillCatalogEntry};
const available = (option: Option) => 'builtin' in option;
const availabilityLabel = {disabled: 'Disabled', disconnected: 'Disconnected', unsupported: 'Unavailable', denied: 'No access', changed: 'Changed', limit: 'Limit reached', invalid: 'Unavailable', missing: 'Not installed'};
const reason = (item: SkillCatalogEntry) => item.availability.status === 'unavailable' ? availabilityLabel[item.availability.reason] : '';

/** Readable catalog metadata does not imply that the runtime admits selected skills. */
export function ComposerCommands({ref, input, draft, threadId, projectId, disabled = false, onDraft, onModel, onMode}: Props) {
  const id = useId(), content = useRef<HTMLDivElement>(null), request = useRef(0), loadingMore = useRef(false);
  const [position, setPosition] = useState({caret: 0, end: 0, focused: false, composing: false});
  const [dismissed, setDismissed] = useState(''), [captured, setCaptured] = useState<{key: string; page: SkillCatalogPage} | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [active, setActive] = useState('model'), [reload, setReload] = useState(0);
  const token = position.focused && !position.composing && !disabled ? commandToken(draft, position.caret, position.end) : null;
  const signature = token ? `${threadId ?? ''}:${projectId ?? ''}:${token.start}:${token.end}:${token.query}` : '';
  const open = Boolean(token && signature !== dismissed), query = token?.query.replace(/^skill:/i, '') ?? '';
  const catalogKey = JSON.stringify([threadId, projectId, query]), page = captured?.key === catalogKey ? captured.page : null;
  const unavailableSources = page?.sources.filter(source => source.availability.status === 'unavailable') ?? [];
  const options: Option[] = [...(token?.query.toLowerCase().startsWith('skill:') ? [] : builtins.filter(item => item.id.includes(query.toLowerCase())).map(builtin => ({id: builtin.id, builtin}))), ...(page?.skills ?? []).map(skill => ({id: skill.id, skill}))];
  const selected = options.find(option => option.id === active && available(option)) ?? options.find(available);
  const close = () => setDismissed(signature);
  useEffect(() => {setDismissed(previous => previous && previous !== signature ? '' : previous);}, [signature]);
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
  useEffect(() => {
    const generation = ++request.current, controller = new AbortController(); loadingMore.current = false; setCaptured(null); setError('');
    if (!open) {setLoading(false); return () => controller.abort();}
    setLoading(true);
    const timer = window.setTimeout(() => {void getSkillCatalog({query, limit: 50, ...(threadId ? {threadId} : {}), ...(projectId ? {projectId} : {})}, controller.signal).then(value => {
      if (generation === request.current && !controller.signal.aborted) {setCaptured({key: catalogKey, page: value}); setLoading(false);}
    }).catch(cause => {if (generation === request.current && !controller.signal.aborted) {setError(cause instanceof Error ? cause.message : 'Skills unavailable.'); setLoading(false);}});}, 150);
    return () => {controller.abort(); window.clearTimeout(timer); request.current++;};
  }, [open, query, threadId, projectId, reload]);
  const loadMore = async () => {
    if (!page?.nextCursor || loadingMore.current) return;
    loadingMore.current = true; setLoading(true); setError(''); const generation = request.current;
    try {
      const next = await getSkillCatalog({query, limit: 50, cursor: page.nextCursor, ...(threadId ? {threadId} : {}), ...(projectId ? {projectId} : {})});
      if (generation === request.current) setCaptured({key: catalogKey, page: mergeSkillCatalogPages(page, next)});
    } catch (cause) {if (generation === request.current) setError(cause instanceof Error ? cause.message : 'More skills unavailable.');}
    finally {if (generation === request.current) {loadingMore.current = false; setLoading(false);}}
  };
  const choose = async (option: Option) => {
    const element = input.current;
    if (!element || disabled || !available(option)) return;
    const current = commandToken(element.value, element.selectionStart, element.selectionEnd); if (!current) return;
    close(); setError('');
    try {
      if (element.value !== draft) return;
      const replacement = replaceCommandToken(element.value, current); onDraft(replacement.text);
      await new Promise<void>(resolve => requestAnimationFrame(() => {if (element.isConnected) {element.focus(); element.setSelectionRange(replacement.caret, replacement.caret);} resolve();}));
      if (option.builtin.id === 'model') await onModel(); else await onMode(option.builtin.id === 'plan' ? 'plan' : 'build');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'The command could not finish.');}
  };
  useImperativeHandle(ref, () => ({keyDown(event) {
    if (!open || isComposing(event)) return false;
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); close(); return true;}
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); const selectable = options.filter(available), index = selectable.findIndex(option => option.id === selected?.id);
      if (selectable.length) setActive(selectable[(index + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length].id);
      if (event.key === 'ArrowDown' && index === selectable.length - 1 && page?.nextCursor) void loadMore();
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && selected) {event.preventDefault(); void choose(selected); return true;}
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {event.preventDefault(); return true;}
    return false;
  }}));
  useEffect(() => {
    if (open && selected) content.current?.ownerDocument.getElementById(id + '-' + selected.id)?.scrollIntoView({block: 'nearest'});
    const element = input.current; if (!element || !open) return;
    element.setAttribute('aria-controls', id); element.setAttribute('aria-autocomplete', 'list');
    if (selected) element.setAttribute('aria-activedescendant', id + '-' + selected.id); else element.removeAttribute('aria-activedescendant');
    return () => {element.removeAttribute('aria-controls'); element.removeAttribute('aria-autocomplete'); element.removeAttribute('aria-activedescendant');};
  }, [open, selected?.id, id, input]);
  return <>
    <Popover anchor={input} contentRef={content} open={open} width={600} height={Math.min(352, Math.max(110, options.length * 42 + 44))} preferredSide="above" align="start" onDismiss={close} className="composer-command-popover">
      <div id={id} role="listbox" aria-label="Commands and skills" className="composer-command-list" onScroll={event => {const list = event.currentTarget; if (list.scrollHeight - list.scrollTop - list.clientHeight < 80) void loadMore();}}>
        {options.map(option => <div key={option.id} id={id + '-' + option.id} role="option" aria-selected={selected?.id === option.id} aria-disabled={!available(option)} className="composer-command-option" onPointerMove={() => {if (available(option)) setActive(option.id);}} onPointerDown={event => event.preventDefault()} onClick={() => void choose(option)}>
          {'builtin' in option ? <><span className="composer-command-name">/{option.builtin.id}</span><span className="composer-command-description">{option.builtin.description}</span></> : <><span className="composer-command-name">/skill:{option.skill.name}</span><span className="composer-command-description" title={option.skill.description}>{reason(option.skill) || option.skill.description}</span><span className="composer-command-source">{page?.sources.find(source => source.id === option.skill.sourceId)?.label}</span></>}
        </div>)}
      </div>
      {Boolean(page?.skills.length) && <div role="status" aria-label="Skill selection unavailable" className="composer-command-status">Skill selection is unavailable for this runtime. You can still browse installed skills.</div>}
      {loading && <div role="status" className="composer-command-status"><LoaderCircle size={13} className="spinning"/>Loading skills…</div>}
      {error ? <ErrorState className="composer-command-status" message={error} retryLabel="Reload" onRetry={() => {setReload(value => value + 1);}}/> : !loading && !options.length && !unavailableSources.length && <div role="status" className="composer-command-status"><Search size={14}/>No commands or skills found</div>}
      {Boolean(unavailableSources.length) && <div role="status" aria-label="Unavailable skill sources" className="composer-command-unavailable">{unavailableSources.map(source => <div key={source.id}><span>{source.label}</span><span>{source.availability.status === 'unavailable' ? availabilityLabel[source.availability.reason] : ''}</span></div>)}</div>}
      {!loading && page?.nextCursor && <button type="button" className="composer-command-more" onPointerDown={event => event.preventDefault()} onClick={() => void loadMore()}>Load more skills</button>}
      <div className="composer-command-hint" aria-hidden="true">↑ ↓ Navigate <span>Enter Select · Esc Close</span></div>
    </Popover>
    {!open && error && <div role="alert" className="composer-command-error">{error}<button type="button" aria-label="Dismiss command error" onClick={() => setError('')}><X size={13}/></button></div>}
  </>;
}
export function ComposerSkillBindings({bindings, onRemove, disabled = false, retry = false}: {bindings: readonly SkillBinding[]; onRemove(id: string): void; disabled?: boolean; retry?: boolean}) {
  if (!bindings.length && !retry) return null;
  return <>
    {Boolean(bindings.length) && <p role="status" aria-label="Selected skills unavailable" className="composer-command-status">Selected skills are unavailable. Remove them to send a new message without skills.</p>}
    {retry && <p role="status" className="composer-command-status">Retry keeps the original message and skill selections, including selections removed from this draft.</p>}
    {Boolean(bindings.length) && <div role="group" aria-label="Selected skills" className="composer-skill-bindings">{bindings.map(binding => <span className="composer-skill-chip" key={binding.id}><Bot size={13} aria-hidden="true"/><span title={binding.source}>{binding.name}</span><button type="button" aria-label={`Remove skill ${binding.name}`} disabled={disabled} onClick={() => onRemove(binding.id)}><X size={12}/></button></span>)}</div>}
  </>;
}
