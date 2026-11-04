import { safeDeclarations, sanitizeStylesheet, validateRender, validateBridgePayload } from './policy.ts';
import type { RenderTree, RenderNode } from './policy.ts';

function receiverBootstrap() {
  const params = new URLSearchParams(location.hash.slice(1));
  const identity = { channel: 'harness-widget', token: params.get('token'), mountId: params.get('mountId'), artifactId: document.body.dataset.artifactId };
  const root = document.getElementById('harness-root')!;
  const stylesheet = document.createElement('style'); document.head.append(stylesheet);
  const nodes = new Map<number, Node>(), reverse = new WeakMap<Node, number>();
  const send = (type: string, payload: unknown = {}) => parent.postMessage({ ...identity, type, payload }, '*');
  let stopped = false;
  let worker: Worker | undefined;
  let messageWindow = performance.now(), messages = 0;
  function stopWorker() { stopped = true; worker?.terminate(); worker = undefined; }
  function render(data: RenderTree) {
    const seen = new Set<number>();
    function reconcile(container: Node, children: RenderNode[]) {
      let cursor = container.firstChild;
      for (const spec of children) {
        let node = nodes.get(spec.id);
        if (node && (spec.tag === '#text' ? node.nodeType !== 3 : !(node instanceof HTMLElement) || node.localName !== spec.tag)) throw new Error('Node identity changed');
        if (!node) { node = spec.tag === '#text' ? document.createTextNode('') : document.createElement(spec.tag); nodes.set(spec.id, node); reverse.set(node, spec.id); }
        seen.add(spec.id);
        if (node !== cursor) container.insertBefore(node, cursor);
        cursor = node.nextSibling;
        if (spec.tag === '#text') { if (node.textContent !== spec.text) node.textContent = spec.text!; continue; }
        const element = node as HTMLElement;
        for (const attr of Array.from(element.attributes)) if (!Object.hasOwn(spec.attrs, attr.name)) element.removeAttribute(attr.name);
        for (const [key, value] of Object.entries(spec.attrs)) { const safe = key === 'style' ? safeDeclarations(value) : value; if (element.getAttribute(key) !== safe) element.setAttribute(key, safe); }
        reconcile(element, spec.children);
        const control = element as HTMLInputElement;
        if (spec.value !== undefined && document.activeElement !== element && control.value !== spec.value) control.value = spec.value;
        if (spec.checked !== undefined) control.checked = spec.checked;
        if (spec.selectedIndex !== undefined && document.activeElement !== element) (element as HTMLSelectElement).selectedIndex = spec.selectedIndex;
      }
      while (cursor) { const next = cursor.nextSibling; container.removeChild(cursor); cursor = next; }
    }
    reconcile(root, data.tree);
    for (const id of nodes.keys()) if (!seen.has(id)) nodes.delete(id);
    const css = sanitizeStylesheet(data.css); if (stylesheet.textContent !== css) stylesheet.textContent = css;
  }
  addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || !message || Object.entries(identity).some(([key, value]) => message[key] !== value)) return;
    if (message.type === 'worker.start' && !worker && !stopped) {
      if (typeof message.payload?.source !== 'string' || message.payload.source.length > 2_000_000) { stopWorker(); send('receiver.error'); return; }
      try {
        // A data URL Worker has an opaque origin, including when native storage
        // getters are recovered. The sandbox stays allow-scripts ONLY.
        worker = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(message.payload.source), { credentials: 'omit', name: 'generated-app-opaque' });
        worker.addEventListener('error', () => { stopWorker(); send('worker.error'); });
        worker.addEventListener('messageerror', () => { stopWorker(); send('receiver.error'); });
        worker.addEventListener('message', event => {
          if (stopped) return;
          const now = performance.now(); if (now - messageWindow >= 1000) { messageWindow = now; messages = 0; }
          if (++messages > 80) { stopWorker(); send('worker.error'); return; }
          const data = event.data;
          if (!data || typeof data !== 'object' || (data.type === 'render' && !validateRender(data.payload))) { stopWorker(); send('receiver.error'); return; }
          if (data.type === 'bridge') {
            if (!['action', 'dirty', 'checkpoint'].includes(data.event) || !validateBridgePayload(data.payload)) { stopWorker(); send('worker.bridge-error'); return; }
            send('worker.message', { type: 'bridge', event: data.event, payload: data.payload });
          } else if (data.type === 'render') send('worker.message', { type: 'render', payload: data.payload });
          else if (data.type === 'ready' || data.type === 'fatal') send('worker.message', { type: data.type });
          else if (data.type === 'pong' && typeof data.nonce === 'string' && data.nonce.length <= 64) send('worker.message', { type: 'pong', nonce: data.nonce });
          else { stopWorker(); send('receiver.error'); }
        });
      } catch { stopWorker(); send('worker.error'); }
      return;
    }
    if (message.type === 'worker.post') { worker?.postMessage(message.payload); return; }
    if (message.type === 'worker.dispose') { stopWorker(); return; }
    if (message.type === 'render' && !stopped) {
      if (!validateRender(message.payload)) { stopWorker(); send('receiver.error'); return; }
      try { render(message.payload); } catch { stopWorker(); send('receiver.error'); }
    }
    if (message.type === 'init') {
      for (const [key, value] of Object.entries(message.theme ?? {})) if (/^--[a-zA-Z0-9-]{1,40}$/.test(key) && typeof value === 'string' && /^[a-zA-Z0-9 #.,()%\-]+$/.test(value) && value.length <= 100) document.documentElement.style.setProperty(key, value);
      if (['light', 'dark'].includes(message.theme?.colorScheme)) document.documentElement.style.colorScheme = message.theme.colorScheme;
    }
    if (message.type === 'runtime.stopped') { stopWorker(); const status = document.createElement('p'); status.setAttribute('role', 'alert'); status.textContent = 'Generated app stopped: execution limit or invalid update. Draft controls remain visible.'; document.body.append(status); }
  });
  document.addEventListener('keydown', event => {
    if (event.isTrusted && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      send('shell.escape', { key: 'Escape' });
    }
  }, true);
  for (const type of ['click', 'input', 'change', 'submit', 'keydown', 'focusin', 'focusout']) root.addEventListener(type, event => {
    if (type === 'submit') event.preventDefault();
    if (stopped || !event.isTrusted || !(event.target instanceof HTMLElement)) return;
    const id = reverse.get(event.target); if (!id) return;
    const input = event.target as HTMLInputElement;
    send('ui.event', { id, event: type, value: typeof input.value === 'string' ? input.value.slice(0, 16384) : undefined, checked: typeof input.checked === 'boolean' ? input.checked : undefined, selectedIndex: 'selectedIndex' in input ? (input as unknown as HTMLSelectElement).selectedIndex : undefined, key: event instanceof KeyboardEvent ? event.key.slice(0, 40) : undefined });
  });
  send('ready');
}

receiverBootstrap();
