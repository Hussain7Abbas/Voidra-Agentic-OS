export type BrowserTabState = {
  id: string;
  workspaceId: string;
  sessionId: string;
  url: string;
  title: string;
  documentId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  crashed: boolean;
  control: "user" | "agent" | "takeover";
  assignedTaskId: string | null;
  blockedReason: string | null;
};

export type BrowserBounds = { x: number; y: number; width: number; height: number };

export type BrowserAction =
  | { kind: "navigate"; url: string }
  | { kind: "read" }
  | { kind: "click"; selector: string }
  | { kind: "type"; selector: string; text: string }
  | { kind: "select"; selector: string; value: string }
  | { kind: "wait"; selector: string; timeoutMs?: number };

export type BrowserActionResult = {
  documentId: string;
  url: string;
  title: string;
  text?: string;
  uncertain?: boolean;
};

export type ArtifactState = {
  id: string;
  workspaceId: string;
  runId: string | null;
  name: string;
  entryFile: string;
  sourceNoteIds: string[];
  files: string[];
  revision: string;
  createdAt: string;
  updatedAt: string;
};

export type ArtifactSource = { artifact: ArtifactState; path: string; content: string };
