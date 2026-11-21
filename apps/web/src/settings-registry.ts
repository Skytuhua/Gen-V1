import type {SettingsInventoryRow} from './settings-inventory';

type SettingPlatform = 'all' | 'desktop' | 'browser';
/** A supported setting with the metadata needed to search it and navigate to a real target. */
export interface SupportedSettingRow extends SettingsInventoryRow {
 group: string;
 targetId: string;
 platform: SettingPlatform;
 sectionLabel: string;
}

// Purpose groups for the supported categories (kept independent of the raw section ids).
export const GROUPS: Record<string, string> = {
 general: 'Basics', appearance: 'Look & feel', chat: 'Conversation', providers: 'Models & accounts',
 projects: 'Projects & working copies', diffs: 'Source control', skills: 'Skills & integrations',
 notifications: 'Notifications & usage', browser: 'Browser', keybindings: 'Keyboard', maintenance: 'Data & recovery', about: 'About & licenses',
};
// Rows whose effect only exists on one platform; everything else is cross-platform.
const PLATFORM_OVERRIDES: Record<string, SettingPlatform> = { 'quick-ask-enabled': 'desktop', 'quick-ask-shortcut': 'desktop' };

export function buildSupportedSettings(rows: readonly SettingsInventoryRow[], sections: readonly (readonly [string, string])[]): SupportedSettingRow[] {
 const labels = Object.fromEntries(sections);
 return rows.map(row => ({
  ...row,
  group: GROUPS[row.section] ?? labels[row.section] ?? row.section,
  targetId: row.id,
  platform: PLATFORM_OVERRIDES[row.id] ?? 'all',
  sectionLabel: labels[row.section] ?? row.section,
 }));
}

/** One token rule for the index, the result count and the rendered targets: every token must
 * match the title, terms, section label or group, and the row must be available on the platform. */
export function searchSettings(query: string, rows: readonly SupportedSettingRow[], platform: 'browser' | 'desktop'): SupportedSettingRow[] {
 const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 if (!tokens.length) return [];
 return rows.filter(row => (row.platform === 'all' || row.platform === platform)
  && tokens.every(token => `${row.title} ${row.terms} ${row.sectionLabel} ${row.group}`.toLowerCase().includes(token)));
}
