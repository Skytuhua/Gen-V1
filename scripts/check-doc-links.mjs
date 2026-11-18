// Checks links in every git-tracked *.md in the repository, minus the provenance trees
// docs/implementation/** and docs/review-evidence/ and the retained upstream bytes under
// third-party/**. Relative paths and heading anchors are verified offline from the index;
// --external also requests http(s) targets. A link into a gitignored path points at local
// harness evidence no checkout contains, so it is counted as skipped rather than failed
// (--verbose lists it). Comment blocks, code fences, indented code blocks and inline code
// are examples, not links, and stay unchecked.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const excluded = ['docs/implementation/', 'docs/review-evidence/', 'third-party/'];
const movedRepository = /^https?:\/\/(?:www\.)?github\.com\/Skytuhua\/Gen-V1(?:\.git)?(?:[/?#]|$)/i;
// Loopback, private, link-local and reserved documentation addresses never get requested.
const unroutableHost = /^(?:localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[(?:::1|::ffff:|fc|fd|fe80)[^\]]*\]|(?:[\w-]+\.)*(?:example|invalid|test|localhost)|example\.(?:com|org|net))$/i;
const committedLineRange = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;
const listMarker = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const external = process.argv.includes('--external'), verbose = process.argv.includes('--verbose');

const blank = text => text.replace(/[^\n]/g, ' ');
export const readable = (source, keepInlineCode = false, onRawHtml = () => {}) => {
  let fence = '', fenceDepth = 0, comment = false, commentBlock = false, indented = false, blankBefore = true, listed = false;
  const removeComments = line => {
    let cursor = 0, cleaned = '';
    const hide = text => keepInlineCode ? '' : blank(text);
    while (cursor < line.length) {
      if (comment) {
        const end = line.indexOf('-->', cursor);
        const next = end < 0 ? line.length : end + 3;
        cleaned += hide(line.slice(cursor, next));
        cursor = next;
        if (end >= 0) comment = false;
        continue;
      }
      // Inline examples consume their delimiters before HTML comments can open.
      const next = /(`+)(.+?)\1|<!--/g;
      next.lastIndex = cursor;
      const match = next.exec(line);
      if (!match) return cleaned + line.slice(cursor);
      cleaned += line.slice(cursor, match.index);
      cursor = next.lastIndex;
      if (match[0] === '<!--') { cleaned += hide(match[0]); comment = true; }
      else cleaned += match[0];
    }
    return cleaned;
  };
  return source.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const prefix = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] ?? '';
    const depth = prefix.split('>').length - 1;
    const quoted = line.slice(prefix.length), opener = /^ {0,3}(`{3,}|~{3,})/.exec(quoted);
    if (fence && depth < fenceDepth) { fence = ''; blankBefore = true; }
    if (fence) {
      if (depth === fenceDepth && opener && !quoted.slice(opener[0].length).trim() && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = '';
      return '';
    }
    // Markdown stops parsing this HTML block at the end of the closing line.
    // Raw tags after the terminator still render, but Markdown headings do not.
    if (keepInlineCode && (commentBlock || (!comment && /^ {0,3}<!--/.test(quoted)))) {
      const end = quoted.indexOf('-->');
      commentBlock = end < 0;
      if (!commentBlock) {
        onRawHtml(removeComments(quoted.slice(end + 3)));
        // A subsequent raw comment on the same line still owns its closing line.
        commentBlock = comment;
        comment = false;
      }
      indented = false;
      blankBefore = !commentBlock;
      return '';
    }
    if (!comment && opener) { fence = opener[1]; fenceDepth = depth; indented = blankBefore = false; return ''; }
    if (!comment && listMarker.test(line)) listed = true;
    else if (!comment && /^\S/.test(line)) listed = false;
    if (!comment && !listed && /^(?: {4}|\t)/.test(line) && (blankBefore || indented)) { indented = true; blankBefore = false; return ''; }
    line = removeComments(line);
    if (line.trim()) indented = false;
    blankBefore = !line.trim();
    return keepInlineCode ? line : line.replace(/(`+)(.+?)\1/g, (span, ticks, body) => ticks + blank(body) + ticks);
  }).join('\n');
};
// GitHub's heading slugs: lowercase, punctuation dropped, spaces hyphenated, collisions
// counted up until the candidate is free, so Foo, Foo, Foo-1 becomes foo, foo-1, foo-1-1.
const slug = heading => heading.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
export const anchorsOf = source => {
  // Inline code contributes its text to a real heading; block examples do not.
  const found = new Set(), counters = new Map(), rawHtml = [];
  const text = readable(source, true, suffix => rawHtml.push(suffix));
  const headings = [
    ...text.matchAll(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm),
    ...text.matchAll(/^ {0,3}(\S.*)\n {0,3}(?:=+|-+)[ \t]*$/gm),
  ];
  for (const [, heading] of headings) {
    const base = slug(heading);
    let candidate = base, count = counters.get(base) ?? 0;
    while (found.has(candidate)) { count += 1; candidate = base + '-' + count; }
    counters.set(base, count);
    found.add(candidate);
  }
  for (const [, anchor] of [text, ...rawHtml].join('\n').matchAll(/<a\s[^>]*?\b(?:name|id)=["']([^"']+)["']/gi)) found.add(anchor.toLowerCase());
  return found;
};
// Every ](target) is read, so a linked image `[![alt](image)](page)` yields both targets.
export const linksIn = text => [
  ...text.matchAll(/\]\(\s*(<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)/g),
  ...text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|\S+)/gm),
  ...text.matchAll(/<(https?:\/\/[^>\s]+)>/g),
  ...text.matchAll(/<(?:a|img|source|video)\s[^>]*?\b(?:href|src)=["']([^"']+)["']/gi),
].map(match => ({ target: match[1].replace(/^<|>$/g, '').replace(/&amp;/g, '&'), line: text.slice(0, match.index).split('\n').length }));
const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };

// A missing host, 404 or 410 is dead; anything else that fails is a warning. Redirects are
// followed by hand, so a public link cannot steer the runner at a private address.
export async function probeUrl(url, { request = fetch, retryDelayMs = 1_000 } = {}) {
  const statusOf = async method => {
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const response = await request(current, { method, redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'gen-v1-doc-link-check', accept: '*/*' } });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) return { status: response.status };
      current = new URL(location, current).href;
      if (unroutableHost.test(new URL(current).hostname)) return { reason: 'redirects to a non-public address' };
    }
    return { reason: 'redirect loop' };
  };
  let outcome;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
    try {
      let { status, reason } = await statusOf('HEAD');
      if (!reason && status >= 400) ({ status, reason } = await statusOf('GET'));
      if (reason) return { reason, dead: false };
      if (status < 400) return null;
      outcome = { reason: 'HTTP ' + status, dead: status === 404 || status === 410 };
      if (status < 500 && status !== 429) return outcome;
    } catch (error) {
      const code = error.cause?.code ?? error.name;
      outcome = { reason: 'request failed (' + code + ')', dead: code === 'ENOTFOUND' };
    }
  }
  return outcome;
}

function main() {
  const git = (args, input) => {
    const result = spawnSync('git', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    if (result.error) throw result.error;
    return result;
  };
  const tracked = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const trackedSet = new Set(tracked);
  const directories = new Set(tracked.flatMap(path => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
  const files = tracked.filter(path => /\.md$/i.test(path) && !excluded.some(prefix => path.startsWith(prefix)));
  const cache = new Map();

  const failures = [], warnings = [];
  const report = (list, file, line, target, reason) => list.push({ file, line, target, reason });
  const urls = new Map(), uncommitted = [];
  let checked = 0;
  for (const file of files) {
    const text = readable(readFileSync(file, 'utf8'));
    for (const { target, line } of linksIn(text)) {
      checked++;
      if (/^https?:\/\//i.test(target)) {
        if (movedRepository.test(target)) { report(failures, file, line, target, 'stale repository URL: the repository moved to skytuhua-org/Gen-V1'); continue; }
        let host;
        try { host = new URL(target).hostname; } catch { report(failures, file, line, target, 'not a valid URL'); continue; }
        if (unroutableHost.test(host)) continue;
        const url = target.split('#')[0];
        urls.set(url, [...urls.get(url) ?? [], { file, line, target }]);
        continue;
      }
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
      const [location, fragment = ''] = target.split('#'), path = decoded(location.split('?')[0]);
      const resolved = path ? posix.normalize(path.startsWith('/') ? path.slice(1) : posix.join(posix.dirname(file), path)).replace(/\/$/, '') : file;
      if (resolved.startsWith('../') || resolved === '..') { report(failures, file, line, target, 'path leaves the repository'); continue; }
      if (!trackedSet.has(resolved) && !directories.has(resolved)) { uncommitted.push({ file, line, target, resolved }); continue; }
      if (!fragment || !trackedSet.has(resolved) || !/\.md$/i.test(resolved) || committedLineRange.test(fragment)) continue;
      if (!cache.has(resolved)) {
        try { cache.set(resolved, anchorsOf(readFileSync(resolved, 'utf8'))); }
        catch (error) { report(failures, file, line, target, 'cannot read anchors in ' + resolved + ': ' + error.message); continue; }
      }
      if (!cache.get(resolved).has(decoded(fragment).toLowerCase())) report(failures, file, line, target, 'no heading or anchor "#' + fragment + '" in ' + resolved);
    }
  }
  const ignored = new Set();
  if (uncommitted.length) {
    const local = git(['check-ignore', '--stdin', '-z'], uncommitted.map(entry => entry.resolved).join('\0') + '\0').stdout.split('\0').filter(Boolean);
    for (const entry of uncommitted) {
      if (local.includes(entry.resolved)) ignored.add(entry);
      else report(failures, entry.file, entry.line, entry.target, 'no tracked file or directory at ' + entry.resolved);
    }
  }
  const settle = async () => {
    if (!external) return;
    const queue = [...urls];
    await Promise.all(Array.from({ length: 8 }, async () => {
      for (let entry; (entry = queue.shift());) {
        const [url, locations] = entry, outcome = await probeUrl(url);
        for (const { file, line, target } of locations) {
          if (outcome) report(outcome.dead ? failures : warnings, file, line, target, outcome.dead ? outcome.reason : outcome.reason + ' (not treated as dead)');
        }
      }
    }));
  };
  return settle().then(() => {
    const print = (list, label) => {
      for (const { file, line, target, reason } of list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) console.error(label + ' ' + file + ':' + line + ' ' + target + '\n    ' + reason);
    };
    if (verbose) for (const { file, line, target } of ignored) console.error('skip  ' + file + ':' + line + ' ' + target + '\n    not committed; the target is gitignored local evidence');
    print(warnings, 'warn ');
    print(failures, 'error');
    console.log(files.length + ' Markdown files, ' + checked + ' links' + (external ? ', ' + urls.size + ' external URLs requested' : ' (external URLs skipped; pass --external)')
      + ': ' + failures.length + ' broken, ' + warnings.length + ' warning' + (warnings.length === 1 ? '' : 's')
      + (ignored.size ? ', ' + ignored.size + ' skipped as uncommitted' + (verbose ? '' : ' (pass --verbose to list)') : ''));
    if (failures.length) process.exit(1);
  });
}

if (import.meta.main) await main();
