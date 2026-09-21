import { describe, expect, it } from "vitest";
import { ArtifactSecurityReviewAgent } from "../../src/domain/artifact-security";

const id = "018f0f73-89db-7a63-a1b2-5d46f598ed01";
const baseManifest = {
  schemaVersion: 1 as const,
  id,
  name: "Safe report",
  version: "1.0.0",
  entry: "src/Artifact.tsx" as const,
  artifactUiVersion: "1" as const,
  layout: { minWidth: 320, idealWidth: 720, minHeight: 320 },
  requestedCapabilities: [],
};

describe("ArtifactSecurityReviewAgent", () => {
  it("approves constrained React components using only artifact facades", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: baseManifest,
      files: { "src/Artifact.tsx": 'import { Canvas, Module } from "@voidra/artifact-ui"; export default function Artifact(){ return <Canvas title="Safe"><Module label="DATA">Ready</Module></Canvas>; }' },
      sourceDigest: "a".repeat(64),
      bundleDigest: "b".repeat(64),
    });
    expect(review.verdict).toBe("pass");
    expect(review.findings).toEqual([]);
  });

  it("blocks host, direct network, raw HTML, and arbitrary package access", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: baseManifest,
      files: { "src/Artifact.tsx": 'import x from "unknown-package"; export default function Artifact(){ fetch("https://example.com"); return <div dangerouslySetInnerHTML={{__html: process.env.SECRET}} />; }' },
      sourceDigest: "c".repeat(64),
      bundleDigest: null,
    });
    expect(review.verdict).toBe("block");
    expect(review.findings.map((finding) => finding.category)).toEqual(expect.arrayContaining(["forbidden-import", "direct-network", "html-injection", "host-access"]));
  });

  it("requires exact scopes and user presence for effectful capabilities", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: { ...baseManifest, requestedCapabilities: [
        { id: "write", operation: "fs.writeStagedText", reason: "Save the reviewed report output", scope: {}, userPresence: false },
        { id: "tool", operation: "mcp.callTool", reason: "Read one connected tool result", scope: {}, userPresence: true },
      ] },
      files: { "src/Artifact.tsx": 'export default function Artifact(){ return <div />; }' },
      sourceDigest: "d".repeat(64),
      bundleDigest: null,
    });
    expect(review.verdict).toBe("block");
    expect(review.findings.map((finding) => finding.category)).toEqual(expect.arrayContaining(["background-write", "unbounded-filesystem", "unbounded-mcp"]));
  });

  it("fails closed when the manifest is incomplete", () => {
    const review = new ArtifactSecurityReviewAgent().review({ manifest: { name: "missing" }, files: {}, sourceDigest: "e".repeat(64), bundleDigest: null });
    expect(review.verdict).toBe("incomplete");
    expect(review.findings[0]?.category).toBe("manifest");
  });

  it("redacts credential evidence and blocks obfuscation, perpetual work, forged messaging, and host overlays", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: baseManifest,
      files: { "src/Artifact.tsx": 'const apiKey="super-secret-value-123456"; setInterval(()=>postMessage(apiKey),1); export default function Artifact(){return <div style={{position:"fixed"}}>{atob("YQ==")}</div>}' },
      sourceDigest: "f".repeat(64), bundleDigest: null,
    });
    expect(review.verdict).toBe("block");
    expect(review.findings.map(({ category }) => category)).toEqual(expect.arrayContaining(["credential-material", "resource-abuse", "message-forgery", "obfuscation"]));
    expect(review.findings.find(({ category }) => category === "credential-material")?.evidence).toBe("Potential credential-shaped literal (redacted).");
    expect(JSON.stringify(review)).not.toContain("super-secret-value-123456");
  });

  it("requires MCP server and schema pins in every requested capability", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: { ...baseManifest, requestedCapabilities: [{ id: "mcp", operation: "mcp.callTool", reason: "Read the scoped project status", scope: { connectionId: id, name: "status" }, userPresence: true }] },
      files: { "src/Artifact.tsx": "export default function Artifact(){return <div/>}" }, sourceDigest: "1".repeat(64), bundleDigest: null,
    });
    expect(review.findings).toEqual(expect.arrayContaining([expect.objectContaining({ category: "unbounded-mcp" })]));
  });

  it("accepts exact filesystem scopes and fully pinned MCP capabilities", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: { ...baseManifest, requestedCapabilities: [
        { id: "read-report", operation: "fs.readText", reason: "Read the selected workspace report", scope: { path: "reports/status.md" }, userPresence: false },
        { id: "read-status", operation: "mcp.callTool", reason: "Read the pinned project status tool", scope: { connectionId: id, name: "status", serverFingerprint: "a".repeat(64), schemaDigest: "b".repeat(64) }, userPresence: true },
      ] },
      files: { "src/Artifact.tsx": "export default function Artifact(){return <div/>}" }, sourceDigest: "2".repeat(64), bundleDigest: null,
    });
    expect(review.verdict).toBe("pass");
    expect(review.findings).toEqual([]);
  });

  it("blocks duplicate capability IDs, dynamic imports, and oversized sources", () => {
    const review = new ArtifactSecurityReviewAgent().review({
      manifest: { ...baseManifest, requestedCapabilities: [
        { id: "read", operation: "fs.readText", reason: "Read the first bounded report", scope: { paths: ["reports/one.md"] }, userPresence: false },
        { id: "read", operation: "fs.list", reason: "List the second bounded report", scope: { path: "reports" }, userPresence: false },
      ] },
      files: { "src/Artifact.tsx": `const loader = import("unknown-package");${"x".repeat(1_000_001)}` },
      sourceDigest: "3".repeat(64), bundleDigest: null,
    });
    expect(review.verdict).toBe("block");
    expect(review.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "duplicate-capability" }),
      expect.objectContaining({ category: "forbidden-import", evidence: "unknown-package" }),
      expect.objectContaining({ category: "oversized-source" }),
    ]));
  });
});
