import { z } from "zod";
import type { ArtifactCapabilityRequest, ArtifactSecurityFinding, ArtifactSecurityReview } from "../shared/browser-contracts";

const capabilitySchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,79}$/),
  operation: z.enum(["fs.readText", "fs.list", "fs.writeStagedText", "mcp.callTool", "mcp.readResource"]),
  reason: z.string().trim().min(8).max(500),
  scope: z.record(z.string(), z.unknown()),
  userPresence: z.boolean(),
}).strict();

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  entry: z.literal("src/Artifact.tsx"),
  artifactUiVersion: z.literal("1"),
  layout: z.object({ minWidth: z.number().int().min(240).max(2000), idealWidth: z.number().int().min(240).max(3000), minHeight: z.number().int().min(160).max(2000) }).strict(),
  requestedCapabilities: z.array(capabilitySchema).max(20),
  producer: z.object({ kind: z.enum(["agent", "user", "import", "legacy-conversion"]), name: z.string().trim().min(1).max(120), model: z.string().trim().max(200).nullable().optional() }).strict().optional(),
  inputs: z.object({ noteIds: z.array(z.uuid()).max(100).default([]), runIds: z.array(z.uuid()).max(100).default([]), workspacePaths: z.array(z.string().trim().min(1).max(1000)).max(100).default([]) }).strict().optional(),
  output: z.object({ kind: z.literal("component"), entryFile: z.literal("dist/index.html") }).strict().optional(),
  assets: z.array(z.object({ path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/).max(1000), mediaType: z.string().trim().min(1).max(100), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(100).optional(),
  accessibility: z.object({ requiredStates: z.array(z.enum(["empty", "error", "stale", "permission", "review"])).max(5), keyboardActions: z.array(z.string().trim().min(1).max(200)).max(50) }).strict().optional(),
  networkPolicy: z.literal("broker-only").optional(),
  sdkVersion: z.literal("1").optional(),
}).strict();

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

const allowedImports = new Set(["react", "@voidra/artifact-ui", "@voidra/artifact-sdk"]);
const forbiddenPatterns: Array<{ pattern: RegExp; category: string; severity: ArtifactSecurityFinding["severity"]; remediation: string; evidence?: string }> = [
  { pattern: /\b(?:eval|Function)\s*\(/, category: "dynamic-code", severity: "critical", remediation: "Remove string-to-code execution." },
  { pattern: /dangerouslySetInnerHTML/, category: "html-injection", severity: "high", remediation: "Render structured React children instead of raw HTML." },
  { pattern: /\b(?:window\.)?(?:electron|require|process)\b/, category: "host-access", severity: "critical", remediation: "Use the typed artifact SDK instead of host or Node globals." },
  { pattern: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b/, category: "direct-network", severity: "high", remediation: "Use a reviewed MCP/application capability through the broker." },
  { pattern: /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/, category: "ambient-storage", severity: "high", remediation: "Use declared host storage/data capabilities." },
  { pattern: /\b(?:Worker|SharedWorker|ServiceWorker|WebAssembly)\b/, category: "unbounded-runtime", severity: "high", remediation: "Remove workers or executable binary runtimes." },
  { pattern: /\b(?:window\.open|location\s*=|location\.assign|location\.replace)\b/, category: "navigation", severity: "high", remediation: "Use host navigation actions exposed by the SDK." },
  { pattern: /@import|:global|\bhtml\s*\{|\bbody\s*\{|\*\s*\{/, category: "global-style", severity: "medium", remediation: "Use artifact UI primitives and root-scoped styles only." },
  { pattern: /\b(?:setInterval|requestAnimationFrame)\s*\(|\bwhile\s*\(\s*true\s*\)/, category: "resource-abuse", severity: "high", remediation: "Use bounded event-driven interactions without perpetual loops or timers." },
  { pattern: /\b(?:postMessage|BroadcastChannel)\s*\(/, category: "message-forgery", severity: "high", remediation: "Use only the typed artifact SDK request channel." },
  { pattern: /position\s*:\s*fixed|z-index\s*:\s*[1-9]\d{4,}/i, category: "host-impersonation", severity: "medium", remediation: "Keep content inside the artifact canvas and avoid host-overlay styling." },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|token|secret|password)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i, category: "credential-material", severity: "critical", remediation: "Remove credential-shaped literals; artifacts never receive secrets.", evidence: "Potential credential-shaped literal (redacted)." },
  { pattern: /(?:atob|fromCharCode)\s*\(|[A-Za-z0-9+/]{800,}={0,2}/, category: "obfuscation", severity: "high", remediation: "Use readable source without encoded or reconstructed executable content." },
];

function importSpecifiers(source: string) {
  const results: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g)) results.push(match[1]!);
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) results.push(match[1]!);
  return results;
}

function capabilityFindings(capabilities: ArtifactCapabilityRequest[]) {
  const findings: ArtifactSecurityFinding[] = [];
  const seen = new Set<string>();
  for (const capability of capabilities) {
    if (seen.has(capability.id)) findings.push({ severity: "high", category: "duplicate-capability", file: "artifact.json", evidence: capability.id, remediation: "Use a unique capability ID." });
    seen.add(capability.id);
    if (capability.operation === "fs.writeStagedText" && !capability.userPresence) findings.push({ severity: "high", category: "background-write", file: "artifact.json", evidence: capability.id, remediation: "Require user presence for staged writes." });
    if (capability.operation.startsWith("fs.") && typeof capability.scope.path !== "string" && !Array.isArray(capability.scope.paths)) findings.push({ severity: "high", category: "unbounded-filesystem", file: "artifact.json", evidence: capability.id, remediation: "Declare exact workspace-relative path scopes." });
    if (capability.operation.startsWith("mcp.") && (typeof capability.scope.connectionId !== "string" || typeof capability.scope.name !== "string" || typeof capability.scope.serverFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(capability.scope.serverFingerprint) || typeof capability.scope.schemaDigest !== "string" || !/^[a-f0-9]{64}$/.test(capability.scope.schemaDigest))) findings.push({ severity: "high", category: "unbounded-mcp", file: "artifact.json", evidence: capability.id, remediation: "Pin the MCP connection, tool/resource name, server fingerprint, and schema digest." });
  }
  return findings;
}

export class ArtifactSecurityReviewAgent {
  readonly reviewer = "voidra-local-security-agent/v1";
  readonly policyVersion = "artifact-policy-1";

  review(input: { manifest: unknown; files: Record<string, string>; sourceDigest: string; bundleDigest: string | null }): ArtifactSecurityReview {
    const reviewedAt = new Date().toISOString();
    const parsed = artifactManifestSchema.safeParse(input.manifest);
    if (!parsed.success) {
      return { reviewer: this.reviewer, policyVersion: this.policyVersion, sourceDigest: input.sourceDigest, bundleDigest: input.bundleDigest, reviewedAt, verdict: "incomplete", findings: [{ severity: "high", category: "manifest", file: "artifact.json", evidence: parsed.error.issues.map((issue) => issue.message).join("; "), remediation: "Fix the manifest schema and request a new review." }], filesExamined: Object.keys(input.files).sort() };
    }

    const findings: ArtifactSecurityFinding[] = [...capabilityFindings(parsed.data.requestedCapabilities)];
    for (const [file, source] of Object.entries(input.files)) {
      if (source.length > 1_000_000) findings.push({ severity: "high", category: "oversized-source", file, evidence: `${source.length} characters`, remediation: "Reduce the source file below the artifact limit." });
      for (const specifier of importSpecifiers(source)) {
        if (!allowedImports.has(specifier)) findings.push({ severity: "critical", category: "forbidden-import", file, evidence: specifier, remediation: "Import only React or the versioned Voidra artifact facades." });
      }
      for (const rule of forbiddenPatterns) if (rule.pattern.test(source)) findings.push({ severity: rule.severity, category: rule.category, file, evidence: rule.evidence ?? source.match(rule.pattern)?.[0]?.slice(0, 160) ?? rule.pattern.source, remediation: rule.remediation });
    }
    const blocking = findings.some((finding) => finding.severity === "critical" || finding.severity === "high" || finding.severity === "medium");
    return { reviewer: this.reviewer, policyVersion: this.policyVersion, sourceDigest: input.sourceDigest, bundleDigest: input.bundleDigest, reviewedAt, verdict: blocking ? "block" : findings.length ? "pass-with-low-risk-notes" : "pass", findings, filesExamined: Object.keys(input.files).sort() };
  }
}
