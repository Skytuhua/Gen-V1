import { describe, expect, it } from 'vitest';
import { capabilityEnabled, capabilityFlagEnvName, configureHostCapabilityFlags, type CapabilityFlagKey } from '../packages/core/capability-flags.ts';
import { getPreferences, mergePreferences } from '../packages/contracts/preferences.ts';
import { settingVisible } from '../apps/web/src/settings-registry.ts';

describe('media.imageGenerationV1 flag and Image generation setting (#1311 T02)', () => {
  it('lists the flag with default off and keeps unknown-key rejection', () => {
    const restore = configureHostCapabilityFlags({});
    try {
      expect(capabilityEnabled('media.imageGenerationV1')).toBe(false);
      expect(capabilityFlagEnvName('media.imageGenerationV1')).toBe('HARNESS_FLAG_MEDIA_IMAGE_GENERATION_V1');
      expect(() => configureHostCapabilityFlags({ 'media.nopeV1': true } as unknown as Record<CapabilityFlagKey, boolean>)).toThrow();
    } finally { restore(); }
  });

  it('hides the Image generation setting until the host reports the flag on', () => {
    const row = { id: 'image-generation' };
    expect(settingVisible(row, {})).toBe(false);
    expect(settingVisible(row, { 'media.imageGenerationV1': false })).toBe(false);
    expect(settingVisible(row, { 'media.imageGenerationV1': true })).toBe(true);
    expect(settingVisible({ id: 'send-shortcut' }, {})).toBe(true);
  });

  it('defaults the preference on and persists a toggle through the merge path', () => {
    const base = getPreferences({});
    expect(base.imageGeneration).toBe(true);
    expect(mergePreferences(base, { imageGeneration: false }).imageGeneration).toBe(false);
    expect(mergePreferences(base, {}).imageGeneration).toBe(true);
  });
});
