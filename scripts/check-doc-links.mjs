// Checks links in git-tracked Markdown: root *.md plus docs/**, minus the provenance
// trees docs/implementation/** and docs/review-evidence/**. Relative paths and heading
// anchors are verified offline from the index; --external also requests http(s) targets.
// A link into a gitignored path points at local harness evidence no checkout contains,
// so it is counted as skipped rather than failed (--verbose lists it). Comment blocks,
// code fences and inline code are examples, not links, and stay unchecked.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const included = /^(?:[^/]+|docs\/.+)\.md$/i;
const excluded = ['docs/implementation/', 'docs/review-evidence/'];
const movedRepository = /^https?:\/\/(?:www\.)?github\.com\/Skytuhua\/Gen-V1(?:[/?#]|$)/i;
const unroutableHost = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|(?:[\w-]+\.)*(?:example|invalid|test|localhost)|example\.(?:com|org|net))$/i;
const committedLineRange = /^L\d+(?:C\d+)?(?:-L\d+(?:C\d+)?)?$/;
const external = process.argv.includes('--external'), verbose = process.argv.includes('--verbose');

function git(args, input) {
  const result = spawnSync('git', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}
const tracked = git(['ls-files', '-z']).stdout.split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const directories = new Set(tracked.flatMap(path => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
const files = tracked.filter(path => included.test(path) && !excluded.some(prefix => path.startsWith(prefix)));

const blank = text => text.replace(/[^\n]/g, ' ');
const readable = source => {
  let fence = '';
  return source.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, blank).split('\n').map(line => {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line), close = opener && !line.slice(line.indexOf(opener[1]) + opener[1].length).trim();
    if (fence) { if (close && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = ''; return ''; }
    if (opener) { fence = opener[1]; return ''; }
    return line.replace(/(`+)(.+?)\1/g, (span, ticks, body) => ticks + blank(body) + ticks);
  }).join('\n');
};
// GitHub's heading slugs: lowercase, punctuation dropped, spaces hyphenated, duplicates suffixed.
const slug = heading => heading.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
const anchors = new Map();
const anchorsOf = path => {
  if (anchors.has(path)) return anchors.get(path);
  const text = readable(readFileSync(path, 'utf8')), seen = new Map(), found = new Set();
  const headings = [
    ...text.matchAll(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/gm),
    ...text.matchAll(/^ {0,3}(\S.*)\n {0,3}(?:=+|-+)[ \t]*$/gm),
  ];
  for (const [, heading] of headings) {
    const base = slug(heading), repeats = seen.get(base) ?? 0;
    seen.set(base, repeats + 1);
    found.add(repeats ? base + '-' + repeats : base);
  }
  for (const [, , anchor] of text.matchAll(/<a\s[^>]*?\b(?:name|id)=["']([^"']+)["']/gi)) found.add(anchor.toLowerCase());
  anchors.set(path, found);
  return found;
};
const linksIn = text => [
  ...text.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]+>|(?:[^\s()]|\([^\s()]*\))+)/g),
  ...text.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]+>|\S+)/gm),
  ...text.matchAll(/<(https?:\/\/[^>\s]+)>/g),
  ...text.matchAll(/<(?:a|img|source|video)\s[^>]*?\b(?:href|src)=["']([^"']+)["']/gi),
].map(match => ({ target: match[1].replace(/^<|>$/g, '').replace(/&amp;/g, '&'), line: text.slice(0, match.index).split('\n').length }));
const decoded = value => { try { return decodeURIComponent(value); } catch { return value; } };

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
    if (!anchorsOf(resolved).has(decoded(fragment).toLowerCase())) report(failures, file, line, target, 'no heading or anchor "#' + fragment + '" in ' + resolved);
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

if (external) {
  const request = (url, method) => fetch(url, {
    method, redirect: 'follow', signal: AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'gen-v1-doc-link-check', accept: '*/*' },
  });
  const probe = async url => {
    let outcome;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 1_000 * attempt));
      try {
        let response = await request(url, 'HEAD');
        if (response.status >= 400) response = await request(url, 'GET');
        if (response.status < 400) return null;
        const transient = response.status >= 500 || response.status === 429;
        outcome = { reason: 'HTTP ' + response.status, dead: response.status === 404 || response.status === 410 };
        if (!transient) return outcome;
      } catch (error) {
        const code = error.cause?.code ?? error.name;
        outcome = { reason: 'request failed (' + code + ')', dead: code === 'ENOTFOUND' };
      }
    }
    return outcome;
  };
  const queue = [...urls];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let entry; (entry = queue.shift());) {
      const [url, locations] = entry, outcome = await probe(url);
      for (const { file, line, target } of locations) {
        if (outcome) report(outcome.dead ? failures : warnings, file, line, target, outcome.dead ? outcome.reason : outcome.reason + ' (not treated as dead)');
      }
    }
  }));
}

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
