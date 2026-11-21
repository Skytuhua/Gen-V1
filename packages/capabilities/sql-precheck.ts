// Read-only SQL precheck shared by every engine adapter (T03).
// Masks quoted literals, identifiers and comments, then requires a single
// statement whose first keyword is in the read-only allowlist.
const READ_ONLY_VERBS = new Set(['select', 'with', 'explain', 'show', 'describe', 'table', 'values']);

export type PrecheckResult = { ok: true; verb: string } | { ok: false; reason: string };

export function precheckReadOnlySql(sql: string): PrecheckResult {
  const masked = maskSql(sql);
  const trimmed = masked.trim();
  if (!trimmed) return { ok: false, reason: 'empty statement' };
  const match = /^([a-zA-Z]+)/.exec(trimmed);
  const verb = (match?.[1] ?? '').toLowerCase();
  if (!READ_ONLY_VERBS.has(verb)) return { ok: false, reason: `statement verb "${verb || 'unknown'}" is not read-only` };
  const rest = trimmed.slice(trimmed.length - 1) === ';' ? trimmed.slice(0, -1) : trimmed;
  if (rest.includes(';')) return { ok: false, reason: 'multiple statements are not allowed' };
  return { ok: true, verb };
}

// Replaces the contents of string literals, quoted identifiers and comments
// with spaces so top-level scanning never matches inside them. Handles
// 'single', "double", `backtick`, [bracket] and PostgreSQL $tag$ quotes.
export function maskSql(sql: string): string {
  let out = '', index = 0;
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  while (index < sql.length) {
    const ch = sql[index], two = sql.slice(index, index + 2);
    if (two === '--') {
      const end = sql.indexOf('\n', index);
      const stop = end === -1 ? sql.length : end;
      out += blank(sql.slice(index, stop)); index = stop; continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += blank(sql.slice(index, stop)); index = stop; continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
      if (tag) {
        const close = sql.indexOf(tag[0], index + tag[0].length);
        const stop = close === -1 ? sql.length : close + tag[0].length;
        out += blank(sql.slice(index, stop)); index = stop; continue;
      }
      out += ch; index++; continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = index + 1;
      let stop = sql.length;
      for (let cursor = end; cursor < sql.length; cursor++) {
        if (sql[cursor] === ch) {
          if (sql[cursor + 1] === ch) { cursor++; continue; }
          stop = cursor + 1; break;
        }
      }
      out += blank(sql.slice(index, stop)); index = stop; continue;
    }
    if (ch === '[') {
      const end = sql.indexOf(']', index + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += blank(sql.slice(index, stop)); index = stop; continue;
    }
    out += ch; index++;
  }
  return out;
}
