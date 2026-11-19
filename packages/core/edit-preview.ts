import { createHash, randomUUID } from "node:crypto";
import { HarnessError } from "../contracts/index.ts";
import {
  CODE_INTELLIGENCE_LIMITS,
  editPreviewV1Schema,
  type EditPreviewFile,
  type EditPreviewV1,
} from "../contracts/code-intelligence.ts";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export interface StreamedEditTarget {
  path: string;
  /** Proposed postimage bytes as text. Never executed. */
  proposedContent: string;
}

interface Preview {
  previewId: string;
  owner: string;
  schemaDigest: string;
  buffered: Buffer[];
  bufferedBytes: number;
  finalArgumentsDigest: string | null;
  /** True once `validateFinal` confirmed the final arguments match the seal. */
  validated: boolean;
  targetFiles: EditPreviewFile[];
  state: EditPreviewV1["state"];
}

export type ParsedFinalArguments = { targets: StreamedEditTarget[]; digest: string };

/** Pure parser for incremental tool arguments. Accepts raw argument text
 * (JSON or JSON-fragment streams) and extracts proposed file targets. It never
 * executes anything: partially parsed arguments cannot produce a target, and
 * no returned value authorizes a write. */
export function parseFinalArguments(raw: string): ParsedFinalArguments {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HarnessError("INVALID_INPUT", "The final tool arguments are not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new HarnessError("INVALID_INPUT", "The final tool arguments are malformed.");
  const body = parsed as Record<string, unknown>;
  const entries = Array.isArray(body.files) ? body.files : Array.isArray(body.edits) ? body.edits : null;
  if (!entries || !entries.length) throw new HarnessError("INVALID_INPUT", "The final tool arguments name no file targets.");
  const targets: StreamedEditTarget[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new HarnessError("INVALID_INPUT", "A proposed edit target is malformed.");
    const record = entry as Record<string, unknown>;
    const path = record.path;
    const content = record.content ?? record.newText;
    if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0"))
      throw new HarnessError("INVALID_INPUT", "A proposed edit target has an invalid path.");
    if (typeof content !== "string" || Buffer.byteLength(content) > CODE_INTELLIGENCE_LIMITS.previewBufferBytes)
      throw new HarnessError("RESOURCE_LIMIT", "A proposed edit target exceeds the preview byte limit.");
    targets.push({ path, proposedContent: content });
  }
  return { targets, digest: sha(raw) };
}

/** Owner-scoped registry of streamed edit previews. Open previews are bounded
 * per run and in aggregate bytes, and are discarded on cancellation. A preview
 * becomes READY_UNAPPLIED only after complete validated arguments; a changed
 * preview or mismatched final arguments invalidate it and any prior approval. */
export class EditPreviewRegistry {
  private readonly previews = new Map<string, Preview>();
  constructor(private readonly limits = CODE_INTELLIGENCE_LIMITS) {}

  /** Begin a streaming preview. `owner` scopes every later operation. */
  begin(owner: string, schemaDigest: string): EditPreviewV1 {
    if (!/^[a-f0-9]{64}$/.test(schemaDigest)) throw new HarnessError("INVALID_INPUT", "The tool schema digest is invalid.");
    const open = [...this.previews.values()].filter(p => p.owner === owner && (p.state === "STREAMING_UNAPPLIED" || p.state === "READY_UNAPPLIED"));
    if (open.length >= this.limits.openPreviewsPerRun)
      throw new HarnessError("RESOURCE_LIMIT", "Too many open edit previews for this run.");
    const preview: Preview = {
      previewId: randomUUID(), owner, schemaDigest,
      buffered: [], bufferedBytes: 0,
      finalArgumentsDigest: null, validated: false, targetFiles: [], state: "STREAMING_UNAPPLIED",
    };
    this.previews.set(preview.previewId, preview);
    return this.view(preview);
  }

  private require(previewId: string, owner: string): Preview {
    const preview = this.previews.get(previewId);
    if (!preview || preview.owner !== owner) throw new HarnessError("NOT_FOUND", "The edit preview is unavailable.");
    return preview;
  }

  private aggregate(owner: string): number {
    let total = 0;
    for (const preview of this.previews.values()) if (preview.owner === owner && (preview.state === "STREAMING_UNAPPLIED" || preview.state === "READY_UNAPPLIED")) total += preview.bufferedBytes;
    return total;
  }

  /** Inert argument bytes exist only while a preview can still be sealed. */
  private release(preview: Preview): void {
    preview.buffered = [];
    preview.bufferedBytes = 0;
  }

  /** Append an incremental argument frame. Frames are inert text; a partial
   * frame never produces a write. */
  append(previewId: string, owner: string, chunk: string | Buffer): EditPreviewV1 {
    const preview = this.require(previewId, owner);
    if (preview.state !== "STREAMING_UNAPPLIED")
      throw new HarnessError("INVALID_INPUT", "The edit preview is no longer streaming.");
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    if (preview.bufferedBytes + bytes.length > this.limits.previewBufferBytes
      || this.aggregate(owner) + bytes.length > this.limits.previewAggregateBytes) {
      preview.state = "INVALID";
      this.release(preview);
      throw new HarnessError("RESOURCE_LIMIT", "The streamed edit preview exceeds its byte bound.");
    }
    preview.buffered.push(Buffer.from(bytes));
    preview.bufferedBytes += bytes.length;
    return this.view(preview);
  }

  /** Parse the complete accumulated arguments and bind proposed digests.
   * `beforeDigestFor` supplies the current preimage digest per path; a null
   * result marks that file's baseline unknown rather than guessing it. */
  seal(previewId: string, owner: string, beforeDigestFor: (path: string) => string | null): EditPreviewV1 {
    const preview = this.require(previewId, owner);
    if (preview.state !== "STREAMING_UNAPPLIED")
      throw new HarnessError("INVALID_INPUT", "The edit preview is no longer streaming.");
    try {
      const parsed = parseFinalArguments(Buffer.concat(preview.buffered).toString("utf8"));
      const candidate: Preview = {
        ...preview,
        finalArgumentsDigest: parsed.digest,
        targetFiles: parsed.targets.map(target => ({
          path: target.path,
          identity: null,
          beforeDigest: beforeDigestFor(target.path),
          proposedDigest: sha(target.proposedContent),
        })),
        state: "READY_UNAPPLIED",
      };
      const result = this.view(candidate);
      this.previews.set(previewId, candidate);
      return result;
    } catch (error) {
      // A failed final seal is terminal for this stream, not a partial result.
      preview.state = "INVALID";
      this.release(preview);
      throw error;
    }
  }

  /** Final arguments must match the digest the preview was sealed with. A
   * mismatch invalidates the preview; approval is rejected until a new
   * preview is built. */
  validateFinal(previewId: string, owner: string, finalArgumentsDigest: string): EditPreviewV1 {
    const preview = this.require(previewId, owner);
    if (preview.state !== "READY_UNAPPLIED")
      throw new HarnessError("INVALID_INPUT", "The edit preview is not awaiting validation.");
    if (preview.finalArgumentsDigest !== finalArgumentsDigest) {
      preview.state = "INVALID";
      this.release(preview);
      throw new HarnessError("PRECONDITION_FAILED", "The final tool arguments changed; rebuild the edit preview.");
    }
    preview.validated = true;
    return this.view(preview);
  }

  /** Mark the preview applied after the host's guarded write completed. A
   * changed preimage surfaces CONFLICT rather than a silent write. APPLIED is
   * only reachable through the approval gate: `validateFinal` must have
   * confirmed the final arguments before a settle can record success. */
  settle(previewId: string, owner: string, outcome: "APPLIED" | "CONFLICT"): EditPreviewV1 {
    const preview = this.require(previewId, owner);
    if (preview.state !== "READY_UNAPPLIED")
      throw new HarnessError("INVALID_INPUT", "The edit preview is not ready to apply.");
    if (outcome === "APPLIED" && !preview.validated)
      throw new HarnessError("PRECONDITION_FAILED", "An edit preview cannot be applied before its final arguments are validated.");
    preview.state = outcome;
    this.release(preview);
    return this.view(preview);
  }

  /** Cancellation discards the preview entirely. */
  discard(previewId: string, owner: string): void {
    const preview = this.require(previewId, owner);
    this.previews.delete(preview.previewId);
  }

  /** Discard every open preview of the owner (run cancellation). */
  discardOwner(owner: string): void {
    for (const [id, preview] of this.previews) if (preview.owner === owner) this.previews.delete(id);
  }

  get(previewId: string, owner: string): EditPreviewV1 | null {
    const preview = this.previews.get(previewId);
    return preview && preview.owner === owner ? this.view(preview) : null;
  }

  list(owner: string): EditPreviewV1[] {
    return [...this.previews.values()].filter(p => p.owner === owner).map(p => this.view(p));
  }

  private view(preview: Preview): EditPreviewV1 {
    return editPreviewV1Schema.parse({
      version: 1,
      previewId: preview.previewId,
      owner: preview.owner,
      schemaDigest: preview.schemaDigest,
      finalArgumentsDigest: preview.finalArgumentsDigest,
      targetFiles: preview.targetFiles.map(file => ({ ...file })),
      state: preview.state,
    });
  }
}

/** Precise edit precondition: a short anchor or hashline label is a locator,
 * never collision-resistant authorization. The anchor must match exactly once
 * in the given content; zero or repeated matches are rejected instead of
 * fuzzy-rewriting arbitrary code. */
export function locateAnchor(content: string, anchor: string): number {
  if (!anchor) throw new HarnessError("INVALID_INPUT", "An edit anchor must be nonempty.");
  const first = content.indexOf(anchor);
  if (first < 0) throw new HarnessError("PRECONDITION_FAILED", "The edit anchor was not found.");
  if (content.indexOf(anchor, first + 1) >= 0)
    throw new HarnessError("PRECONDITION_FAILED", "The edit anchor is ambiguous.");
  return first;
}

export function verifyEditPreimage(content: Buffer, expectedBeforeDigest: string): void {
  if (sha(content) !== expectedBeforeDigest)
    throw new HarnessError("PRECONDITION_FAILED", "The file changed before the edit was applied.");
}
