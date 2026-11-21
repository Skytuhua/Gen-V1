import { constants } from 'node:fs';
import { lstat, open, opendir, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Sha256Hex } from '../contracts/hashing.ts';
import { secureDirectory } from '../runtime-official/manifest.ts';
import { MAX_TRACKED_RESULTS, RESULT_CAP_BYTES, type ContextResultStorage } from './context-results.ts';

const handlePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const boundedText = z.string().min(1).max(512);
const metadata = z.strictObject({
  handle: z.string().regex(handlePattern),
  owner: z.strictObject({ threadId: boundedText, workspaceId: boundedText, accountId: boundedText.nullable() }),
  sourceInvocationId: boundedText,
  digest: Sha256Hex,
  bytes: z.number().int().min(0).max(RESULT_CAP_BYTES),
  mediaType: boundedText,
  expiresAtMs: z.number().int().nonnegative(),
  operation: z.literal('read-result-range'),
});
const maxHeader = 8192;
async function exactRead(file: FileHandle, length: number, position: number) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await file.read(bytes, offset, length - offset, position + offset);
    if (!result.bytesRead) throw new Error('Context result file ended early');
    offset += result.bytesRead;
  }
  return bytes;
}

/** Opens a private vault under app-owned profile custody, never under a project grant. */
export async function openContextResultCustody(profileDirectory: string): Promise<ContextResultStorage> {
  const directory = await secureDirectory(profileDirectory, join(profileDirectory, 'context-results'));
  const identity = await lstat(directory);
  const verifyDirectory = async () => {
    const current = await lstat(directory);
    if (!current.isDirectory() || current.dev !== identity.dev || current.ino !== identity.ino || await realpath(directory) !== directory)
      throw new Error('Context result directory identity changed');
  };
  const pathFor = (handle: string) => {
    if (!handlePattern.test(handle)) throw new Error('Invalid context result handle');
    return join(directory, handle + '.result');
  };
  const read = async (handle: string, includeData: boolean) => {
    await verifyDirectory();
    const path = pathFor(handle), before = await lstat(path);
    if (!before.isFile() || before.size < 4 || before.size > 4 + maxHeader + RESULT_CAP_BYTES || await realpath(path) !== path)
      throw new Error('Context result custody changed');
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const pinned = await file.stat();
      if (!pinned.isFile() || before.dev !== pinned.dev || before.ino !== pinned.ino || before.size !== pinned.size)
        throw new Error('Context result identity changed');
      const length = (await exactRead(file, 4, 0)).readUInt32BE(0);
      if (!length || length > maxHeader || length + 4 > pinned.size) throw new Error('Invalid context result header');
      const record = metadata.parse(JSON.parse((await exactRead(file, length, 4)).toString('utf8')));
      if (record.handle !== handle || record.bytes + length + 4 !== pinned.size) throw new Error('Context result receipt does not match');
      const data = includeData ? await exactRead(file, record.bytes, length + 4) : undefined;
      await verifyDirectory();
      return { record, data };
    } finally { await file.close(); }
  };
  return {
    async put(handle, bytes, raw) {
      await verifyDirectory();
      const path = pathFor(handle), temporary = path + '.pending';
      const record = metadata.parse(raw);
      if (record.handle !== handle || record.bytes !== bytes.length) throw new Error('Context result receipt does not match');
      const header = Buffer.from(JSON.stringify(record)), size = Buffer.alloc(4);
      if (header.length > maxHeader) throw new Error('Context result header exceeds its bound');
      size.writeUInt32BE(header.length);
      const file = await open(temporary, 'wx', 0o600);
      try {
        try { await file.writeFile(Buffer.concat([size, header, bytes])); await file.sync(); }
        finally { await file.close(); }
        await verifyDirectory();
        await rename(temporary, path);
      } finally { await rm(temporary, { force: true }); }
    },
    async get(handle) { return (await read(handle, true)).data; },
    async getRecord(handle) { return (await read(handle, false)).record; },
    async pruneExpired(now) {
      await verifyDirectory();
      let remaining = 0, visited = 0;
      for await (const entry of await opendir(directory)) {
        if (++visited > 512) return MAX_TRACKED_RESULTS;
        if (!entry.isFile() || !entry.name.endsWith('.result')) continue;
        const handle = entry.name.slice(0, -7);
        if (!handlePattern.test(handle)) continue;
        let expiry: number | undefined;
        try { expiry = (await read(handle, false)).record.expiresAtMs; } catch { /* Conservatively retain an unreadable receipt. */ }
        if (expiry !== undefined && expiry <= now) { await verifyDirectory(); await rm(pathFor(handle), { force: true }); }
        else remaining++;
      }
      return remaining;
    },
  };
}
