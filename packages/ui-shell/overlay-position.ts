interface OverlayViewport { left: number; top: number; width: number; height: number }
export interface OverlayAnchor { left: number; right: number; top: number; bottom: number }
export type OverlaySide = 'above' | 'below' | 'left' | 'right';
export interface PopoverPlacement { left: number; top: number; width: number; height: number; side: OverlaySide }
export interface PopoverPositionOptions {
  anchor: OverlayAnchor;
  viewport: OverlayViewport;
  width: number;
  height: number;
  preferredSide?: OverlaySide;
  align?: 'start' | 'end';
  /** Inner layout region the popup should not paint over, such as the chat column beside the sidebar. */
  boundary?: OverlayAnchor;
}

export function placePopover({ anchor, viewport, width, height, preferredSide = 'above', align = 'end', boundary }: PopoverPositionOptions): PopoverPlacement {
  const size = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const origin = (value: number) => Number.isFinite(value) ? value : 0;
  const viewportWidth = size(viewport.width), viewportHeight = size(viewport.height);
  const horizontalInset = Math.min(8, viewportWidth / 2), verticalInset = Math.min(8, viewportHeight / 2);
  const leftEdge = origin(viewport.left) + horizontalInset, topEdge = origin(viewport.top) + verticalInset;
  const availableWidth = viewportWidth - horizontalInset * 2, availableHeight = viewportHeight - verticalInset * 2;
  const bottomEdge = topEdge + availableHeight, rightEdge = leftEdge + availableWidth;
  const above = Math.max(0, origin(anchor.top) - 8 - topEdge);
  const below = Math.max(0, bottomEdge - origin(anchor.bottom) - 8);
  const desiredHeight = Math.min(size(height), availableHeight);
  const popupWidth = Math.min(size(width), availableWidth);
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum));
  // Horizontal containment inside an optional inner boundary (a layout column
  // the popup must not overlap, such as the workarea beside the sidebar). When
  // the region is narrower than the requested width the popup shrinks to fit
  // it; only a degenerate region too thin to host the popup falls back to the
  // viewport bounds.
  const boundLeft = boundary ? Math.max(leftEdge, origin(boundary.left) + horizontalInset) : leftEdge;
  const boundRight = boundary ? Math.min(rightEdge, origin(boundary.right) - horizontalInset) : rightEdge;
  const boundWidth = boundRight - boundLeft;
  const inside = boundWidth >= Math.min(popupWidth, 240);
  const horizontal = (popup: number) => inside
    ? { min: boundLeft, max: Math.max(boundLeft, boundRight - Math.min(popup, boundWidth)) }
    : { min: leftEdge, max: Math.max(leftEdge, rightEdge - popup) };
  const fit = (popup: number) => inside ? Math.min(popup, boundWidth) : popup;
  if (preferredSide === 'left' || preferredSide === 'right') {
    const right = Math.max(0, rightEdge - origin(anchor.right) - 8);
    const left = Math.max(0, origin(anchor.left) - 8 - leftEdge);
    const desiredWidth = Math.min(size(width), availableWidth);
    const side: OverlaySide = (preferredSide === 'right' ? right : left) >= desiredWidth
      ? preferredSide
      : right >= left ? 'right' : 'left';
    // Beside the anchor only the remaining gap is available, so a card that
    // cannot fit there whole would be squeezed to an unreadable sliver. Use the
    // full viewport width above or below instead.
    if ((side === 'right' ? right : left) >= desiredWidth) {
      const popupHeight = Math.min(desiredHeight, availableHeight);
      const popupWidth = fit(Math.min(desiredWidth, side === 'left' ? left : right));
      const x = horizontal(popupWidth);
      return {
        left: clamp(side === 'right' ? origin(anchor.right) + 8 : origin(anchor.left) - 8 - popupWidth, x.min, x.max),
        top: clamp(align === 'end' ? origin(anchor.bottom) - popupHeight : origin(anchor.top), topEdge, bottomEdge - popupHeight),
        width: popupWidth, height: popupHeight, side,
      };
    }
  }
  const fitsPreferred = (preferredSide === 'above' ? above : below) >= desiredHeight;
  // A side card that does not fit beside its anchor falls back here, where
  // "preferred" no longer names a vertical side: take the one that fits.
  const side: OverlaySide = preferredSide === 'left' || preferredSide === 'right'
    ? above >= desiredHeight ? 'above' : below >= desiredHeight ? 'below' : above >= below ? 'above' : 'below'
    : fitsPreferred ? preferredSide : above >= below ? 'above' : 'below';
  const popupHeight = Math.min(desiredHeight, side === 'above' ? above : below);
  const fittedWidth = fit(popupWidth);
  const x = horizontal(fittedWidth);
  return {
    left: clamp(align === 'end' ? origin(anchor.right) - fittedWidth : origin(anchor.left), x.min, x.max),
    top: clamp(side === 'above' ? origin(anchor.top) - 8 - popupHeight : origin(anchor.bottom) + 8, topEdge, bottomEdge - popupHeight),
    width: fittedWidth, height: popupHeight, side,
  };
}
