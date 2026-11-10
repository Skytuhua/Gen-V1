import {deflateSync, crc32} from 'node:zlib';
import {ANNOTATION_REVIEW_IMAGE} from '../exploration-review-data';
import {createSigningPdfFixture} from '../../tests/e2e/document-preview-fixture';
import {TASK_RESOURCE_IDS, TASK_DOCUMENT_TEXT} from './task-data';

// Bounded deterministic source assets, served through the same resource URLs as real grants.
function png(width: number, height: number, pixel: (x: number, y: number) => number[]): Uint8Array {
  const chunk = (type: string, bytes: Buffer) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgba = pixel(x, y), offset = y * (width * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 4; channel++) rows[offset + channel] = rgba[channel];
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const colorStudy = (warm: boolean) => png(640, 400, (x, y) => {
  if (x > 80 && x < 380 && y > 64 && y < 290) return warm ? [224, 174, 105, 255] : [110, 157, 195, 255];
  if ((x - 430) ** 2 + (y - 230) ** 2 < 100 ** 2) return warm ? [174, 85, 63, 255] : [49, 89, 131, 255];
  return warm ? [242, 228, 204, 255] : [220, 234, 241, 255];
});
const signature = () => png(960, 320, (x, y) => {
  const center = 175 - 45 * Math.sin((x - 130) / 24) - 20 * Math.sin((x - 130) / 9);
  return x > 130 && x < 830 && Math.abs(y - center) < 3 ? [25, 27, 48, 255] : [0, 0, 0, 0];
});
let pdf: Promise<Uint8Array> | undefined;
const cached = new Map<string, Uint8Array>();
export async function taskAssetResponse(id: string): Promise<{contentType: string; body: Uint8Array | string} | null> {
  if (id === TASK_RESOURCE_IDS.document) return {contentType: 'text/plain; charset=utf-8', body: TASK_DOCUMENT_TEXT};
  if (id === TASK_RESOURCE_IDS.pdf) return {contentType: 'application/pdf', body: await (pdf ??= createSigningPdfFixture({pages: 1}))};
  if (id === TASK_RESOURCE_IDS.annotation) return {contentType: 'image/svg+xml', body: ANNOTATION_REVIEW_IMAGE};
  if (![TASK_RESOURCE_IDS.before, TASK_RESOURCE_IDS.after, TASK_RESOURCE_IDS.signature].includes(id as typeof TASK_RESOURCE_IDS.before)) return null;
  if (!cached.has(id)) cached.set(id, id === TASK_RESOURCE_IDS.signature ? signature() : colorStudy(id === TASK_RESOURCE_IDS.after));
  return {contentType: 'image/png', body: cached.get(id)!};
}
