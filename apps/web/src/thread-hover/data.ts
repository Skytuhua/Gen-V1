import {hoverScopeKey, scopedThreadHoverFacts, type ThreadHoverFacts, type ThreadHoverScope} from './facts';

export type ThreadHoverLoad<Target = unknown> = (scope: ThreadHoverScope, signal: AbortSignal) => Promise<ThreadHoverFacts<Target>>;
export type ThreadHoverDataState<Target = unknown> = {status: 'idle'}
  | {status: 'loading' | 'error'; scope: ThreadHoverScope}
  | {status: 'ready'; scope: ThreadHoverScope; facts: ThreadHoverFacts<Target>};

export function createThreadHoverCache<Target = unknown>() {
  const entries = new Map<string, ThreadHoverFacts<Target>>();
  return {
    get: (scope: ThreadHoverScope) => entries.get(hoverScopeKey(scope)),
    set(facts: ThreadHoverFacts<Target>) {
      const owner = hoverScopeKey({...facts.scope, revision: ''});
      for (const [key, entry] of entries) if (hoverScopeKey({...entry.scope, revision: ''}) === owner) entries.delete(key);
      entries.set(hoverScopeKey(facts.scope), scopedThreadHoverFacts(facts));
      if (entries.size > 32) entries.delete(entries.keys().next().value!);
    },
    clear: () => entries.clear(),
    get size() {return entries.size;},
  };
}
export type ThreadHoverCache<Target = unknown> = ReturnType<typeof createThreadHoverCache<Target>>;

export function createThreadHoverDataController<Target = unknown>({load, cache = createThreadHoverCache<Target>(), onChange}: {
  load: ThreadHoverLoad<Target>; cache?: ThreadHoverCache<Target>; onChange: (state: ThreadHoverDataState<Target>) => void;
}) {
  let generation = 0, pending: AbortController | null = null;
  let state: ThreadHoverDataState<Target> = {status: 'idle'};
  const publish = (next: ThreadHoverDataState<Target>) => {state = next; onChange(next);};
  const cancel = () => {generation++; pending?.abort(); pending = null;};
  return {
    getState: () => state,
    activate(input: ThreadHoverScope) {
      cancel();
      const scope = {...input, authority: {...input.authority}}, captured = generation, key = hoverScopeKey(scope);
      const cached = cache.get(scope);
      if (cached) {publish({status: 'ready', scope, facts: cached}); return;}
      const controller = new AbortController(); pending = controller;
      publish({status: 'loading', scope});
      const current = () => generation === captured && !controller.signal.aborted;
      void (async () => {
        try {
          const facts = await load(scope, controller.signal);
          if (!current()) return;
          if (hoverScopeKey(facts.scope) !== key) throw new Error('Hover metadata changed scope.');
          const checked = scopedThreadHoverFacts(facts); cache.set(checked);
          publish({status: 'ready', scope, facts: checked});
        } catch {
          if (current()) publish({status: 'error', scope});
        } finally {if (pending === controller) pending = null;}
      })();
    },
    deactivate() {cancel(); publish({status: 'idle'});},
  };
}
