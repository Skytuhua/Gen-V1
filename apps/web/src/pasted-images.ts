// Clipboard image paste for the composer: detect image files on a paste event's
// DataTransfer and re-wrap them as timestamped Files for the existing upload path.
export const pastedImageTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const;

const pad = (value: number) => String(value).padStart(2, '0');

export function pastedImageName(at: Date, ext: string, index: number): string {
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `pasted-image-${stamp}${index > 1 ? `-${index}` : ''}.${ext}`;
}

export function pastedImageFiles(data: Pick<DataTransfer, 'getData' | 'files' | 'items'> | null, at: Date): File[] {
  if (!data) return [];
  if (data.getData('text/plain').trim() !== '') return [];
  let candidates = Array.from(data.files ?? []);
  if (!candidates.length) candidates = Array.from(data.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null);
  return candidates.filter(file => file.type in pastedImageTypes).map((file, index) => new File([file], pastedImageName(at, pastedImageTypes[file.type as keyof typeof pastedImageTypes], index + 1), { type: file.type, lastModified: at.getTime() }));
}
