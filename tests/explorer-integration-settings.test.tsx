import {describe, expect, it} from 'vitest';
import {
  explorerIntegrationRowModel,
  EXPLORER_INTEGRATION_HELPER,
  EXPLORER_INTEGRATION_PARTIAL,
  EXPLORER_INTEGRATION_READ_FAILED,
  EXPLORER_INTEGRATION_TITLE,
  EXPLORER_INTEGRATION_WRITE_FAILED,
} from '../apps/web/src/explorer-integration-settings';
import { SETTINGS_ROWS, SETTINGS_SECTIONS } from '../apps/web/src/Settings';
import { buildSupportedSettings, searchSettings } from '../apps/web/src/settings-registry';

const status = (state: 'enabled' | 'disabled' | 'partial' | 'unknown', marker: 0 | 1 | null = null) => ({ state, enabled: state === 'enabled', marker });
const model = explorerIntegrationRowModel;

describe('explorerIntegrationRowModel — T08 state table', () => {
  it('enabled state: switch on, normal helper, no retry', () => {
    expect(model({ status: status('enabled', 1), applying: false, failure: null })).toEqual({
      checked: true, disabled: false, helper: EXPLORER_INTEGRATION_HELPER, danger: false, retry: null,
    });
  });

  it('disabled state: switch off, normal helper', () => {
    expect(model({ status: status('disabled'), applying: false, failure: null })).toEqual({
      checked: false, disabled: false, helper: EXPLORER_INTEGRATION_HELPER, danger: false, retry: null,
    });
  });

  it('partial registration is treated as off with the repair hint appended', () => {
    const result = model({ status: status('partial'), applying: false, failure: null });
    expect(result.checked).toBe(false);
    expect(result.disabled).toBe(false);
    expect(result.helper).toBe(`${EXPLORER_INTEGRATION_HELPER} ${EXPLORER_INTEGRATION_PARTIAL}`);
    expect(result.retry).toBeNull();
  });

  it('applying keeps the actual switch position, disables, and swaps the helper — no optimistic flip', () => {
    const on = model({ status: status('enabled'), applying: true, failure: null });
    expect(on).toEqual({ checked: true, disabled: true, helper: 'Applying…', danger: false, retry: null });
    const off = model({ status: status('disabled'), applying: true, failure: null });
    expect(off.checked).toBe(false);
    expect(off.helper).toBe('Applying…');
  });

  it('write failure shows the actual read state, the danger copy and a toggle Retry', () => {
    const result = model({ status: status('enabled'), applying: false, failure: 'write' });
    expect(result).toEqual({ checked: true, disabled: false, helper: EXPLORER_INTEGRATION_WRITE_FAILED, danger: true, retry: 'toggle' });
  });

  it('read failure and unknown state show the read-failure copy and a read Retry', () => {
    for (const input of [
      { status: null, applying: false, failure: 'read' as const },
      { status: status('unknown'), applying: false, failure: null },
    ]) {
      expect(model(input)).toEqual({ checked: false, disabled: false, helper: EXPLORER_INTEGRATION_READ_FAILED, danger: true, retry: 'read' });
    }
  });

  it('first-load pending state disables the switch without an error', () => {
    expect(model({ status: null, applying: false, failure: null })).toEqual({
      checked: false, disabled: true, helper: 'Reading File Explorer registration…', danger: false, retry: null,
    });
  });

  it('precedence: applying beats write failure; failure beats partial; partial beats normal', () => {
    expect(model({ status: status('disabled'), applying: true, failure: 'write' }).helper).toBe('Applying…');
    expect(model({ status: status('partial'), applying: false, failure: 'write' }).helper).toBe(EXPLORER_INTEGRATION_WRITE_FAILED);
    expect(model({ status: status('partial'), applying: false, failure: 'read' }).helper).toBe(EXPLORER_INTEGRATION_READ_FAILED);
  });

  it('row copy matches the design spec verbatim', () => {
    expect(EXPLORER_INTEGRATION_TITLE).toBe('Show “Open in Gen V1” in File Explorer');
    expect(EXPLORER_INTEGRATION_WRITE_FAILED).toBe('Couldn’t update File Explorer — Windows refused the registry write.');
    expect(EXPLORER_INTEGRATION_READ_FAILED).toBe('Can’t tell whether the Explorer entry is registered.');
    expect(EXPLORER_INTEGRATION_PARTIAL).toBe('Registration is incomplete — turn it off and on to repair.');
  });
});

describe('Settings registration — Windows-desktop row, hidden elsewhere', () => {
  const rows = buildSupportedSettings(SETTINGS_ROWS, SETTINGS_SECTIONS);
  const row = rows.find(item => item.id === 'explorer-integration');

  it('the row exists under General with the spec title', () => {
    expect(row).toBeDefined();
    expect(row?.section).toBe('general');
    expect(row?.title).toBe(EXPLORER_INTEGRATION_TITLE);
  });

  it('is desktop-platform-gated: searchable on desktop, never on browser', () => {
    expect(row?.platform).toBe('desktop');
    expect(searchSettings('explorer', rows, 'desktop').some(item => item.id === 'explorer-integration')).toBe(true);
    expect(searchSettings('explorer', rows, 'browser').some(item => item.id === 'explorer-integration')).toBe(false);
  });
});
