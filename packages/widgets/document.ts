import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIDGET_BASE_CSS } from './theme.ts';

// Hash the actual import-free browser artifact, never loader-transformed function
// source. Missing assets fail closed in dev and production alike.
function receiverBytes(): string {
  try { return readFileSync(resolve('dist/widget-runtime/receiver.js'), 'utf8'); }
  catch { throw new Error('Trusted widget receiver is missing. Run pnpm build:widgets before starting the application or tests.'); }
}
const bootstrap = receiverBytes();
if (/<\/script/i.test(bootstrap)) throw new Error('Trusted widget receiver contains an unsafe script terminator.');
// Local data workers inherit this policy. unsafe-eval supports classic generated
// JavaScript ONLY in the worker; the document runs only this hashed trusted IIFE.
// No model HTML or JavaScript is ever parsed/evaluated in the real document.
export const WIDGET_SHELL_CSP = `default-src 'none'; script-src 'sha256-${createHash('sha256').update(bootstrap).digest('base64')}' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; worker-src data:; form-action 'none'; base-uri 'none'; object-src 'none'`;
export function widgetShellDocument(artifactId: string): string {
  const escaped = artifactId.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${WIDGET_SHELL_CSP}"><style>${WIDGET_BASE_CSS}</style></head><body data-artifact-id="${escaped}"><main id="harness-root"></main><script>${bootstrap}</script></body></html>`;
}
