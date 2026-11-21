// Shared "save generated image into the writable project grant" logic (issue #1311 T06).
// Used by the `image.save` core command (user path) and the `image_save_prepare` -> `image.save`
// prepared operation (agent path). Path rules come from DESIGN 4: stay inside the project
// root, no hidden segments, extension matching the source image format.
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { HarnessError } from "../contracts/index.ts";

export const IMAGE_SAVE_EXTENSIONS: Record<string, readonly string[]> = {
  png: [".png"],
  jpeg: [".jpg", ".jpeg"],
  webp: [".webp"],
};

export function imageSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Validates a project-root-relative save target and returns it with `/` separators.
// `format` is the detected source image format ("png" | "jpeg" | "webp").
export function validateImageSavePath(relativePath: string, format: string): string {
  const path = relativePath.trim();
  if (!path || path.length > 1024 || path.includes("\0")) throw new HarnessError("INVALID_INPUT", "An image save path is required");
  if (/^[a-zA-Z]:[\\/]|^[\\/]/.test(path) || path.includes(":")) throw new HarnessError("CAPABILITY_DENIED", "Save paths must stay inside the project");
  const segments = path.split(/[\\/]+/);
  if (segments.some(segment => !segment || segment === "." || segment === "..")) throw new HarnessError("CAPABILITY_DENIED", "Save paths must not contain '.' or '..' segments");
  if (segments.some(segment => segment.startsWith("."))) throw new HarnessError("CAPABILITY_DENIED", "Save paths must not contain hidden segments");
  const extensions = IMAGE_SAVE_EXTENSIONS[format];
  if (!extensions) throw new HarnessError("INVALID_INPUT", `Saving ${format} images is not supported`);
  const leaf = segments[segments.length - 1];
  if (!extensions.includes(extname(leaf).toLowerCase())) throw new HarnessError("INVALID_INPUT", `The file name must end with ${extensions.join(" or ")} to match the image`);
  return segments.join("/");
}

// For "copy" mode: name.png -> name-2.png, name-3.png, ...
export function nextCopyName(relativePath: string, exists: (candidate: string) => boolean): string {
  const extension = extname(relativePath);
  const stem = relativePath.slice(0, relativePath.length - extension.length);
  for (let index = 2; index <= 999; index++) {
    const candidate = `${stem}-${index}${extension}`;
    if (!exists(candidate)) return candidate;
  }
  throw new HarnessError("PATH_CONFLICT", "No free copy name is available");
}

export interface WriteImageOptions {
  mode: "fail" | "overwrite" | "copy";
  expectedSha256?: string;
  signal?: AbortSignal;
}

export interface WrittenImage {
  path: string;
  sha256: string;
  bytes: number;
}

// Writes `bytes` to an already grant-resolved absolute `filename`. "fail" uses wx;
// "overwrite" requires the current file's sha256 to match `expectedSha256`.
export async function writeImageFile(filename: string, bytes: Uint8Array, options: WriteImageOptions): Promise<WrittenImage> {
  options.signal?.throwIfAborted();
  await mkdir(dirname(filename), { recursive: true });
  if (options.mode === "overwrite") {
    let current: Buffer;
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw new HarnessError("INVALID_RESOURCE", "Overwrite target must be a regular file");
      current = await readFile(filename);
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HarnessError("PATH_CONFLICT", "No file exists at that path to overwrite");
      throw error;
    }
    if (imageSha256(current) !== options.expectedSha256) throw new HarnessError("PRECONDITION_FAILED", "The file on disk changed; re-read it before overwriting");
    await writeFile(filename, bytes);
  } else {
    const file = await open(filename, "wx").catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        // Surface the existing hash so a caller can retry as an authorized overwrite.
        const sha256 = await readFile(filename).then(imageSha256).catch(() => undefined);
        throw new HarnessError("PATH_CONFLICT", "A file already exists at that path", { sha256 });
      }
      throw error;
    });
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
  }
  return { path: filename, sha256: imageSha256(bytes), bytes: bytes.length };
}