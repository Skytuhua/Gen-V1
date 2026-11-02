import { inflateSync } from 'node:zlib';
import { validateSignaturePng } from '../ui-catalog/signature-data.ts';
import { HarnessError } from '../contracts/index.ts';

/** Only normalized non-interlaced 8-bit RGB/RGBA marks enter PDF embedding. */
export function validateCanonicalPng(bytes: Uint8Array): void {
  try {
    const { width, height } = validateSignaturePng(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new Error('Normalize this PNG using the signature upload control.');
    const parts: Uint8Array[] = []; let ended = false, seenHeader = false, seenData = false;
    const ancillary = new Set<string>();
    for (let offset = 8, chunks = 0; offset < bytes.length;) {
      if (++chunks > 128 || offset + 12 > bytes.length) throw new Error('Invalid PNG chunks');
      const size = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12) throw new Error('Invalid PNG chunk length');
      if (type === 'IHDR') {
        if (seenHeader || offset !== 8 || size !== 13) throw new Error('A canonical PNG has one initial header');
        seenHeader = true;
      } else if (type === 'IDAT') {
        if (!seenHeader || !size) throw new Error('Invalid PNG image data');
        seenData = true; parts.push(bytes.subarray(offset + 8, offset + 8 + size));
      } else if (type === 'IEND') {
        if (!seenData || size !== 0 || offset + 12 !== bytes.length) throw new Error('Invalid final PNG chunk');
        ended = true;
      } else if (type === 'sRGB' || type === 'gAMA' || type === 'pHYs' || type === 'cHRM') {
        const expectedLength = { sRGB: 1, gAMA: 4, pHYs: 9, cHRM: 32 }[type];
        if (seenData || ancillary.has(type) || size !== expectedLength) throw new Error('Invalid PNG color metadata');
        ancillary.add(type);
      } else throw new Error('Use the upload control to normalize this PNG; animation or extra chunks are unsupported');
      offset += size + 12;
    }
    if (!ended || !parts.length) throw new Error('Incomplete PNG');
    const expected = (width * (bytes[25] === 6 ? 4 : 3) + 1) * height;
    const decoded = inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
    if (decoded.byteLength !== expected) throw new Error('PNG pixel length differs from its header');
  } catch (error) { throw new HarnessError('INVALID_SIGNATURE_PNG', error instanceof Error ? error.message : 'Invalid signature PNG'); }
}
