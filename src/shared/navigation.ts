export const sectionIds = ["today", "assistant", "notes", "graph", "browser", "mac", "jobs", "remote", "settings"] as const;
export type SectionId = (typeof sectionIds)[number];
