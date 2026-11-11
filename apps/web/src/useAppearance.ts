import { useEffect } from 'react';
import { PROJECT_PALETTE, getPreferences, type UiPreferences } from '../../../packages/contracts/preferences.ts';
import './appearance.css';

export type AppearancePreferences = Pick<UiPreferences, 'appearanceAccent' | 'backgroundStyle' | 'backgroundImage' | 'backgroundOpacity'> & Partial<UiPreferences>;

/** All image input is validated raster data. Remote URLs and SVG never become CSS. */
export function applyAppearance(preferences: AppearancePreferences): void {
  const parsed = getPreferences({ preferences });
  const root = document.documentElement;
  root.dataset.appearanceAccent = parsed.appearanceAccent;
  root.dataset.workspaceBackground = parsed.backgroundStyle;
  root.style.setProperty('--project-accent', parsed.customAccent ?? PROJECT_PALETTE[parsed.appearanceAccent]);
  root.style.setProperty('--project-accent-ink', parsed.customAccent ?? { blue: '#3151D6', violet: '#7530CE', cyan: '#007888', orange: '#A34708', rose: '#BC2850', green: '#087748' }[parsed.appearanceAccent]);
  const accent = root.style.getPropertyValue('--project-accent-ink');
  const rgb = [1,3,5].map(index=>parseInt(accent.slice(index,index+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  const luminance = rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  root.style.setProperty('--accent-ink', luminance > .179 ? '#000000' : '#FFFFFF');
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
