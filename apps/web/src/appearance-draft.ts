import type {UiPreferences} from '../../../packages/contracts/preferences';

export const appearanceKeys = ['appearanceAccent', 'customAccent', 'density', 'interfaceFont', 'promptFont', 'codeFont', 'fontSize', 'uiFontSize', 'chatFontSize', 'codeFontSize', 'controlRadius', 'chatWidth', 'wordWrap', 'contrast', 'motion', 'motionSpeed', 'panelAnimations', 'motionDuration'] as const;
export const appearancePatch = (preferences: UiPreferences) => Object.fromEntries(appearanceKeys.map(key => [key, preferences[key]])) as Partial<UiPreferences>;

/** Overlay the latest acknowledged preferences onto the draft for every field the user has not
 * edited, so an external update to an untouched field survives while an edited field is kept (AUD-08). */
export function rebaseAppearanceDraft(draft: UiPreferences, latest: UiPreferences, edited: ReadonlySet<string>): UiPreferences {
 const untouched = Object.fromEntries(appearanceKeys.filter(key => !edited.has(key)).map(key => [key, latest[key]]));
 return {...draft, ...untouched} as UiPreferences;
}

/** Send only the fields the user actually edited; untouched fields keep their latest acknowledged
 * values when the host merges the patch, instead of being clobbered by a stale full draft (AUD-08). */
export function editedAppearancePatch(draft: UiPreferences, edited: ReadonlySet<string>): Partial<UiPreferences> {
 return Object.fromEntries(appearanceKeys.filter(key => edited.has(key)).map(key => [key, draft[key]])) as Partial<UiPreferences>;
}
