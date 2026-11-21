export interface SidebarSectionV1 { id: string; name: string; order: number; createdAt: string; updatedAt: string }
export const SIDEBAR_SECTION_LIMITS = { maxSections: 50, maxName: 60 } as const;

export type SidebarSectionCommandPayloads = {
  'sidebar.section.create': { name: string; afterOrder?: number };
  'sidebar.section.rename': { sectionId: string; name: string };
  'sidebar.section.move': { sectionId: string; order: number };
  'sidebar.section.delete': { sectionId: string };
  'sidebar.section.restore': { section: SidebarSectionV1 };
};
