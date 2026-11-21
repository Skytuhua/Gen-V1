/**
 * Mounted collapsed user-prompt clips registered by UserPromptDisclosure so
 * Conversation Find can (a) still search their text past the inert boundary and
 * (b) request a non-animated reveal before centering a clipped match.
 */
export interface PromptClip {
  /** The clipped element whose rect bounds the readable preview area. */
  clip: () => Element | null;
  /** Whether the preview is currently collapsed. */
  collapsed: () => boolean;
  /** Non-animated reveal request; `done` fires once clip/mask/inert are removed. */
  reveal: (done: () => void) => void;
}
const clips = new WeakMap<Element, PromptClip>();
export function registerPromptClip(boundary: Element, clip: PromptClip): () => void {
  clips.set(boundary, clip);
  return () => clips.delete(boundary);
}
/** True when `element` is a registered clip boundary whose inert gate may be bypassed. */
export function isPromptClipBoundary(element: Element): boolean {
  return clips.has(element);
}
/** The registered clip boundary containing `node`, or null. */
export function promptClipBoundary(node: Node): Element | null {
  let element: Element | null = (node as {nodeType?:number}).nodeType === 1 ? node as Element : node.parentElement;
  for (; element; element = element.parentElement) {
    if (clips.has(element)) return element;
  }
  return null;
}
export function promptClipEntry(boundary: Element): PromptClip | undefined {
  return clips.get(boundary);
}
/**
 * Does any measurable part of `range` fall below the collapsed clip's usable
 * bottom edge (cap minus the 24px fade)? An unmeasurable range inside a
 * collapsed clip counts as clipped.
 */
export function rangeClippedBy(clip: Element, range: Range): boolean {
  const usableBottom = clip.getBoundingClientRect().bottom - 24;
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
  if (!rects.length) return true;
  return rects.some(rect => rect.bottom > usableBottom);
}
