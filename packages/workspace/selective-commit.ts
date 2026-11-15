import { randomUUID } from "node:crypto";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { HarnessError } from "../contracts/index.ts";
import { readBoundFile } from "../core/file-access.ts";
import {
  selectiveCommitV1Schema,
  type CheckpointScope,
  type SelectiveCommitHunk,
  type SelectiveCommitV1,
} from "../contracts/workspace-checkpoints.ts";
import { sha256hex, type EditJournal } from "./edit-journal.ts";
import type { ProjectTools, WorkspaceBinding } from "./tools.ts";

// M08 hunk-exact selective commit. A preview builds candidate hunks from the
// proven pre/post images (git diff HEAD in the attested managed worktree) and
// labels each hunk with the journal's attribution. A commit copies nothing
// through the shared index: it reads HEAD into a private temporary index,
// applies only the approved hunk bodies, writes the tree and the commit
// object, verifies the commit, and only then advances the branch with a
// compare-and-swap update-ref. If the commit object exists but the ref/index
// outcome is uncertain, the record carries observedCommit — never a blind
// retry, never `git add -A`/`commit -a`/`reset --hard`.

export type HunkAttribution = "proven" | "process-window" | "unattributed";

export interface SelectiveCandidate {
  path: string;
  index: number;
  digest: string;
  patch: string;
  attribution: HunkAttribution;
  requiresExplicitSelection: boolean;
}

export interface SelectivePreview {
  repositoryIdentity: string;
  managedWorktreeId: string;
  branch: string;
  expectedHead: string;
  candidates: SelectiveCandidate[];
}

export interface SelectiveCommitResult {
  record: SelectiveCommitV1;
  applied: boolean;
  head: string;
}

const SELECTIVE_COMMIT_KIND = "workspaceSelectiveCommit" as const;

interface FileSection {
  path: string;
  header: string;
  hunks: string[];
  // Digest of the live worktree bytes, for journal attribution. Null when the
  // file is unreadable or exceeds the capture bound — never proven then.
  postDigest?: string | null;
}

// Split a single-file unified diff into its header (diff/index/---/+++ lines)
// and hunk bodies. Hunks are independent on the preimage, so any subset of a
// file's hunks applies cleanly to the same preimage.
const splitFileDiff = (patch: string, path: string): FileSection => {
  const hunks: string[] = [];
  let headerEnd = 0, cursor = -1;
  for (let at = patch.indexOf("@@"); at !== -1; at = patch.indexOf("@@", at + 1)) {
    if (at > 0 && patch[at - 1] !== "\n") continue;
    if (cursor === -1) {
      headerEnd = at;
    } else {
      hunks.push(patch.slice(cursor, at));
    }
    cursor = at;
  }
  if (cursor === -1) return { path, header: patch, hunks: [] };
  hunks.push(patch.slice(cursor));
  return { path, header: patch.slice(0, headerEnd), hunks };
};

const newFilePatch = (path: string, text: string): FileSection => {
  const lines = text.split("\n");
  const count = text.endsWith("\n") ? lines.length - 1 : lines.length;
  const body = lines.slice(0, count).map((line) => "+" + line);
  if (!text.endsWith("\n")) body.push("\\ No newline at end of file");
  const hunks = `@@ -0,0 +1,${count} @@\n${body.join("\n")}\n`;
  return {
    path,
    header: `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/${path}\n`,
    hunks: [hunks],
  };
};

const repositoryIdentity = (binding: WorkspaceBinding) =>
  sha256hex(JSON.stringify(["repository", binding.commonDirectory, binding.commonDirectoryIdentity.dev, binding.commonDirectoryIdentity.ino]));

export class SelectiveCommitService {
  constructor(private readonly projects: ProjectTools, private readonly journal?: EditJournal) {}

  private async candidates(
    git: (args: string[], environment?: NodeJS.ProcessEnv) => Promise<string>,
    worktree: string,
    scope: CheckpointScope | undefined,
  ): Promise<FileSection[]> {
    const names = (await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]))
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const name = entry.slice(3);
        // Porcelain renames list "old -> new" as one operand; commit the new path.
        return name.includes(" -> ") ? name.slice(name.indexOf(" -> ") + 4) : name;
      })
      .filter((name) => name.split("/").at(-1) !== ".harness-directory-guard")
      .slice(0, 200);
    const sections: FileSection[] = [];
    for (const raw of names) {
      const path = raw.replace(/^"(.*)"$/, "$1");
      const status = (await git(["status", "--porcelain=v1", "--", path])).slice(0, 2);
      if (status === "??") {
        const bytes = await readBoundFile(join(worktree, path), 8 * 1024 * 1024 + 1).catch(() => null);
        if (bytes === null || bytes.includes(0) || bytes.length > 8 * 1024 * 1024) continue;
        let text: string;
        try {
          // A synthesized patch must carry the file's exact bytes; lossy
          // decoding would commit replacement characters instead. ignoreBOM
          // keeps a leading BOM as U+FEFF so it survives the re-encode.
          text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          continue;
        }
        sections.push({ ...newFilePatch(path, text), postDigest: sha256hex(bytes) });
        continue;
      }
      const patch = await git(["diff", "--full-index", "--no-ext-diff", "--no-textconv", "HEAD", "--", path]);
      if (!patch) continue;
      const post = await readBoundFile(join(worktree, path), 8 * 1024 * 1024 + 1).catch(() => null);
      sections.push({ ...splitFileDiff(patch, path), postDigest: post && post.length <= 8 * 1024 * 1024 ? sha256hex(post) : null });
    }
    void scope;
    return sections;
  }

  private attributionFor(scope: CheckpointScope | undefined, path: string, postDigest: string | null): { attribution: HunkAttribution; requiresExplicitSelection: boolean } {
    const attribution = this.journal && scope ? this.journal.hunkAttribution(scope, path, postDigest) : "unattributed";
    return { attribution, requiresExplicitSelection: attribution !== "proven" };
  }

  async preview(projectId: string, threadId: string, scope?: CheckpointScope): Promise<SelectivePreview> {
    return this.projects.managedWorktree(projectId, threadId, async ({ git, binding }) => {
      const head = (await git(["rev-parse", "HEAD"])).trim();
      const branch = (await git(["branch", "--show-current"])).trim();
      if (!/^[0-9a-f]{40}$/.test(head) || !branch) throw new HarnessError("CAPABILITY_DENIED", "A managed working copy needs a branch and a commit head.");
      const sections = await this.candidates(git, binding.path, scope);
      const candidates: SelectiveCandidate[] = [];
      for (const section of sections) {
        section.hunks.forEach((patch, index) => {
          candidates.push({ path: section.path, index, digest: sha256hex(section.header + patch), patch: section.header + patch, ...this.attributionFor(scope, section.path, section.postDigest ?? null) });
        });
      }
      return { repositoryIdentity: repositoryIdentity(binding), managedWorktreeId: binding.id, branch, expectedHead: head, candidates };
    });
  }

  async commit(
    projectId: string,
    threadId: string,
    input: { expectedHead: string; selectedHunks: SelectiveCommitHunk[]; message: string; approvalId: string; author?: { name: string; email: string }; scope?: CheckpointScope },
  ): Promise<SelectiveCommitResult> {
    const selected = selectiveCommitV1Schema.shape.selectedHunks.parse(input.selectedHunks);
    if (!selected.length) throw new HarnessError("INVALID_INPUT", "Select at least one hunk.");
    const message = input.message?.trim();
    if (!message || message.length > 4000) throw new HarnessError("INVALID_INPUT", "A commit message is required.");
    return this.projects.managedWorktree(projectId, threadId, async ({ git, binding, signal }) => {
      const head = (await git(["rev-parse", "HEAD"])).trim();
      const branch = (await git(["branch", "--show-current"])).trim();
      if (head !== input.expectedHead || !branch) throw new HarnessError("REVISION_CHANGED", "The reviewed head changed. Refresh the selection before committing.");

      // Rebuild the candidate set from live proven images and match the approved selection exactly.
      const sections = await this.candidates(git, binding.path, input.scope);
      const sectionsByPath = new Map(sections.map((section) => [section.path, section]));
      const patchParts: string[] = [];
      for (const hunk of [...selected].sort((a, b) => (a.path === b.path ? a.index - b.index : a.path.localeCompare(b.path)))) {
        const section = sectionsByPath.get(hunk.path);
        if (!section || !section.hunks[hunk.index]) throw new HarnessError("REVISION_CHANGED", `The change at ${hunk.path} is no longer available. Refresh before committing.`);
        const patch = section.header + section.hunks[hunk.index];
        if (sha256hex(patch) !== hunk.digest) throw new HarnessError("REVISION_CHANGED", `The hunk at ${hunk.path} changed. Refresh before committing.`);
        patchParts.push(patch);
      }

      const privateIndex = join(binding.gitDirectory, `gen-selective-${randomUUID()}.index`);
      const patchFile = join(binding.gitDirectory, `gen-selective-${randomUUID()}.patch`);
      const file = await open(patchFile, "wx", 0o600);
      try {
        await file.writeFile(patchParts.join(""));
      } finally {
        await file.close();
      }
      const environment = { GIT_INDEX_FILE: privateIndex };
      let commitOid: string | undefined;
      let applied = false;
      let record: SelectiveCommitV1;
      try {
        await git(["read-tree", input.expectedHead], environment);
        // Recheck selected preimage blobs: the private index must contain the
        // exact expectedHead blob for every selected path.
        for (const path of new Set(selected.map((hunk) => hunk.path))) {
          const staged = await git(["ls-files", "-s", "--", path], environment);
          const expected = await git(["ls-tree", input.expectedHead, "--", path]);
          const stagedOid = /^[0-9]+ ([0-9a-f]{40}) /.exec(staged)?.[1] ?? null;
          const expectedOid = /^[0-9]+ [a-z]+ ([0-9a-f]{40})/.exec(expected)?.[1] ?? null;
          if (stagedOid !== expectedOid) throw new HarnessError("REVISION_CHANGED", `The preimage for ${path} changed. Refresh before committing.`);
        }
        await git(["apply", "--cached", "--whitespace=nowarn", "--verbose", patchFile], environment);
        const tree = (await git(["write-tree"], environment)).trim();
        const author = input.author ?? { name: "Gen V1", email: "gen-v1@localhost" };
        commitOid = (
          await git(
            ["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit-tree", tree, "-p", input.expectedHead, "-m", message],
            environment,
          )
        ).trim();
        // Verify the commit before touching the branch: its tree must be the
        // tree the private index produced and its changed-path set must equal
        // the approved selection.
        const verifyTree = (await git(["rev-parse", `${commitOid}^{tree}`])).trim();
        if (verifyTree !== tree) throw new HarnessError("CAPABILITY_DENIED", "The selective commit does not match its verified tree.");
        const touched = (await git(["diff-tree", "-r", "--name-only", "--no-commit-id", commitOid])).split("\n").filter(Boolean).sort();
        const approved = [...new Set(selected.map((hunk) => hunk.path))].sort();
        if (JSON.stringify(touched) !== JSON.stringify(approved))
          throw new HarnessError("CAPABILITY_DENIED", "The selective commit touched files outside the approved selection.");
        const privateIndexDigest = sha256hex(await readBoundFile(privateIndex, 64 * 1024 * 1024));
        // Compare-and-swap the branch reference; a stale ref refuses the update.
        await git(["update-ref", `refs/heads/${branch}`, commitOid, input.expectedHead]);
        applied = true;
        // Reconcile only the managed worktree index to the new head. The
        // worktree bytes already equal the committed postimage for the selected
        // hunks; unselected changes stay unstaged.
        await git(["read-tree", "HEAD"]);
        record = selectiveCommitV1Schema.parse({
          version: 1,
          repositoryIdentity: repositoryIdentity(binding),
          managedWorktreeId: binding.id,
          expectedHead: input.expectedHead,
          privateIndexDigest,
          selectedHunks: selected,
          messageDigest: sha256hex(message),
          approvalId: input.approvalId,
          observedCommit: commitOid,
        });
      } catch (error) {
        if (commitOid) {
          // Uncertain outcome: the commit object exists but the ref/index
          // result is unknown. Record the SHA and the actual observed head.
          const observedHead = (await git(["rev-parse", branch]).catch(() => "")).trim();
          record = selectiveCommitV1Schema.parse({
            version: 1,
            repositoryIdentity: repositoryIdentity(binding),
            managedWorktreeId: binding.id,
            expectedHead: input.expectedHead,
            privateIndexDigest: sha256hex(JSON.stringify([commitOid, observedHead])),
            selectedHunks: selected,
            messageDigest: sha256hex(message),
            approvalId: input.approvalId,
            observedCommit: commitOid,
          });
          this.storeRecord(binding, commitOid, { ...record, uncertain: true, observedHead });
          throw new HarnessError("REVISION_CHANGED", `The selective commit ${commitOid} was created but the branch update was uncertain. Inspect ${branch} at ${observedHead || "an unknown head"} before retrying.`, { observedCommit: commitOid });
        }
        throw error;
      } finally {
        await rm(privateIndex, { force: true }).catch(() => {});
        await rm(patchFile, { force: true }).catch(() => {});
      }
      this.storeRecord(binding, commitOid!, record);
      void signal;
      return { record, applied, head: commitOid! };
    });
  }

  records(bindingId: string): (SelectiveCommitV1 & { uncertain?: boolean; observedHead?: string })[] {
    return this.projects.store.all<SelectiveCommitV1 & { managedWorktreeId: string; uncertain?: boolean; observedHead?: string }>(SELECTIVE_COMMIT_KIND).filter((entry) => entry.managedWorktreeId === bindingId);
  }

  private storeRecord(binding: WorkspaceBinding, commitOid: string, record: SelectiveCommitV1 & { uncertain?: boolean; observedHead?: string }): void {
    this.projects.store.internal("workspace.selective-commit.recorded", binding.threadId, () => {
      this.projects.store.put(SELECTIVE_COMMIT_KIND, commitOid, binding.threadId, record);
    });
  }
}
