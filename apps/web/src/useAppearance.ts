import { useEffect } from 'react';
import { PROJECT_ACCENT_INK, PROJECT_PALETTE, accentInk, getPreferences, type UiPreferences } from '../../../packages/contracts/preferences.ts';
import './appearance.css';

export type AppearancePreferences = Pick<UiPreferences, 'appearanceAccent' | 'backgroundStyle' | 'backgroundImage' | 'backgroundOpacity'> & Partial<UiPreferences>;

/** All image input is validated raster data. Remote URLs and SVG never become CSS. */
export function applyAppearance(preferences: AppearancePreferences): void {
  const parsed = getPreferences({ preferences });
  const root = document.documentElement;
  root.dataset.appearanceAccent = parsed.appearanceAccent;
  root.dataset.workspaceBackground = parsed.backgroundStyle;
  root.style.setProperty('--project-accent', parsed.customAccent ?? PROJECT_PALETTE[parsed.appearanceAccent]);
  const solid = parsed.customAccent ?? PROJECT_ACCENT_INK[parsed.appearanceAccent];
  root.style.setProperty('--project-accent-ink', solid);
  root.style.setProperty('--accent-ink', accentInk(solid));
  root.dataset.density = parsed.density;
  root.dataset.motion = parsed.motion;
  root.style.setProperty('--control-radius', parsed.controlRadius + 'px');
  root.style.setProperty('--chat-font-size', parsed.chatFontSize + 'px');
  root.style.setProperty('--code-font-size', parsed.codeFontSize + 'px');
  root.style.setProperty('--motion-speed', String(parsed.motionSpeed));
  root.style.setProperty('--settings-row-height', ({compact:32,comfortable:36,touch:44}[parsed.density]) + 'px');
  const interfaceFont = parsed.interfaceFont === 'system' ? '-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif' : parsed.interfaceFont === 'Inter' ? '"Inter Variable", sans-serif' : parsed.interfaceFont;
  root.style.setProperty('--appearance-interface-font', interfaceFont);
  for (const shell of root.querySelectorAll<HTMLElement>('.app-shell')) {
    shell.dataset.chatWidth = parsed.chatWidth;
    shell.dataset.contrast = parsed.contrast;
    shell.dataset.wordWrap = String(parsed.wordWrap);
    shell.dataset.panelAnimations = String(parsed.panelAnimations && parsed.motion === 'system');
    shell.style.setProperty('--interface-font', interfaceFont);
    shell.style.setProperty('--interface-font-size', parsed.uiFontSize + 'px');
    shell.style.setProperty('--prompt-font', parsed.promptFont === 'system' ? 'inherit' : parsed.promptFont === 'Inter' ? '"Inter Variable", sans-serif' : parsed.promptFont);
    shell.style.setProperty('--code-font', parsed.codeFont);
    shell.style.setProperty('--panel-motion', (parsed.panelAnimations && parsed.motion === 'system' ? parsed.motionDuration / parsed.motionSpeed : 0) + 'ms');
  }
  const timings = {hover:120,press:80,'panel-enter':220,'panel-exit':180,tab:140,insert:180,remove:140,stagger:30,status:160,success:240,'popup-enter':180,'popup-exit':140,'toast-enter':200,'toast-exit':160,'tooltip-enter':160,'tooltip-exit':120};
  for (const [name, duration] of Object.entries(timings)) root.style.setProperty('--ui-motion-' + name, (parsed.motion === 'off' ? 0 : duration / parsed.motionSpeed) + 'ms');
  root.style.setProperty('--workspace-image-opacity', String(parsed.backgroundOpacity));
  root.style.setProperty('--workspace-image', parsed.backgroundStyle === 'image' && parsed.backgroundImage ? `url("${parsed.backgroundImage}")` : 'none');
}

export function useAppearance(preferences: UiPreferences): void {
  const fields=['appearanceAccent','customAccent','backgroundStyle','backgroundImage','backgroundOpacity','density','interfaceFont','promptFont','codeFont','uiFontSize','chatFontSize','codeFontSize','fontSize','controlRadius','chatWidth','wordWrap','contrast','motion','motionSpeed','panelAnimations','motionDuration'] as const;
  const key = JSON.stringify(fields.map(field=>preferences[field]));
  useEffect(() => { applyAppearance(preferences); }, [key]);
}
