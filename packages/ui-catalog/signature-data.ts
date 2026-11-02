export type SignaturePoint = { x: number; y: number };
export type DrawnSignature = { kind: 'drawn'; points: SignaturePoint[]; strokes?: never } | { kind: 'drawn'; strokes: SignaturePoint[][]; points?: never };
export type VisualSignature = { kind: 'typed'; text: string } | DrawnSignature | { kind: 'image'; resourceId: string };
export const MAX_SIGNATURE_POINTS = 2000;
export const MAX_SIGNATURE_PNG_BYTES = 512 * 1024;
export const signatureStrokes = (mark: DrawnSignature): SignaturePoint[][] => mark.strokes ?? [mark.points];

export function readVisualSignature(value: unknown): VisualSignature | null {
  if (value == null) return null;
  const invalid = () => new Error('The saved visual signature is invalid. Clear it and try again.');
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const mark = value as Record<string, unknown>;
  if (mark.kind === 'typed' && typeof mark.text === 'string' && mark.text.length <= 200) return mark.text.trim() ? { kind: 'typed', text: mark.text } : null;
  if (mark.kind === 'image' && typeof mark.resourceId === 'string' && /^[^\u0000-\u0020/\\?#]{1,200}$/.test(mark.resourceId) && !['.', '..'].includes(mark.resourceId)) return { kind: 'image', resourceId: mark.resourceId };
  if (mark.kind !== 'drawn' || (mark.points !== undefined && mark.strokes !== undefined)) throw invalid();
  const raw = mark.strokes ?? (mark.points ? [mark.points] : null);
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw invalid();
  let total = 0;
  const strokes = raw.map(stroke => {
    if (!Array.isArray(stroke) || stroke.length < 2 || (total += stroke.length) > MAX_SIGNATURE_POINTS) throw invalid();
    return stroke.map(point => {
      if (!point || ![point.x, point.y].every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)) throw new Error('The saved signature points must be normalized between 0 and 1.');
      return { x: point.x as number, y: point.y as number };
    });
  });
  return mark.strokes ? { kind: 'drawn', strokes } : { kind: 'drawn', points: strokes[0] };
}

/** Bound dimensions before either browser decoding or PDF embedding allocates pixels. */
export function validateSignaturePng(bytes: Uint8Array, upload = false) {
  const limit = upload ? 2 * 1024 * 1024 : MAX_SIGNATURE_PNG_BYTES;
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > limit || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new Error(`Choose a PNG signature up to ${upload ? '2 MiB' : '512 KiB'}.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
  const maxDimension = upload ? 4096 : 1024, maxPixels = upload ? 4_000_000 : 524_288;
  if (!width || !height || width > maxDimension || height > maxDimension || width * height > maxPixels) throw new Error('The PNG signature dimensions exceed the supported limit.');
  let header = false, data = false, end = false;
  for (let offset = 8, chunks = 0; offset < bytes.length;) {
    if (++chunks > 256 || offset + 12 > bytes.length) throw new Error('Invalid PNG chunks.');
    const size = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (size > bytes.length - offset - 12) throw new Error('Invalid PNG chunk length.');
    if (type === 'IHDR') { if (header || offset !== 8 || size !== 13) throw new Error('A PNG signature must have one initial header.'); header = true; }
    else if (type === 'IDAT') { if (!header || !size) throw new Error('Invalid PNG image data.'); data = true; }
    else if (type === 'IEND') { if (!data || size !== 0 || offset + 12 !== bytes.length) throw new Error('Invalid PNG ending.'); end = true; }
    else if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('Animated PNG signatures are unsupported. Upload a static PNG.');
    else if (!upload && !['sRGB', 'gAMA', 'pHYs', 'cHRM'].includes(type)) throw new Error('Normalize this PNG through the signature upload control.');
    offset += size + 12;
  }
  if (!header || !data || !end) throw new Error('The PNG signature is incomplete.');
  return { width, height };
}
