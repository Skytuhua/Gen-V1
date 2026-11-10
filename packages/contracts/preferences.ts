import { z } from 'zod';

const font = z.enum(['system', 'Inter', 'Arial', 'Georgia']);
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
