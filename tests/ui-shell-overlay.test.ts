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
