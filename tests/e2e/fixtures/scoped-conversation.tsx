import {createRoot} from 'react-dom/client';
import {StrictMode, useState} from 'react';
import {useScopedConversation} from '../../../apps/web/src/conversation-workspace/useScopedConversation';
import {ConversationPane} from '../../../apps/web/src/conversation-workspace/ConversationPane';
import type {ConversationReadState} from '../../../apps/web/src/conversation-workspace/reader';
import {scopedSelection} from '../../scoped-conversation-fixture';
import '../../../packages/ui-shell/controls.css';
import './scoped-conversation.css';

declare global {interface Window {scopedFixture: {poll: () => Promise<void>; states: {phase: string; epoch: number | null; status: string | null; threadId: string | null}[]; close: () => void; navigate: () => void}}}
const states: {phase: string; epoch: number | null; status: string | null; threadId: string | null}[] = [];
function Fixture() {
  const [hidden, hide] = useState(false), [open, setOpen] = useState(true), [epoch, setEpoch] = useState<number | null>(null);
  const [selection, setSelection] = useState(scopedSelection);
  const conversation = useScopedConversation(open ? selection : null, (state: ConversationReadState) => {states.push({phase: state.phase, epoch: state.context?.owner.epoch ?? null, status: state.context?.owner.status ?? null, threadId: state.context?.owner.threadId ?? null}); setEpoch(state.context?.owner.epoch ?? null);});
  window.scopedFixture = {poll: conversation.reader.poll, states, close: () => setOpen(false), navigate: () => setSelection({target: {...scopedSelection.target, threadId: 'second-owner'}, navigationKey: 'canonical-admission-2'})};
  return <main><p>Synthetic fixture · no provider/native acceptance</p><button onClick={() => hide(value => !value)}>Toggle chat</button><output aria-label="Parent epoch">{epoch ?? 'invalid'}</output><div className="fixture-pane"><ConversationPane conversation={conversation} hidden={hidden} renderComposer={() => <textarea aria-label="Supplied composer" defaultValue="Parent-owned draft"/>}/></div></main>;
}
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('strict')?<StrictMode><Fixture/></StrictMode>:<Fixture/>);
