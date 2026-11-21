import { createRoot } from 'react-dom/client';
import { MessageActions } from '../../../apps/web/src/MessageActions.tsx';
import { ReadAloudRateControl, ReadAloudVoiceControl } from '../../../apps/web/src/ReadAloudSettings.tsx';
import { resetReadAloudPreferencesForTest } from '../../../apps/web/src/read-aloud-preferences.ts';
import '../../../apps/web/src/styles.css';

type FakeUtterance = {
  text: string; voice: unknown; lang: string; rate: number;
  onstart: (() => void) | null; onend: (() => void) | null; onerror: (() => void) | null;
};
type Voice = { voiceURI: string; name: string; lang: string; default: boolean; localService: boolean };
type Log = {
  spoken: FakeUtterance[]; calls: string[]; voices: Voice[];
  emit(index: number, event: 'start' | 'end' | 'error'): void;
  setVoices(voices: Voice[]): void; reset(): void;
};
declare global {
  interface Window { readAloud: Log }
}

const defaults: Voice[] = [
  { voiceURI: 'fake-a', name: 'Ava Local', lang: 'en-US', default: true, localService: true },
  { voiceURI: 'fake-b', name: 'Ben Local', lang: 'en-GB', default: false, localService: true },
  { voiceURI: 'fake-remote', name: 'Cloud Remote', lang: 'en-US', default: false, localService: false },
];

const state: Log = {
  spoken: [], calls: [], voices: [...defaults],
  emit(index, event) {
    const utterance = state.spoken[index];
    if (!utterance) throw new Error(`no utterance ${index}`);
    if (event === 'start') utterance.onstart?.();
    if (event === 'end') utterance.onend?.();
    if (event === 'error') utterance.onerror?.();
  },
  setVoices(voices) {
    state.voices = voices;
    listeners.forEach(listener => listener());
  },
  reset() {
    state.spoken.length = 0; state.calls.length = 0; state.voices = [...defaults];
    listeners.forEach(listener => listener());
    try { localStorage.clear(); } catch { /* ignore */ }
    resetReadAloudPreferencesForTest();
  },
};
const listeners = new Set<() => void>();
window.readAloud = state;

class FakeUtteranceImpl implements FakeUtterance {
  voice: unknown = null;
  lang = '';
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtteranceImpl, configurable: true });
Object.defineProperty(window, 'speechSynthesis', { value: {
  getVoices: () => state.voices,
  speak: (u: FakeUtterance) => { state.calls.push('speak'); state.spoken.push(u); },
  cancel: () => { state.calls.push('cancel'); },
  pause: () => { state.calls.push('pause'); },
  resume: () => { state.calls.push('resume'); },
  addEventListener: (type: string, listener: () => void) => { if (type === 'voiceschanged') listeners.add(listener); },
  removeEventListener: (type: string, listener: () => void) => { if (type === 'voiceschanged') listeners.delete(listener); },
}, configurable: true });

const reply = '## Summary\n\n- Use **Settings** and [Help](https://example.com/help) to listen.\n\n```ts\nconst skipped = true;\n```\n\nA second paragraph, with more.';
const longReply = Array.from({ length: 60 }, (_, index) => `Sentence ${index} keeps going.`).join(' ');

function Fixture() {
  return <main>
    <div className="message message-assistant" data-case="settled">
      <div className="message-content"><p>{reply}</p>
        <MessageActions threadId="t1" messageId="m-settled" text={reply} live={false} active={true}/>
      </div>
    </div>
    <div className="message message-assistant" data-case="live">
      <div className="message-content"><p>{reply}</p>
        <MessageActions threadId="t1" messageId="m-live" text={reply} live={true} active={true}/>
      </div>
    </div>
    <div className="message message-assistant" data-case="code-only">
      <div className="message-content"><p>code only reply</p>
        <MessageActions threadId="t1" messageId="m-code" text={'```ts\nonly code\n```'} live={false} active={true}/>
      </div>
    </div>
    <div className="message message-assistant" data-case="long">
      <div className="message-content"><p>long reply</p>
        <MessageActions threadId="t1" messageId="m-long" text={longReply} live={false} active={true}/>
      </div>
    </div>
    <div className="message message-user" data-case="user"><div className="message-content"><p>user row</p></div></div>
    <section data-case="settings"><h2>Settings</h2>
      <ReadAloudVoiceControl/>
      <ReadAloudRateControl/>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture/>);
