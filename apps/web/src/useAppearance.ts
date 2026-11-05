import { useEffect } from 'react';
import { PROJECT_PALETTE, preferencesSchema, type UiPreferences } from '../../../packages/contracts/preferences.ts';
import './appearance.css';

export type AppearancePreferences = Pick<UiPreferences, 'appearanceAccent' | 'backgroundStyle' | 'backgroundImage' | 'backgroundOpacity'>;

/** All image input is validated raster data. Remote URLs and SVG never become CSS. */
export function applyAppearance(preferences: AppearancePreferences): void {
  const parsed = preferencesSchema.pick({ appearanceAccent: true, backgroundStyle: true, backgroundImage: true, backgroundOpacity: true }).parse(preferences);
  const root = document.documentElement;
  root.dataset.appearanceAccent = parsed.appearanceAccent;
  root.dataset.workspaceBackground = parsed.backgroundStyle;
  root.style.setProperty('--project-accent', PROJECT_PALETTE[parsed.appearanceAccent]);
  root.style.setProperty('--project-accent-ink', { blue: '#3151D6', violet: '#7530CE', cyan: '#007888', orange: '#A34708', rose: '#BC2850', green: '#087748' }[parsed.appearanceAccent]);
  root.style.setProperty('--workspace-image-opacity', String(parsed.backgroundOpacity));
  root.style.setProperty('--workspace-image', parsed.backgroundStyle === 'image' && parsed.backgroundImage ? `url("${parsed.backgroundImage}")` : 'none');
}

export function useAppearance(preferences: UiPreferences): void {
  const { appearanceAccent, backgroundStyle, backgroundImage, backgroundOpacity } = preferences;
  useEffect(() => { applyAppearance({ appearanceAccent, backgroundStyle, backgroundImage, backgroundOpacity }); }, [appearanceAccent, backgroundStyle, backgroundImage, backgroundOpacity]);
}
