export interface RenderNode { id: number; tag: string; attrs: Record<string, string>; children: RenderNode[]; text?: string; value?: string; checked?: boolean; selectedIndex?: number }
export interface RenderTree { tree: RenderNode[]; css: string }

// Used independently in the host and bundled trusted receiver. Neither the
// generated program nor its worker is trusted.
export function validateRender(value: unknown): value is RenderTree {
  const tags = new Set('div span p article section header footer main aside nav h1 h2 h3 h4 h5 h6 small strong em b i u s pre code blockquote ul ol li dl dt dd br hr table thead tbody tfoot tr td th caption form label input textarea button select option optgroup fieldset legend output progress meter details summary'.split(' '));
  const attrs = new Set('id class style title role name type placeholder value checked disabled readonly required multiple selected min max step minlength maxlength rows cols for tabindex colspan rowspan open autocomplete'.split(' '));
  if (!value || typeof value !== 'object') return false;
  const render = value as RenderTree;
  if (!Array.isArray(render.tree) || render.tree.length > 800 || typeof render.css !== 'string' || render.css.length > 16384) return false;
  const ids = new Set<number>(); let nodes = 0, bytes = render.css.length;
  function visit(node: RenderNode, depth: number): boolean {
    if (!node || typeof node !== 'object' || depth > 24 || ++nodes > 800 || !Number.isSafeInteger(node.id) || node.id < 1 || ids.has(node.id)) return false;
    ids.add(node.id);
    if (node.tag !== '#text' && !tags.has(node.tag)) return false;
    if (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs) || Object.keys(node.attrs).length > 32 || !Array.isArray(node.children) || node.children.length > 800) return false;
    if (node.tag === '#text' && (typeof node.text !== 'string' || node.children.length !== 0 || Object.keys(node.attrs).length !== 0)) return false;
    for (const [key, attr] of Object.entries(node.attrs)) {
      if ((!attrs.has(key) && !/^aria-[a-z-]{1,40}$/.test(key) && !/^data-[a-z0-9-]{1,40}$/.test(key)) || typeof attr !== 'string' || attr.length > 1024) return false;
      if (key === 'type' && !['text', 'number', 'email', 'tel', 'search', 'password', 'url', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range', 'checkbox', 'radio', 'button', 'submit', 'reset'].includes(attr)) return false;
      if (['rows', 'cols', 'colspan', 'rowspan', 'maxlength', 'minlength', 'tabindex'].includes(key) && (!/^-?\d{1,4}$/.test(attr) || Math.abs(Number(attr)) > 1000)) return false;
      bytes += attr.length;
    }
    if (node.text !== undefined) { if (typeof node.text !== 'string') return false; bytes += node.text.length; }
    if (node.value !== undefined) { if (typeof node.value !== 'string' || node.value.length > 16384) return false; bytes += node.value.length; }
    if (node.checked !== undefined && typeof node.checked !== 'boolean') return false;
    if (node.selectedIndex !== undefined && (!Number.isSafeInteger(node.selectedIndex) || node.selectedIndex < -1 || node.selectedIndex > 800)) return false;
    if (bytes > 65536) return false;
    for (let i = 0; i < node.children.length; i++) if (!Object.hasOwn(node.children, i) || !visit(node.children[i]!, depth + 1)) return false;
    return true;
  }
  for (let i = 0; i < render.tree.length; i++) if (!Object.hasOwn(render.tree, i) || !visit(render.tree[i]!, 0)) return false;
  return true;
}

// Bound work BEFORE JSON.stringify: sparse arrays otherwise serialize every
// index, including holes. The worker can forge any bridge message or cycles.
export function validateBridgePayload(value: unknown): boolean {
  const seen = new Set<object>(); let nodes = 0, bytes = 0;
  function visit(item: unknown, depth: number): boolean {
    if (++nodes > 2048 || depth > 24) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') { bytes += item.length; return bytes <= 65536; }
    if (!item || typeof item !== 'object' || seen.has(item)) return false;
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > 800) return false;
      for (let i = 0; i < item.length; i++) if (!Object.hasOwn(item, i) || !visit(item[i], depth + 1)) return false;
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return false;
      const keys = Object.keys(item); if (keys.length > 128) return false;
      for (const key of keys) { bytes += key.length; if (bytes > 65536 || !visit((item as Record<string, unknown>)[key], depth + 1)) return false; }
    }
    return true;
  }
  if (!visit(value, 0)) return false;
  try { return JSON.stringify(value).length <= 65536; } catch { return false; }
}

export function safeDeclarations(value: string): string {
  const properties = new Set('display grid-template-columns grid-template-rows grid-column grid-row gap row-gap column-gap flex flex-direction flex-wrap align-items align-content justify-content justify-items order width height min-width min-height max-width max-height margin margin-top margin-right margin-bottom margin-left padding padding-top padding-right padding-bottom padding-left border border-top border-bottom border-left border-right border-color border-width border-style border-radius box-sizing color background background-color font font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration white-space overflow overflow-x overflow-y opacity cursor list-style-type vertical-align'.split(' '));
  return value.split(';').slice(0, 100).flatMap(declaration => {
    const colon = declaration.indexOf(':'); if (colon < 0) return [];
    const key = declaration.slice(0, colon).trim().toLowerCase(), data = declaration.slice(colon + 1).trim();
    if (!properties.has(key) || data.length > 200 || !/^[a-zA-Z0-9\s#.,%()\-+/'"]+$/.test(data)) return [];
    if (Array.from(data.matchAll(/([a-z-]+)\s*\(/gi)).some(match => !['var', 'rgb', 'rgba', 'hsl', 'hsla', 'calc', 'min', 'max', 'clamp', 'repeat', 'minmax'].includes(match[1]!.toLowerCase()))) return [];
    if (Array.from(data.matchAll(/\d+(?:\.\d+)?/g)).some(match => Number(match[0]) > 4096)) return [];
    return [`${key}:${data}`];
  }).join(';');
}

export function sanitizeStylesheet(css: string): string {
  if (typeof css !== 'string' || css.length > 16384) return '';
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g)).slice(0, 100).flatMap(match => {
    const selector = match[1]!.trim();
    // Bounded simple selectors only. No CSS escapes, URLs, at-rules, relational
    // selectors, animations, filters, generated content, or custom properties.
    if (selector.length > 160 || !/^[a-zA-Z0-9_#., >*\-]+$/.test(selector)) return [];
    const declarations = safeDeclarations(match[2]!);
    return declarations ? [`${selector}{${declarations}}`] : [];
  }).join('\n');
}
