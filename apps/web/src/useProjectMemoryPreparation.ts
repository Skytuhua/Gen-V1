import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import type {ContextMemoryRecall} from './ContextInspector';
import {MemoryPreparationController, memoryRequestKey, type MemoryRequestInput} from './project-memory-preparation';

export function useProjectMemoryPreparation(input: MemoryRequestInput | undefined, open: boolean, disabled = false) {
  const controller = useMemo(() => new MemoryPreparationController(), []), key = memoryRequestKey(input);
  const current = useRef({input, disabled});
  useLayoutEffect(() => {current.current = {input, disabled};});
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useLayoutEffect(() => {controller.bind(current.current.input);}, [controller, key]);
  useEffect(() => {
    const {input, disabled} = current.current, prepared = controller.snapshot();
    // Reopening an unchanged draft must retain its exclusions and any pending
    // or failed exclusion. Only an explicit refresh replaces that preparation.
    const retainDraft = input?.prompt && (prepared.view || prepared.pending || prepared.blocked || prepared.error);
    if (open && input && (!disabled || !input.prompt) && !retainDraft) void controller.inspect(input);
  }, [controller, open, key]);
  useEffect(() => () => controller.dispose(), [controller]);
  const refresh = useCallback(() => {if (current.current.input && !current.current.disabled) void controller.inspect(current.current.input);}, [controller]);
  const requestContextId = useCallback((submission?: Pick<MemoryRequestInput, 'prompt' | 'modelId' | 'thinkingLevel'>) => controller.requestContextId(current.current.input ? {...current.current.input, ...submission} : undefined), [controller]);
  const owned = state.key === key ? state : undefined, view = owned?.view;
  const memoryRecall: ContextMemoryRecall | undefined = view ? {...view.scope, requestId: view.requestId, contextGeneration: view.contextGeneration, recall: view.recall, items: view.items, injectedBytes: view.injectedBytes,
    exclusionAdapter: {requestId: view.requestId, contextGeneration: view.contextGeneration, phase: view.phase, disabled: disabled || Boolean(owned?.blocked), exclude: async revision => {if (current.current.disabled) throw Error('This request is being sent. Its exclusions cannot be changed.'); await controller.exclude(revision);}},
  } : undefined;
  return {memoryRecall, pending: Boolean(owned?.pending), error: owned?.error ?? '', blocked: Boolean(owned?.pending || owned?.blocked), refresh, requestContextId};
}
