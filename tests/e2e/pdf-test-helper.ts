import type { Page } from '@playwright/test';

/** Observe real Worker ownership/termination without substituting a fake parser. */
export async function observeDraftWorkers(page: Page) {
  await page.evaluate(() => {
    const workers: { worker: Worker; terminated: boolean; request?: { id: string; sourceBytes: number; backingBytes: number; keys: string[] } }[] = [];
    Object.assign(window, { __draftWorkers: workers });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('pdf-draft.worker')) return;
        const record = { worker: this, terminated: false, request: undefined as typeof workers[number]['request'] }; workers.push(record);
        const terminate = this.terminate.bind(this), post = this.postMessage.bind(this);
        this.terminate = () => { record.terminated = true; terminate(); };
        this.postMessage = (data: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => {
          const request = data as { id: string; source: Uint8Array };
          record.request = { id: request.id, sourceBytes: request.source.byteLength, backingBytes: request.source.buffer.byteLength, keys: Object.keys(request).sort() };
          post(data, Array.isArray(transfer) ? transfer : transfer?.transfer ?? []);
        };
      }
    };
  });
}

/** Tiny synthetic page trees only. Never load the exponential tree in Node/pdf-lib. */
export function pageTreePdf(kind: 'repeated' | 'cyclic' | 'parent-cycle' = 'repeated', levels = 23): Uint8Array {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>'];
  for (let index = 0; index < levels; index++) {
    const id = index + 2, child = id + 1;
    const kids = kind === 'cyclic' && index === levels - 1 ? '2 0 R' : `${child} 0 R${kind === 'repeated' ? ` ${child} 0 R` : ''}`;
    objects.push(`<< /Type /Pages /Kids [${kids}] /Count 1${index ? ` /Parent ${id - 1} 0 R` : ''} >>`);
  }
  const leaf = levels + 2;
  objects.push(`<< /Type /Page /Parent ${kind === 'parent-cycle' ? leaf : leaf - 1} 0 R /MediaBox [0 0 612 792] >>`);
  let pdf = '%PDF-1.7\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
