import { z } from 'zod';

const font = z.enum(['system', 'Inter', 'Arial', 'Georgia']);
export const PROJECT_PALETTE = { blue: '#4F6EFF', violet: '#9855F7', cyan: '#00A6BD', orange: '#F07524', rose: '#E84876', green: '#16A36D' } as const;
export type ProjectAccent = keyof typeof PROJECT_PALETTE;
const projectColorKey = z.string().max(1000).refine(value => {
  try {
    const parts: unknown = JSON.parse(value);
    return Array.isArray(parts) && (parts.length === 2 && parts[0] === 'local' || parts.length === 4 && parts[0] === 'plugin') && parts.slice(1).every(part => typeof part === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(part));
  } catch { return false; }
}, 'Project colors need an exact authority and project identity.');
const rasterImage = z.string().max(2_800_000).refine(value => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  return Boolean(match && match[2]!.length % 4 === 0 && (match[1] === 'png' && match[2]!.startsWith('iVBORw0KGgo') || match[1] === 'jpeg' && match[2]!.startsWith('/9j/') || match[1] === 'webp' && match[2]!.startsWith('UklGR')));
}, 'Choose a PNG, JPEG or WebP image smaller than 2 MB.');
const quietHours = z.strictObject({ enabled: z.boolean(), start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/) });
const keybindings = z.strictObject({
  search: z.string().min(1).max(80), newThread: z.string().min(1).max(80),
  toggleSidebar: z.string().min(1).max(80), toggleRightPanel: z.string().min(1).max(80),
  openSettings: z.string().min(1).max(80), stop: z.string().min(1).max(80),
});
export const preferencesSchema = z.strictObject({
  chatWidth: z.enum(['comfortable', 'wide', 'full']), fontSize: z.number().int().min(12).max(20),
  interfaceFont: font, promptFont: font, codeFont: z.enum(['monospace', 'Consolas', 'Cascadia Code']),
  contrast: z.enum(['normal', 'high']), panelAnimations: z.boolean(), motionDuration: z.number().int().min(0).max(400),
  sendShortcut: z.enum(['enter', 'mod-enter-multiline', 'mod-enter']), composerPredictions: z.boolean(),
  projectGrouping: z.boolean(), projectOrder: z.enum(['recent', 'created', 'manual']), showWorkingSection: z.boolean(),
  timeFormat: z.enum(['system', '12h', '24h']), archiveConfirmation: z.boolean(), deleteConfirmation: z.boolean(), unpinConfirmation: z.boolean(),
  threadNotifications: z.enum(['off', 'notifications', 'sound', 'both']), inAppNotifications: z.boolean(),
  notificationVolume: z.number().finite().min(0).max(1), notificationPreview: z.enum(['full', 'title', 'private']), notificationQuietHours: quietHours,
  appearanceAccent: z.enum(['blue', 'violet', 'cyan', 'orange', 'rose', 'green']),
  backgroundStyle: z.enum(['solid', 'graphite', 'midnight', 'image']), backgroundImage: rasterImage.nullable(), backgroundOpacity: z.number().finite().min(0).max(1),
  projectColors: z.record(projectColorKey, z.enum(['#4F6EFF', '#9855F7', '#00A6BD', '#F07524', '#E84876', '#16A36D'])).refine(value => Object.keys(value).length <= 200, 'Keep at most 200 project color overrides.'),
  diffLayout: z.enum(['stacked', 'split']), hideWhitespace: z.boolean(), diffDefaultExpanded: z.boolean(), diffColors: z.enum(['red-green', 'blue-orange']),
  showThreadDetails: z.boolean(), showComposerContext: z.boolean(), showUsageFooter:z.boolean(), wordWrap: z.boolean(), keybindings,
  learningEnabled:z.boolean(),learningApproval:z.boolean(),learningInterval:z.number().int().min(0).max(100),skillCurator:z.boolean(),
});
export type UiPreferences = z.infer<typeof preferencesSchema>;
export type PreferencePatch = Partial<Omit<UiPreferences, 'keybindings'>> & { keybindings?: Partial<UiPreferences['keybindings']> };
export const DEFAULT_PREFERENCES: UiPreferences = {
  chatWidth: 'wide', fontSize: 14, interfaceFont: 'system', promptFont: 'system', codeFont: 'monospace',
  contrast: 'normal', panelAnimations: true, motionDuration: 220, sendShortcut: 'enter', composerPredictions: false,
  projectGrouping: true, projectOrder: 'recent', showWorkingSection: true, timeFormat: 'system',
  archiveConfirmation: true, deleteConfirmation: true, unpinConfirmation: false, threadNotifications: 'off', inAppNotifications: true,
  notificationVolume: .35, notificationPreview: 'title', notificationQuietHours: { enabled: false, start: '22:00', end: '08:00' },
  appearanceAccent: 'blue', backgroundStyle: 'solid', backgroundImage: null, backgroundOpacity: .18, projectColors: {},
  diffLayout: 'split', hideWhitespace: false, diffDefaultExpanded: true, diffColors: 'red-green',
  showThreadDetails: true, showComposerContext: true, showUsageFooter:true, wordWrap: true,
  learningEnabled:true,learningApproval:false,learningInterval:10,skillCurator:true,
  keybindings: { search: 'Ctrl+K', newThread: 'Ctrl+Shift+O', toggleSidebar: 'Ctrl+B', toggleRightPanel: 'Ctrl+Shift+B', openSettings: 'Ctrl+Comma', stop: 'Escape' },
};
const patchSchema = preferencesSchema.partial().extend({ keybindings: keybindings.partial().optional() }).strict();
export function mergePreferences(current: UiPreferences, patch: unknown): UiPreferences {
  const next = patchSchema.parse(patch);
  return preferencesSchema.parse({ ...current, ...next, keybindings: { ...current.keybindings, ...next.keybindings } });
}
export function getPreferences(settings: { preferences?: PreferencePatch }): UiPreferences {
  return mergePreferences(DEFAULT_PREFERENCES, settings.preferences ?? {});
}
