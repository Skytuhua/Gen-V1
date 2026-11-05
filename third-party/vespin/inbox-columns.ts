// Adapted from Vespin, Copyright 2026 Stage Inc. Apache-2.0.
// Modifications: retain only dependency-free column selection; export the selector.
// See README.md, LICENSE and NOTICE in this directory.

export const INBOX_COLUMNS = {
  /** The list and the item beside it. */
  BOTH: "both",
  /** The list alone, the whole Inbox wide. */
  LIST: "list",
  /** The item alone, the whole Inbox wide, under a way back to the list. */
  ITEM: "item",
} as const;

export type InboxColumnsShown = (typeof INBOX_COLUMNS)[keyof typeof INBOX_COLUMNS];

export function shownColumns(single: boolean, chosen: string | undefined): InboxColumnsShown {
  if (!single) return INBOX_COLUMNS.BOTH;
  return chosen === undefined ? INBOX_COLUMNS.LIST : INBOX_COLUMNS.ITEM;
}

// From packages/panel/src/column-split.ts. Preserve its measured-container hysteresis.
export const COLUMN_SPLIT = { ENTER: 860, LEAVE: 892 } as const;
export const LIST_SHARE = 0.35;
export function oneColumn(width: number, was: boolean): boolean {
  return width < (was ? COLUMN_SPLIT.LEAVE : COLUMN_SPLIT.ENTER);
}
