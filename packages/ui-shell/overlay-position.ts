export interface OverlayViewport { left: number; top: number; width: number; height: number }
export interface OverlayAnchor { left: number; right: number; top: number; bottom: number }
export interface PopoverPlacement { left: number; top: number; width: number; height: number; side: 'above' | 'below' }
export interface PopoverPositionOptions {
  anchor: OverlayAnchor;
  viewport: OverlayViewport;
  width: number;
  height: number;
  preferredSide?: 'above' | 'below';
  align?: 'start' | 'end';
}

export function placePopover({ anchor, viewport, width, height, preferredSide = 'above', align = 'end' }: PopoverPositionOptions): PopoverPlacement {
  const size = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const origin = (value: number) => Number.isFinite(value) ? value : 0;
  const viewportWidth = size(viewport.width), viewportHeight = size(viewport.height);
  const horizontalInset = Math.min(8, viewportWidth / 2), verticalInset = Math.min(8, viewportHeight / 2);
  const leftEdge = origin(viewport.left) + horizontalInset, topEdge = origin(viewport.top) + verticalInset;
  const availableWidth = viewportWidth - horizontalInset * 2, availableHeight = viewportHeight - verticalInset * 2;
  const bottomEdge = topEdge + availableHeight;
  const above = Math.max(0, origin(anchor.top) - 8 - topEdge);
  const below = Math.max(0, bottomEdge - origin(anchor.bottom) - 8);
  const desiredHeight = Math.min(size(height), availableHeight);
  const fitsPreferred = (preferredSide === 'above' ? above : below) >= desiredHeight;
  const side = fitsPreferred ? preferredSide : above >= below ? 'above' : 'below';
  const popupWidth = Math.min(size(width), availableWidth);
  const popupHeight = Math.min(desiredHeight, side === 'above' ? above : below);
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum));
  return {
    left: clamp(align === 'end' ? origin(anchor.right) - popupWidth : origin(anchor.left), leftEdge, leftEdge + availableWidth - popupWidth),
    top: clamp(side === 'above' ? origin(anchor.top) - 8 - popupHeight : origin(anchor.bottom) + 8, topEdge, bottomEdge - popupHeight),
    width: popupWidth, height: popupHeight, side,
  };
}
