import type {SentFileMentionV1} from '../../../packages/contracts/file-mentions';

/** Transcript metadata for accepted @-mentions: paths and truncation flags only, never file text. */
export function MessageFileMentions({mentions}: {mentions: readonly SentFileMentionV1[]}) {
  if (!mentions.length) return null;
  return <ul className="message-file-mentions" aria-label="Mentioned files">{mentions.map(mention => <li key={mention.path}>{mention.path}{mention.truncated ? ' (truncated)' : ''}</li>)}</ul>;
}
