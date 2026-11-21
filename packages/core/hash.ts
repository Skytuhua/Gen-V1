import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { HarnessError } from '../contracts/index.ts';

export const sha256Hex = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export async function sha256File(path: string, maxBytes?: number, limitMessage = 'File exceeds the digest size limit'): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += (chunk as Buffer).length;
    if (maxBytes !== undefined && bytes > maxBytes) throw new HarnessError('RESOURCE_LIMIT', limitMessage);
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}
