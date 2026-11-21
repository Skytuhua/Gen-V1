/** Trailing in-flow action group for eligible assistant rows: Read aloud before Copy. */
import { CopyButton } from './CopyButton';
import { ReadAloudButton } from './ReadAloudButton.tsx';

export function MessageActions({ threadId, messageId, text, live, active }: {
  threadId: string; messageId: string; text: string; live: boolean; active: boolean;
}) {
  return <div className="message-actions">
    <ReadAloudButton threadId={threadId} messageId={messageId} text={text} live={live} active={active}/>
    <CopyButton text={text} label="Copy message"/>
  </div>;
}
