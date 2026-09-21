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
  kind?: "legacy-html" | "component";
  reviewState?: "draft" | "legacy" | "quarantined" | "approved" | "blocked" | "superseded";
  sourceDigest?: string;
  bundleDigest?: string | null;
  requestedCapabilities?: ArtifactCapabilityRequest[];
  grants?: ArtifactCapabilityGrant[];
  securityReview?: ArtifactSecurityReview | null;
  semanticReview?: ArtifactSemanticReview | null;
  reviewDecision?: ArtifactReviewDecision | null;
  versions?: ArtifactVersion[];
  legacySourceId?: string | null;
};

export type ArtifactVersion = {
  sourceDigest: string;
  bundleDigest: string;
  reviewDecisionId: string;
  createdAt: string;
  snapshotRelativePath: string;
};

export type ArtifactSource = { artifact: ArtifactState; path: string; content: string };

export type ArtifactCapabilityRequest = {
  id: string;
  operation: "fs.readText" | "fs.list" | "fs.writeStagedText" | "mcp.callTool" | "mcp.readResource";
  reason: string;
  scope: Record<string, unknown>;
  userPresence: boolean;
};

export type ArtifactCapabilityGrant = ArtifactCapabilityRequest & {
  artifactDigest: string;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type ArtifactSecurityFinding = {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  file: string;
  evidence: string;
  remediation: string;
};

export type ArtifactSecurityReview = {
  reviewer: string;
  policyVersion: string;
  sourceDigest: string;
  bundleDigest: string | null;
  reviewedAt: string;
  verdict: "pass" | "pass-with-low-risk-notes" | "block" | "incomplete";
  findings: ArtifactSecurityFinding[];
  filesExamined: string[];
};

export type ArtifactSemanticReview = {
  id: string;
  reviewer: { provider: string; model: string; version: string };
  evidenceMode: "live-model" | "test-fixture";
  policyVersion: string;
  sourceDigest: string;
  bundleDigest: string;
  reviewedAt: string;
  verdict: "pass" | "pass-with-low-risk-notes" | "block" | "incomplete";
  confidence: number;
  filesExamined: string[];
  checklist: Array<{ id: string; status: "covered" | "finding" | "unresolved"; rationale: string }>;
  findings: ArtifactSecurityFinding[];
  capabilityAnalysis: Array<{ capabilityId: string; necessary: boolean; abuseCase: string; recommendedConstraint: string }>;
  unresolvedQuestions: string[];
};

export type ArtifactReviewDecision = {
  id: string;
  policyVersion: string;
  artifactId: string;
  workspaceId: string;
  sourceDigest: string;
  bundleDigest: string;
  staticReviewer: string;
  semanticReviewId: string;
  verdict: "approved" | "blocked" | "incomplete";
  rationale: string[];
  createdAt: string;
  expiresAt: string;
  keyId: string;
  previousSignature: string | null;
  signature: string;
};

export type ArtifactStagedWrite = {
  id: string;
  workspaceId: string;
  artifactId: string;
  artifactDigest: string;
  capabilityId: string;
  path: string;
  content: string;
  expectedRevision: string | null;
  state: "awaiting-review" | "applied" | "rejected" | "stale";
  createdAt: string;
  updatedAt: string;
};
