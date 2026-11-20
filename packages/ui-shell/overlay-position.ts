export interface OverlayViewport { left: number; top: number; width: number; height: number }
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
  /** Containing column (for example the composer dock) the popup should stay inside horizontally. */
  bounds?: OverlayAnchor | null;
}

export function placePopover({ anchor, viewport, width, height, preferredSide = 'above', align = 'end', bounds }: PopoverPositionOptions): PopoverPlacement {
  const size = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const origin = (value: number) => Number.isFinite(value) ? value : 0;
  const viewportWidth = size(viewport.width), viewportHeight = size(viewport.height);
  const horizontalInset = Math.min(8, viewportWidth / 2), verticalInset = Math.min(8, viewportHeight / 2);
  const leftEdge = origin(viewport.left) + horizontalInset, topEdge = origin(viewport.top) + verticalInset;
  const availableWidth = viewportWidth - horizontalInset * 2, availableHeight = viewportHeight - verticalInset * 2;
  const bottomEdge = topEdge + availableHeight, rightEdge = leftEdge + availableWidth;
  // A containing column narrows the horizontal range so a wide popup cannot
  // slide left over neighboring navigation. Bounds with no usable viewport
  // overlap are ignored.
  const columnLeft = bounds ? Math.max(leftEdge, origin(bounds.left)) : leftEdge;
  const columnRight = bounds ? Math.min(rightEdge, origin(bounds.right)) : rightEdge;
  const boundLeft = columnRight - columnLeft > 0 ? columnLeft : leftEdge;
  const boundRight = columnRight - columnLeft > 0 ? columnRight : rightEdge;
  const boundWidth = Math.max(0, boundRight - boundLeft);
  const above = Math.max(0, origin(anchor.top) - 8 - topEdge);
  const below = Math.max(0, bottomEdge - origin(anchor.bottom) - 8);
  const desiredHeight = Math.min(size(height), availableHeight);
  const popupWidth = Math.min(size(width), boundWidth);
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum));
  if (preferredSide === 'left' || preferredSide === 'right') {
    const right = Math.max(0, boundRight - origin(anchor.right) - 8);
    const left = Math.max(0, origin(anchor.left) - 8 - boundLeft);
    const desiredWidth = Math.min(size(width), boundWidth);
    const side: OverlaySide = (preferredSide === 'right' ? right : left) >= desiredWidth
      ? preferredSide
      : right >= left ? 'right' : 'left';
    // Beside the anchor only the remaining gap is available, so a card that
    // cannot fit there whole would be squeezed to an unreadable sliver. Use the
    // full viewport width above or below instead.
    if ((side === 'right' ? right : left) >= desiredWidth) {
      const popupHeight = Math.min(desiredHeight, availableHeight);
      const popupWidth = Math.min(desiredWidth, side === 'left' ? left : right);
      return {
        left: clamp(side === 'right' ? origin(anchor.right) + 8 : origin(anchor.left) - 8 - popupWidth, boundLeft, boundRight - popupWidth),
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
  return {
    left: clamp(align === 'end' ? origin(anchor.right) - popupWidth : origin(anchor.left), boundLeft, boundRight - popupWidth),
    top: clamp(side === 'above' ? origin(anchor.top) - 8 - popupHeight : origin(anchor.bottom) + 8, topEdge, bottomEdge - popupHeight),
    width: popupWidth, height: popupHeight, side,
  };
}
