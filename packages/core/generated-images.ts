// Storage and validation for provider-generated images (issue #1311, plan DESIGN 4).
// `storeThreadAttachment` is the shared attachment write extracted from the
// `resource.upload` command so generated files and user uploads behave identically:
// `wx` semantics, idempotent-by-id re-stores, and a DUPLICATE_COMMAND on byte drift.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { HarnessError, type ResourceGrant } from "../contracts/index.ts";

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
export const GENERATED_IMAGE_MAX_DIMENSION = 4096;

export type GeneratedImageFormat = "png" | "jpeg" | "webp";

export interface ValidatedImage {
  format: GeneratedImageFormat;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

const ext: Record<GeneratedImageFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

const bytes = (b: Uint8Array, at: number, n: number) => b.subarray(at, at + n);
const ascii = (b: Uint8Array, at: number, n: number) => Buffer.from(bytes(b, at, n)).toString("latin1");
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const be32 = (b: Uint8Array, at: number) => (b[at] * 0x1000000) + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

function pngSize(b: Uint8Array): { width: number; height: number } | undefined {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !magic.every((v, i) => b[i] === v)) return undefined;
  // First chunk must be IHDR; width/height are the first 8 bytes of its data.
  if (be32(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return undefined;
  const width = be32(b, 16), height = be32(b, 20);
  if (!width || !height) return undefined;
  return { width, height };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return undefined;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) { at++; continue; }
    const marker = b[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = be16(b, at + 2);
    if (length < 2) return undefined;
    if (sof.has(marker)) {
      const height = be16(b, at + 5), width = be16(b, at + 7);
      if (!width || !height) return undefined;
      return { width, height };
    }
    at += 2 + length;
  }
  return undefined;
}

function webpSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return undefined;
  const kind = ascii(b, 12, 4);
  if (kind === "VP8X") {
    const width = le24(b, 24) + 1, height = le24(b, 27) + 1;
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (kind === "VP8 " && b.length >= 30) {
    // Lossy bitstream: signature 9d 01 2a then 14-bit little-endian dimensions.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    const width = (b[26] | (b[27] << 8)) & 0x3fff, height = (b[28] | (b[29] << 8)) & 0x3fff;
    if (!width || !height) return undefined;
    return { width, height };
  }
  if (kind === "VP8L" && b.length >= 25) {
    if (b[20] !== 0x2f) return undefined;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const width = (bits & 0x3fff) + 1, height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return undefined;
}

// Reject anything that is not a complete PNG, JPEG or WebP file, and anything
// over the attachment byte cap or the per-axis pixel cap. Only headers are
// parsed — full decode is the renderer's job.
export function validateImageBytes(input: Uint8Array): ValidatedImage {
  if (input.length > ATTACHMENT_MAX_BYTES) throw new HarnessError("INVALID_OUTPUT", "Generated image exceeds the 20 MiB attachment limit");
  const format: GeneratedImageFormat | undefined = pngSize(input) ? "png" : jpegSize(input) ? "jpeg" : webpSize(input) ? "webp" : undefined;
  const size = format === "png" ? pngSize(input) : format === "jpeg" ? jpegSize(input) : webpSize(input);
  if (!size || !format) throw new HarnessError("INVALID_OUTPUT", "Generated image is not a PNG, JPEG or WebP file");
  if (size.width > GENERATED_IMAGE_MAX_DIMENSION || size.height > GENERATED_IMAGE_MAX_DIMENSION) throw new HarnessError("INVALID_OUTPUT", "Generated image exceeds the 4096 pixel dimension limit");
  return { format, width: size.width, height: size.height, bytes: input.length, sha256: createHash("sha256").update(input).digest("hex") };
}

const safeName = (name: string) => basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_");

export interface ThreadAttachmentStore {
  dataDir: string;
  now?: () => string;
}

export interface StoredAttachment { grant: ResourceGrant; created: boolean }

// Write `<dataDir>/attachments/<threadId>/<fileName>` exclusively and build the
// matching read-only grant. An existing file with identical bytes is reused;
// different bytes under the same name is a duplicate submission.
async function writeThreadAttachment(
  store: ThreadAttachmentStore,
  threadId: string,
  fileName: string,
  label: string,
  data: Uint8Array,
  grantId: string,
  provenance?: ResourceGrant["provenance"],
): Promise<StoredAttachment> {
  if (data.length > ATTACHMENT_MAX_BYTES) throw new HarnessError("INVALID_INPUT", "Attachments are limited to 20 MiB");
  const folder = join(store.dataDir, "attachments", threadId);
  await mkdir(folder, { recursive: true });
  const path = join(folder, fileName);
  let created = true;
  try {
    await writeFile(path, data, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    created = false;
    if (!(await readFile(path)).equals(data)) throw new HarnessError("DUPLICATE_COMMAND", "Upload ID already has different content");
  }
  const grant: ResourceGrant = {
    id: grantId, threadId, path, label, kind: "attachment", writable: false,
    createdAt: (store.now ?? (() => new Date().toISOString()))(),
    ...(provenance ? { provenance } : {}),
  };
  return { grant, created };
}

// Shared by `resource.upload` (service) and `storeGeneratedImages`: keeps the
// original upload filename layout `<commandId>-<name>` unless `fileName` is set.
export async function storeThreadAttachment(
  store: ThreadAttachmentStore,
  threadId: string,
  commandId: string,
  name: string,
  data: Uint8Array,
  extra?: { id?: string; fileName?: string; provenance?: ResourceGrant["provenance"] },
): Promise<StoredAttachment> {
  const label = safeName(name);
  return writeThreadAttachment(store, threadId, extra?.fileName ?? `${commandId}-${label}`, label, data, extra?.id ?? commandId, extra?.provenance);
}

export interface GeneratedImageProvenance {
  model: string;
  promptSha256: string;
  size: string;
  quality: string;
  background: string;
  referenceIds: string[];
}

export interface StoredGeneratedImage {
  grant: ResourceGrant;
  image: ValidatedImage;
  created: boolean;
}

export interface StoreGeneratedImagesOptions {
  dataDir: string;
  threadId: string;
  generationId: string;
  images: Uint8Array[];
  provenance: GeneratedImageProvenance;
  signal?: AbortSignal;
  now?: () => string;
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new HarnessError("CANCELLED_RUN", "Image generation cancelled");
};

// Store every validated image as a read-only attachment grant. Files and grant
// ids are deterministic (`<generationId>-<index>`) so a repeated tool call with
// the same id returns the stored result; aborting removes files and grants that
// this call created.
export async function storeGeneratedImages(
  opts: StoreGeneratedImagesOptions,
  apply: (grant: ResourceGrant) => void = () => undefined,
  revert: (grantId: string) => void = () => undefined,
): Promise<StoredGeneratedImage[]> {
  const store: ThreadAttachmentStore = { dataDir: opts.dataDir, now: opts.now };
  throwIfAborted(opts.signal);
  const validated = opts.images.map(validateImageBytes);
  const written: { path: string; grantId: string }[] = [];
  const results: StoredGeneratedImage[] = [];
  try {
    for (const [index, image] of validated.entries()) {
      throwIfAborted(opts.signal);
      const fileName = `${opts.generationId}-${index}-generated.${ext[image.format]}`;
      const grantId = `${opts.generationId}-${index}`;
      const stored = await writeThreadAttachment(store, opts.threadId, fileName, fileName, opts.images[index], grantId, {
        kind: "generated-image",
        generationId: opts.generationId,
        index,
        model: opts.provenance.model,
        promptSha256: opts.provenance.promptSha256,
        size: opts.provenance.size,
        quality: opts.provenance.quality,
        background: opts.provenance.background,
        referenceIds: opts.provenance.referenceIds,
      });
      if (stored.created) written.push({ path: stored.grant.path, grantId });
      apply(stored.grant);
      results.push({ grant: stored.grant, image, created: stored.created });
    }
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    for (const { path, grantId } of written) {
      await rm(path, { force: true });
      revert(grantId);
    }
    throw error;
  }
  return results;
}
