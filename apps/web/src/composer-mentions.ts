import type {FileMentionV1} from '../../../packages/contracts/file-mentions';

export interface MentionToken {start: number; end: number; query: string}

/** `@` token at a collapsed caret: at start or after whitespace, bare or
 *  double-quoted (`@"path with space`). `a@b` is an e-mail, not a token. */
export function mentionToken(text: string, caret: number, selectionEnd = caret): MentionToken | null {
  if (selectionEnd !== caret || caret < 0 || caret > text.length) return null;
  const match = /(?:^|\s)(@(?:"[^"\n]*|[^\s@"]*))$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const raw = match[1];
  const query = raw.slice(1);
  return {start: caret - raw.length, end: caret, query: query.startsWith('"') ? query.slice(1) : query};
}

/** Literal text a sent message uses for `path` — quoted only when it has to be. */
export function mentionLiteral(path: string): string {
  return /\s/u.test(path) ? '@"' + path + '"' : '@' + path;
}

/** Replace the open token with the chosen path plus a trailing space. */
export function replaceMentionToken(text: string, token: MentionToken, path: string) {
  if (/["\r\n]/u.test(path)) throw Error('Paths with quotes or newlines cannot be mentioned.');
  if (token.start < 0 || token.end > text.length || !/^@(?:"[^"\n]*|[^\s@"]*)$/u.test(text.slice(token.start, token.end))) throw Error('The mention token changed.');
  const inserted = mentionLiteral(path) + ' ';
  return {text: text.slice(0, token.start) + inserted + text.slice(token.end), caret: token.start + inserted.length};
}

/** Mentions whose literal still appears in `text` followed by whitespace or the
 *  end of the message — deleted or partially edited tokens drop out. */
export function activeMentions(text: string, mentions: readonly FileMentionV1[]): FileMentionV1[] {
  return mentions.filter(mention => {
    const literal = mentionLiteral(mention.path);
    let index = -1;
    while ((index = text.indexOf(literal, index + 1)) !== -1) {
      const after = text[index + literal.length];
      if (after === undefined || /\s/u.test(after)) return true;
    }
    return false;
  });
}
