import {expect, it} from 'vitest';
import {pastedImageFiles, pastedImageName} from '../apps/web/src/pasted-images';

const imageFile = (type = 'image/png', name = 'image.png') => new File([new Uint8Array([137, 80, 78, 71])], name, {type});
const transfer = ({text = '', files = [] as File[], items = [] as {kind: string; type: string; getAsFile: () => File | null}[]} = {}) => ({
  getData: (format: string) => format === 'text/plain' ? text : '',
  files: files as unknown as FileList,
  items: items as unknown as DataTransferItemList,
});

it('returns a timestamped File for a single pasted PNG', () => {
  const at = new Date(2026, 10, 21, 14, 5, 2);
  const files = pastedImageFiles(transfer({files: [imageFile()]}), at);
  expect(files).toHaveLength(1);
  expect(files[0].name).toBe('pasted-image-20261121-140502.png');
  expect(files[0].type).toBe('image/png');
});

it('suffixes later images in one paste and maps jpeg to .jpg', () => {
  const at = new Date(2026, 10, 21, 14, 5, 2);
  const files = pastedImageFiles(transfer({files: [imageFile('image/png'), imageFile('image/jpeg'), imageFile('image/webp')]}), at);
  expect(files.map(file => file.name)).toEqual(['pasted-image-20261121-140502.png', 'pasted-image-20261121-140502-2.jpg', 'pasted-image-20261121-140502-3.webp']);
});

it('finds clipboard images exposed only through items', () => {
  const at = new Date(2026, 10, 21, 9, 30, 0);
  const files = pastedImageFiles(transfer({items: [{kind: 'file', type: 'image/png', getAsFile: () => imageFile()}, {kind: 'string', type: 'text/plain', getAsFile: () => null}]}), at);
  expect(files.map(file => file.name)).toEqual(['pasted-image-20261121-093000.png']);
});

it('still returns images when the clipboard text is only whitespace', () => {
  const at = new Date(2026, 0, 2, 3, 4, 5);
  expect(pastedImageFiles(transfer({text: '  \n', files: [imageFile()]}), at)).toHaveLength(1);
});

it('returns [] for null data or when non-whitespace text is present', () => {
  const at = new Date();
  expect(pastedImageFiles(null, at)).toEqual([]);
  expect(pastedImageFiles(transfer({text: 'hello', files: [imageFile()]}), at)).toEqual([]);
});

it('ignores svg, pdf and other non-raster types', () => {
  const files = pastedImageFiles(transfer({files: [imageFile('image/svg+xml', 'a.svg'), imageFile('application/pdf', 'a.pdf'), imageFile('image/bmp', 'a.bmp')]}), new Date());
  expect(files).toEqual([]);
});

it('produces names that survive the host sanitizer', () => {
  expect(pastedImageName(new Date(2026, 10, 21, 14, 5, 2), 'png', 1)).toMatch(/^[a-zA-Z0-9._ -]+$/);
});
