export const sectionIds = ["today", "assistant", "notes", "graph", "browser", "jobs", "settings"] as const;
export type SectionId = (typeof sectionIds)[number];
