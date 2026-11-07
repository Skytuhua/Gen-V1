import {useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {closedConversation, conversationSelectionKey, createConversationReader, type ConversationReadState, type ConversationSelection} from './reader';

/** Keep this hook in the workspace owner; hiding chat must not unmount its reader. */
export function useScopedConversation(selection: ConversationSelection | null, onState?: (state: ConversationReadState) => void) {
  const notify = useRef(onState); notify.current = onState;
  const reader = useMemo(() => createConversationReader({onState: state => notify.current?.(state)}), []);
  const key = conversationSelectionKey(selection);
  useLayoutEffect(() => {
    void reader.select(selection);
    return () => reader.close();
  }, [reader, key]);
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot, () => closedConversation);
  // Navigation renders are fenced before effects can close the previous owner.
  const state: ConversationReadState = snapshot.selectionKey === key ? snapshot : {...closedConversation, selectionKey: key, phase: selection ? 'loading' : 'closed', pending: Boolean(selection)};
  return {reader, state};
}
export type ScopedConversation = ReturnType<typeof useScopedConversation>;
