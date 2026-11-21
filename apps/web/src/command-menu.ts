import type {LucideIcon} from 'lucide-react';

export type CommandGroup = 'recent' | 'actions' | 'panels' | 'projects' | 'threads' | 'skills' | 'settings';
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = ['recent', 'actions', 'threads', 'panels', 'projects', 'skills', 'settings'];
export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  recent: 'Recent', actions: 'Actions', threads: 'Threads', panels: 'Panels', projects: 'Projects', skills: 'Skills', settings: 'Settings',
};

export interface CommandItem {
  id: string;
  group: Exclude<CommandGroup, 'recent'>;
  label: string;
  detail?: string;
  keywords?: readonly string[];
  icon?: LucideIcon;
  bindingId?: string;
  disabledReason?: string;
  remember?: boolean;
  run(): void | Promise<void>;
}

const RECENT_KEY = 'command-menu-recent';
const RECENT_MAX = 5;

/** NFD-normalize, strip combining marks, lower-case and collapse whitespace. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const words = (text: string): string[] => normalize(text).split(' ').filter(Boolean);

const wordPrefixScore = (field: string, word: string, atStart: number, elsewhere: number): number => {
  const parts = field.split(' ');
  if (parts.some(part => part.startsWith(word))) return parts[0].startsWith(word) ? atStart : elsewhere;
  return 0;
};

const subsequence = (field: string, query: string): boolean => {
  let at = 0;
  for (const char of query) {at = field.indexOf(char, at); if (at < 0) return false; at += 1;}
  return true;
};

/** Per-word score contribution for one query word against the item; 0 = no match. */
const wordScore = (word: string, item: CommandItem): number => {
  const label = normalize(item.label);
  const prefix = wordPrefixScore(label, word, 110, 100);
  if (prefix > 0) return prefix;
  if (label.includes(word)) return 60;
  for (const keyword of item.keywords ?? []) {
    if (wordPrefixScore(normalize(keyword), word, 40, 40) > 0) return 40;
  }
  if (word.length >= 2 && subsequence(label, word)) return 20;
  return 0;
};

/** 0 = no match. Higher is better; every query word must match some field. */
export function scoreCommand(query: string, item: CommandItem): number {
  const parts = words(query);
  if (parts.length === 0) return 0;
  let total = 0;
  for (const word of parts) {
    const score = wordScore(word, item);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

export function rankCommands(query: string, items: readonly CommandItem[], limit = 50): CommandItem[] {
  const scored = items.map((item, index) => ({item, index, score: scoreCommand(query, item)})).filter(entry => entry.score > 0);
  scored.sort((a, b) =>
    b.score - a.score ||
    COMMAND_GROUP_ORDER.indexOf(a.item.group) - COMMAND_GROUP_ORDER.indexOf(b.item.group) ||
    a.index - b.index);
  return scored.slice(0, limit).map(entry => entry.item);
}

/** Ordered, non-empty groups following COMMAND_GROUP_ORDER. */
export function groupCommands(items: readonly CommandItem[]): {group: CommandGroup; items: CommandItem[]}[] {
  const groups: {group: CommandGroup; items: CommandItem[]}[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const members = items.filter(item => item.group === group);
    if (members.length > 0) groups.push({group, items: members});
  }
  return groups;
}

/** Recent command ids: most recent first, max 5, non-string entries dropped. */
export function readRecent(storage: Pick<Storage, 'getItem'>): string[] {
  try {
    const raw = storage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string').slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Move `id` to the front, dedupe, cap at 5; quota/denied errors are swallowed. */
export function writeRecent(storage: Pick<Storage, 'getItem' | 'setItem'>, id: string): void {
  try {
    const ids = [id, ...readRecent(storage).filter(existing => existing !== id)].slice(0, RECENT_MAX);
    storage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Storage quota or access errors must not break command execution.
  }
}
