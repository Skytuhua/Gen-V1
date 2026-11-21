import {describe, expect, it} from 'vitest';
import {workspacePanelBounds} from '../apps/web/src/panel-geometry';

describe('conversation and tool width contract', () => {
  it.each([701, 706, 776, 1192, 1672])('reserves420px of chat plus1px divider in a%ipx owner', owner => {
    const bounds=workspacePanelBounds(owner, 960);
    expect(bounds.stacked).toBe(false);expect(bounds.width).toBeLessThanOrEqual(720);
    expect(owner-bounds.width-1).toBeGreaterThanOrEqual(420);
    expect(bounds.width).toBeGreaterThanOrEqual(280);
  });
  it('switches to a full-width stack below the combined minimums', () => {
    expect(workspacePanelBounds(700,520)).toEqual({stacked:true,minimum:700,maximum:700,width:700});
  });
  it('bounds both pointer extremes and invalid saved widths', () => {
    expect(workspacePanelBounds(1000,-1).width).toBe(280);
    expect(workspacePanelBounds(1000,960).width).toBe(579);
    expect(workspacePanelBounds(1000,Number.NaN).width).toBe(520);
    expect(workspacePanelBounds(Number.NaN,520).width).toBe(0);
  });
});
