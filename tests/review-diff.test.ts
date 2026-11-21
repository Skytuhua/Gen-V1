import { describe, expect, it } from 'vitest';
import { commentableLines, parseUnifiedDiff, relocateAnchor } from '../apps/web/src/review-diff.ts';
import type { ReviewCommentAnchor } from '../packages/contracts/review-comments.ts';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -38,6 +38,8 @@ function x() {
 line one
 line two
+added one
+added two
 line three
-line old
+line new
 line four
@@ -60,3 +62,4 @@ function y() {
 keep
-line removed
+line added
 tail
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+first
+second
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/old.ts
+++ /dev/null
@@ -5,3 +0,0 @@
-gone one
-gone two
-gone three
diff --git a/src/bin.dat b/src/bin.dat
index 5555555..6666666 100644
Binary files a/src/bin.dat and b/src/bin.dat differ
diff --git a/src/moved.ts b/src/renamed.ts
similarity index 90%
rename from src/moved.ts
rename to src/renamed.ts
@@ -1,2 +1,2 @@
 same line
-tweak
+tweaked
`;

const anchor = (over: Partial<ReviewCommentAnchor> = {}): ReviewCommentAnchor => ({ path: 'src/a.ts', side: 'new', startLine: 40, endLine: 41, scope: 'worktree', head: 'a'.repeat(40), revision: 'r1', hunkHeader: '@@ -38,6 +38,8 @@', excerpt: 'added one\nadded two', excerptTruncated: false, ...over });

describe('parseUnifiedDiff (#1288 T06)', () => {
  it('parses files, hunks and numbered lines', () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files.map(f => f.path)).toEqual(['src/a.ts', 'src/new.ts', 'src/old.ts', 'src/bin.dat', 'src/renamed.ts']);
    const a = files[0];
    expect(a.hunks).toHaveLength(2);
    expect(a.hunks[0]).toMatchObject({ oldStart: 38, newStart: 38, newCount: 8 });
    const added = a.hunks[0].lines.filter(l => l.kind === 'add');
    expect(added.map(l => [l.newLine, l.text])).toEqual([[40, 'added one'], [41, 'added two'], [43, 'line new']]);
    expect(a.hunks[0].lines.find(l => l.kind === 'del')).toMatchObject({ oldLine: 41, text: 'line old' });
  });
  it('handles new/deleted/binary/renamed files', () => {
    const files = parseUnifiedDiff(DIFF);
    expect(files[1]).toMatchObject({ path: 'src/new.ts', added: true });
    expect(files[2]).toMatchObject({ path: 'src/old.ts', oldPath: 'src/old.ts', deleted: true });
    expect(files[3].binary).toBe(true);
    expect(files[4]).toMatchObject({ path: 'src/renamed.ts', oldPath: 'src/moved.ts' });
    expect(commentableLines(files[1], 'new').map(r => r.line)).toEqual([1, 2]);
    expect(commentableLines(files[2], 'old').map(r => r.line)).toEqual([5, 6, 7]);
  });
  it('returns empty for non-diff input and tolerates truncated tails', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('random\nnot a diff')).toEqual([]);
    const partial = DIFF.slice(0, DIFF.indexOf('tail'));
    expect(parseUnifiedDiff(partial)[0].hunks.length).toBeGreaterThan(0);
  });
});

describe('relocateAnchor (#1288 T06)', () => {
  it('finds the same lines at their recorded position', () => {
    const files = parseUnifiedDiff(DIFF);
    expect(relocateAnchor(anchor(), files)).toMatchObject({ startLine: 40, endLine: 41 });
  });
  it('relocates when lines move', () => {
    const moved = DIFF.replace(' line one\n', ' line one\n+shifted a\n+shifted b\n');
    const files = parseUnifiedDiff(moved);
    const relocated = relocateAnchor(anchor(), files);
    expect(relocated).toMatchObject({ startLine: 42, endLine: 43 });
  });
  it('anchors old-side comments against deletion lines', () => {
    const files = parseUnifiedDiff(DIFF);
    const relocated = relocateAnchor(anchor({ path: 'src/a.ts', side: 'old', startLine: 41, endLine: 41, excerpt: 'line old' }), files);
    expect(relocated).toMatchObject({ startLine: 41, endLine: 41 });
  });
  it('returns null when the excerpt is gone or the file vanished', () => {
    const files = parseUnifiedDiff(DIFF);
    expect(relocateAnchor(anchor({ excerpt: 'never existed' }), files)).toBeNull();
    expect(relocateAnchor(anchor({ path: 'src/missing.ts' }), files)).toBeNull();
  });
  it('prefers the match nearest the recorded start line', () => {
    const files = parseUnifiedDiff(`diff --git a/dup.ts b/dup.ts
--- a/dup.ts
+++ b/dup.ts
@@ -1,3 +1,4 @@
 repeat
+new bit
 repeat
 end
`);
    const relocated = relocateAnchor(anchor({ path: 'dup.ts', startLine: 3, endLine: 3, excerpt: 'repeat' }), files);
    expect(relocated).toMatchObject({ startLine: 3 });
  });
});
