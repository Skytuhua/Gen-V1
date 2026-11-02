// This entry MUST be bundled as one import-free IIFE. The trusted sandboxed
// receiver starts it as an opaque data: worker, inheriting its restrictive CSP.
import { Window } from '@remote-dom/polyfill';
import { safeDeclarations, validateRender } from './policy.ts';
import type { RenderNode } from './policy.ts';

const scope = globalThis as unknown as { postMessage: (data: unknown) => void; addEventListener: (type: string, fn: (event: MessageEvent) => void) => void };
const post = scope.postMessage.bind(globalThis), listen = scope.addEventListener.bind(globalThis);
const timer = setInterval, later = setTimeout;
const remote = new Window();
const doc = remote.document;
const callbacks = new Set<(value: unknown) => void>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
let started = false, initialized = false, serial = 0, css = '', lastRender = '', lastSnapshotAt = -Infinity;
const ids = new WeakMap<object, number>(), elements = new Map<number, any>();
const idFor = (node: object) => { let id = ids.get(node); if (!id) { id = ++serial; ids.set(node, id); } return id; };
const bridge = (type: string, payload: unknown) => post({ type: 'bridge', event: type, payload });
const harness = {
  inputs: {} as unknown, state: {} as unknown, theme: {} as unknown, stateRevision: 0,
  emit: (actionId: string, payload: unknown = {}) => bridge('action', { actionId, payload }),
  setDirty: (dirty: boolean) => bridge('dirty', { dirty: !!dirty }),
  checkpoint: (values: unknown) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = later(() => { pending.delete(requestId); reject(new Error('State checkpoint not acknowledged; draft remains unsynced')); }, 10000);
    pending.set(requestId, { resolve, reject, timeout });
    bridge('checkpoint', { requestId, values, stateSchemaVersion });
  }),
  onUpdate: (callback: (value: unknown) => void) => { callbacks.add(callback); if (initialized) callback(harness); return () => callbacks.delete(callback); },
};
let stateSchemaVersion = 1;
Object.assign(remote, { harness, location: Object.freeze({ href: 'about:blank', origin: 'null' }), navigator: Object.freeze({ language: 'en', userAgent: 'Harness worker DOM' }) });

// The opaque worker origin intrinsically denies persistence, including through
// recovered native getters. Inherited CSP denies network/imports. API removal
// only keeps unsupported capabilities out of normal code; it is NOT isolation.
for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'BroadcastChannel', 'indexedDB', 'caches', 'navigator']) {
  const replacement = key === 'navigator' ? remote.navigator : undefined;
  try { Object.defineProperty(globalThis, key, { value: replacement, writable: false, configurable: false }); } catch { /* CSP still denies external I/O. */ }
}

// The polyfill deliberately has generic elements. Reflect supported native form
// properties and style declarations without introducing a second DOM engine.
const prototype = remote.HTMLElement.prototype;
for (const property of ['value', 'type', 'name', 'placeholder']) Object.defineProperty(prototype, property, {
  get(this: any) {
    if (property === 'value' && this.localName === 'select') { const options = this.querySelectorAll('option'); const selected = options[this.selectedIndex]; return selected?.value ?? ''; }
    return this.getAttribute(property) ?? (property === 'value' && ['textarea', 'option'].includes(this.localName) ? this.textContent : '');
  },
  set(this: any, value: unknown) {
    if (property === 'value' && this.localName === 'select') { const options = Array.from(this.querySelectorAll('option')) as any[]; this.selectedIndex = options.findIndex(option => option.value === String(value)); return; }
    this.setAttribute(property, String(value));
  },
});
Object.defineProperty(prototype, 'selectedIndex', {
  get(this: any) { const options = Array.from(this.querySelectorAll('option')) as any[]; const selected = options.findIndex(option => option.selected); return selected >= 0 ? selected : options.length ? 0 : -1; },
  set(this: any, value: number) { const options = Array.from(this.querySelectorAll('option')) as any[]; options.forEach((option, index) => { option.selected = index === value; }); },
});
for (const property of ['checked', 'disabled', 'selected', 'multiple', 'required', 'readOnly']) Object.defineProperty(prototype, property, {
  get(this: any) { return this.hasAttribute(property.toLowerCase()); },
  set(this: any, value: unknown) { if (value) this.setAttribute(property.toLowerCase(), ''); else this.removeAttribute(property.toLowerCase()); },
});
Object.defineProperty(prototype, 'style', {
  get(this: any) {
    const element = this;
    return new Proxy({ setProperty(name: string, value: string) { const key = name.replace(/[A-Z]/g, c => '-' + c.toLowerCase()); const declarations = element.getAttribute('style') ?? ''; element.setAttribute('style', safeDeclarations(`${declarations};${key}:${value}`)); } }, {
      set(target, key, value) { if (key === 'cssText') element.setAttribute('style', safeDeclarations(String(value))); else target.setProperty(String(key), String(value)); return true; },
    });
  },
});

function snapshot() {
  const now = performance.now(); if (now - lastSnapshotAt < 50) return; lastSnapshotAt = now;
  let count = 0; const attached = new Map<number, any>();
  function visit(node: any, depth: number): RenderNode[] {
    if (depth > 24 || ++count > 800) throw new Error('DOM limit exceeded');
    const id = idFor(node);
    if (node.nodeType === 3) return [{ id, tag: '#text', text: node.textContent ?? '', attrs: {}, children: [] }];
    if (node.nodeType !== 1) return [];
    const tag: string = node.localName;
    if (!validateRender({ tree: [{ id, tag, attrs: {}, children: [] }], css: '' })) return [];
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(node.attributes) as { name: string; value: string }[]) {
      if (attr.name === 'style') { attrs.style = safeDeclarations(attr.value); continue; }
      if (validateRender({ tree: [{ id, tag, attrs: { [attr.name]: attr.value }, children: [] }], css: '' })) attrs[attr.name] = attr.value;
    }
    const result: RenderNode = { id, tag, attrs, children: Array.from(node.childNodes).flatMap(child => visit(child, depth + 1)) };
    if (['input', 'textarea', 'select', 'option'].includes(tag)) result.value = String(node.value ?? '');
    if (tag === 'input') result.checked = !!node.checked;
    if (tag === 'select' && Number.isSafeInteger(node.selectedIndex)) result.selectedIndex = node.selectedIndex;
    attached.set(id, node); return [result];
  }
  const tree = Array.from(doc.body.childNodes).flatMap(node => visit(node, 0));
  const data = { tree, css };
  if (!validateRender(data)) throw new Error('Render budget exceeded');
  const serialized = JSON.stringify(data);
  if (serialized !== lastRender) { lastRender = serialized; elements.clear(); for (const [id, element] of attached) elements.set(id, element); post({ type: 'render', payload: data }); }
}

function start(html: string) {
  if (started) return; started = true;
  if (typeof html !== 'string' || html.length > 131072) throw new Error('Source budget exceeded');
  const scripts: string[] = [];
  let markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_all, attrs: string, source: string) => {
    if (!/\bsrc\s*=/i.test(attrs) && !/\btype\s*=/i.test(attrs)) scripts.push(source);
    return '';
  }).replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_all, source: string) => { css += source + '\n'; return ''; });
  markup = markup.replace(/<!doctype[^>]*>/gi, '');
  // The library parses into an inert worker-only DOM. No HTML string is ever
  // parsed or assigned to innerHTML in a real browser document.
  if (/<body[\s>]/i.test(markup)) markup = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(markup)?.[1] ?? markup;
  doc.body.innerHTML = markup;
  snapshot();
  timer(() => { try { snapshot(); } catch { post({ type: 'fatal' }); } }, 50);
  if (scripts.length) {
    // Native JS executes here, on the dedicated worker's event loop only.
    const run = new Function('window', 'document', 'harness', 'addEventListener', 'removeEventListener', 'dispatchEvent', scripts.join('\n;\n'));
    run(remote, doc, harness, remote.addEventListener.bind(remote), remote.removeEventListener.bind(remote), remote.dispatchEvent.bind(remote));
  }
  remote.dispatchEvent(new remote.Event('DOMContentLoaded'));
  snapshot();
}

listen('message', event => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'ping') { post({ type: 'pong', nonce: message.nonce }); return; }
  try {
    if (message.type === 'start') { stateSchemaVersion = message.stateSchemaVersion; start(message.html); }
    if (message.type === 'init') {
      Object.assign(harness, { inputs: message.inputs, state: message.state, theme: message.theme, stateRevision: message.stateRevision });
      initialized = true; for (const callback of callbacks) callback(harness);
      remote.dispatchEvent(new remote.Event('harness-ready'));
    }
    if (message.type === 'checkpoint.ack' || message.type === 'checkpoint.error') {
      const item = pending.get(message.payload?.requestId);
      if (item) { clearTimeout(item.timeout); pending.delete(message.payload.requestId); if (message.type === 'checkpoint.ack') { harness.stateRevision = message.payload.stateRevision; item.resolve(message.payload); } else item.reject(new Error(message.payload.message ?? 'Checkpoint failed')); }
    }
    if (message.type === 'ui.event') {
      const input = message.payload, element = elements.get(input.id); if (!element) return;
      if (typeof input.value === 'string') element.value = input.value;
      if (typeof input.checked === 'boolean') element.checked = input.checked;
      if (Number.isSafeInteger(input.selectedIndex)) element.selectedIndex = input.selectedIndex;
      if (input.event === 'focusin') Object.assign(doc, { activeElement: element });
      if (input.event === 'focusout') Object.assign(doc, { activeElement: null });
      const domEvent = new remote.Event(input.event, { bubbles: true, cancelable: true });
      if (input.key) Object.assign(domEvent, { key: input.key });
      element.dispatchEvent(domEvent);
      // Generic HTMLElement does not implement native on* IDL properties.
      let target = element; while (target) { const handler = target['on' + input.event]; if (typeof handler === 'function') handler.call(target, domEvent); target = target.parentNode; }
    }
    snapshot();
  } catch (error) { post({ type: 'fatal', message: error instanceof Error ? error.message.slice(0, 200) : 'Generated program failed' }); }
});
post({ type: 'ready' });
