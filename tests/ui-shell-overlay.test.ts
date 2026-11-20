import { describe, expect, it } from 'vitest';
import { placePopover } from '../packages/ui-shell/overlay-position';

describe('shared anchored popup geometry', () => {
  const anchor = { left: 460, right: 560, top: 540, bottom: 572 };
  const viewport = { left: 0, top: 42, width: 800, height: 558 };

  it('opens above a low trigger with the approved anchor gap', () => {
    expect(placePopover({ anchor, viewport, width: 400, height: 390 })).toEqual({
      left: 160, top: 142, width: 400, height: 390, side: 'above',
    });
  });

  it('flips a high trigger before reducing content height', () => {
    const high = { left: 10, right: 110, top: 55, bottom: 87 };
    expect(placePopover({ anchor: high, viewport, width: 400, height: 390 })).toEqual({
      left: 8, top: 95, width: 400, height: 390, side: 'below',
    });
  });

  it('uses the larger side when neither side fits, keeping native chrome clear', () => {
    const middle = { left: 200, right: 300, top: 200, bottom: 232 };
    const result = placePopover({ anchor: middle, viewport, width: 720, height: 900 });
    expect(result.side).toBe('below');
    expect(result.height).toBe(352);
    expect(result.top).toBe(240);
    expect(result.left).toBe(8);
    expect(result.left + result.width).toBeLessThanOrEqual(792);
    expect(result.top + result.height).toBeLessThanOrEqual(592);
  });

  it('respects zoomed visual viewport offsets and a short viewport', () => {
    const visible = { left: 120, top: 80, width: 260, height: 150 };
    const result = placePopover({ anchor, viewport: visible, width: 400, height: 390 });
    expect(result.left).toBe(128);
    expect(result.top).toBe(88);
    expect(result.width).toBe(244);
    expect(result.height).toBe(134);
  });

  it('never emits negative or nonfinite dimensions for temporarily hidden owners', () => {
    for (const width of [0, 8, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = placePopover({ anchor, viewport: { left: 0, top: 0, width, height: 0 }, width: 400, height: 390 });
      for (const value of [result.left, result.top, result.width, result.height]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('side placements for anchored panels beside their trigger', () => {
  const viewport = { left: 0, top: 42, width: 800, height: 558 };

  it('opens a hover card to the right of a sidebar row with the approved gap', () => {
    const row = { left: 12, right: 260, top: 200, bottom: 232 };
    expect(placePopover({ anchor: row, viewport, width: 320, height: 240, preferredSide: 'right', align: 'start' })).toEqual({
      left: 268, top: 200, width: 320, height: 240, side: 'right',
    });
  });

  it('flips to the left when the right side cannot hold the card', () => {
    const row = { left: 640, right: 780, top: 200, bottom: 232 };
    expect(placePopover({ anchor: row, viewport, width: 320, height: 240, preferredSide: 'right', align: 'start' })).toEqual({
      left: 312, top: 200, width: 320, height: 240, side: 'left',
    });
  });

  it('falls back below instead of squeezing the card into the remaining gap', () => {
    const result = placePopover({ anchor: { left: 100, right: 200, top: 100, bottom: 132 }, viewport: { left: 0, top: 0, width: 300, height: 400 }, width: 320, height: 240, preferredSide: 'right', align: 'start' });
    expect(result).toEqual({ left: 8, top: 140, width: 284, height: 240, side: 'below' });
    expect(result.left + result.width).toBeLessThanOrEqual(292);
  });

  it('keeps an end-aligned side panel inside the vertical inset', () => {
    const row = { left: 12, right: 260, top: 200, bottom: 232 };
    expect(placePopover({ anchor: row, viewport, width: 320, height: 240, preferredSide: 'right' })).toMatchObject({ top: 50, height: 240, side: 'right' });
  });
});

describe('column bounds keep composer popovers inside their dock', () => {
  // A 248px sidebar leaves the workarea starting at 248; the composer dock is a
  // centered column inside it. Bounds = the dock rect.
  const viewport = { left: 0, top: 0, width: 900, height: 700 };
  const dock = { left: 268, right: 880, top: 300, bottom: 660 };
  const anchor = { left: 780, right: 872, top: 620, bottom: 652 };

  it('keeps a wide end-aligned popup from sliding left over the sidebar', () => {
    const result = placePopover({ anchor, viewport, width: 720, height: 440, bounds: dock });
    expect(result.left).toBeGreaterThanOrEqual(dock.left);
    expect(result.left + result.width).toBeLessThanOrEqual(dock.right);
    expect(result.width).toBe(612);
  });

  it('does not move a popup that already fits inside its column', () => {
    const narrow = { left: 700, right: 792, top: 620, bottom: 652 };
    const result = placePopover({ anchor: narrow, viewport, width: 320, height: 300, bounds: dock });
    expect(result).toEqual({ left: 472, top: 312, width: 320, height: 300, side: 'above' });
    expect(placePopover({ anchor: narrow, viewport, width: 320, height: 300 })).toEqual(result);
  });

  it('ignores bounds that have no usable overlap with the viewport', () => {
    const offscreen = { left: -600, right: -500, top: 0, bottom: 100 };
    const result = placePopover({ anchor, viewport, width: 400, height: 300, bounds: offscreen });
    expect(result.left).toBe(472);
    expect(result.width).toBe(400);
  });
});
